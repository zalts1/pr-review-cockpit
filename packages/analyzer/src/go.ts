import { createRequire } from 'node:module';
import type { Node, Parser as TsParser } from 'web-tree-sitter';
import { Language, Parser } from 'web-tree-sitter';

export interface GoCall {
  name: string;
  receiver: string | null;
  line: number;
}

export interface GoFunction {
  /** `Type.Method` for a method, the bare name for a function. */
  name: string;
  bare: string;
  receiverType: string | null;
  exported: boolean;
  startLine: number;
  endLine: number;
  complexity: number;
  calls: GoCall[];
  localTypes: Record<string, string>;
}

export interface GoImport {
  alias: string;
  path: string;
}

export interface GoFile {
  packageName: string;
  imports: GoImport[];
  functions: GoFunction[];
}

let parserPromise: Promise<TsParser> | null = null;

export function goWasmPath(): string {
  return createRequire(import.meta.url).resolve('tree-sitter-wasms/out/tree-sitter-go.wasm');
}

export async function goParser(): Promise<TsParser> {
  if (!parserPromise) {
    parserPromise = (async () => {
      await Parser.init();
      const language = await Language.load(goWasmPath());
      const parser = new Parser();
      parser.setLanguage(language);
      return parser;
    })();
  }
  return parserPromise;
}

const BRANCHES = new Set([
  'if_statement',
  'for_statement',
  'expression_case',
  'type_case',
  'communication_case',
  'expression_switch_statement',
  'type_switch_statement',
  'select_statement',
]);

const COUNTED = new Set(['if_statement', 'for_statement', 'expression_case', 'type_case', 'communication_case']);

const LOOPS_AND_CONDITIONALS = new Set([
  'if_statement',
  'for_statement',
  'expression_case',
  'type_case',
  'communication_case',
]);

function namedChildren(node: Node): Node[] {
  const out: Node[] = [];
  for (let i = 0; i < node.namedChildCount; i += 1) {
    const child = node.namedChild(i);
    if (child) out.push(child);
  }
  return out;
}

/**
 * 1 plus each if, for, case and short-circuit operator, plus a return that sits
 * inside a loop or a conditional. A nested function literal counts into the
 * function that holds it, because that is where a reviewer reads it.
 */
export function complexityOf(body: Node): number {
  let total = 1;
  const walk = (node: Node, insideBranch: boolean): void => {
    if (COUNTED.has(node.type)) total += 1;
    if (node.type === 'binary_expression') {
      const operator = node.childForFieldName('operator')?.text;
      if (operator === '&&' || operator === '||') total += 1;
    }
    if (node.type === 'return_statement' && insideBranch) total += 1;
    const next = insideBranch || LOOPS_AND_CONDITIONALS.has(node.type);
    for (const child of namedChildren(node)) walk(child, next);
  };
  for (const child of namedChildren(body)) walk(child, BRANCHES.has(child.type));
  return total;
}

function typeNameOf(node: Node | null): string | null {
  if (!node) return null;
  if (node.type === 'pointer_type') return typeNameOf(node.namedChild(0));
  if (node.type === 'type_identifier' || node.type === 'identifier') return node.text;
  if (node.type === 'qualified_type') return node.text;
  if (node.type === 'generic_type') return typeNameOf(node.childForFieldName('type'));
  return null;
}

function receiverTypeOf(fn: Node): string | null {
  const receiver = fn.childForFieldName('receiver');
  if (!receiver) return null;
  const declaration = namedChildren(receiver)[0];
  if (!declaration) return null;
  return typeNameOf(declaration.childForFieldName('type'));
}

function receiverName(fn: Node): string | null {
  const receiver = fn.childForFieldName('receiver');
  const declaration = receiver ? namedChildren(receiver)[0] : null;
  return declaration?.childForFieldName('name')?.text ?? null;
}

/** Enough of a type environment to resolve `x.Method()` where x is local. */
function localTypes(fn: Node): Record<string, string> {
  const types: Record<string, string> = {};
  const receiver = receiverName(fn);
  const receiverType = receiverTypeOf(fn);
  if (receiver && receiverType) types[receiver] = receiverType;

  const parameters = fn.childForFieldName('parameters');
  if (parameters) {
    for (const declaration of namedChildren(parameters)) {
      const type = typeNameOf(declaration.childForFieldName('type'));
      if (!type) continue;
      for (const child of namedChildren(declaration)) {
        if (child.type === 'identifier') types[child.text] = type;
      }
    }
  }

  const walk = (node: Node): void => {
    if (node.type === 'short_var_declaration' || node.type === 'assignment_statement') {
      const left = node.childForFieldName('left');
      const right = node.childForFieldName('right');
      const names = left ? namedChildren(left).filter((n) => n.type === 'identifier') : [];
      const values = right ? namedChildren(right) : [];
      for (const [i, name] of names.entries()) {
        const value = values[i];
        if (!value) continue;
        const literal =
          value.type === 'composite_literal'
            ? value.childForFieldName('type')
            : value.type === 'unary_expression' && value.childForFieldName('operand')?.type === 'composite_literal'
              ? value.childForFieldName('operand')?.childForFieldName('type') ?? null
              : null;
        const type = typeNameOf(literal ?? null);
        if (type) types[name.text] = type;
      }
    }
    if (node.type === 'var_declaration' || node.type === 'const_declaration') {
      for (const spec of namedChildren(node)) {
        const type = typeNameOf(spec.childForFieldName('type'));
        if (!type) continue;
        for (const child of namedChildren(spec)) {
          if (child.type === 'identifier') types[child.text] = type;
        }
      }
    }
    for (const child of namedChildren(node)) walk(child);
  };
  const body = fn.childForFieldName('body');
  if (body) walk(body);
  return types;
}

function callsIn(body: Node): GoCall[] {
  const calls: GoCall[] = [];
  const walk = (node: Node): void => {
    if (node.type === 'call_expression') {
      const target = node.childForFieldName('function');
      if (target?.type === 'identifier') {
        calls.push({ name: target.text, receiver: null, line: target.startPosition.row + 1 });
      } else if (target?.type === 'selector_expression') {
        const field = target.childForFieldName('field');
        const operand = target.childForFieldName('operand');
        if (field) {
          calls.push({
            name: field.text,
            receiver: operand?.text ?? null,
            line: field.startPosition.row + 1,
          });
        }
      }
    }
    for (const child of namedChildren(node)) walk(child);
  };
  walk(body);
  return calls;
}

function importsOf(root: Node): GoImport[] {
  const imports: GoImport[] = [];
  const walk = (node: Node): void => {
    if (node.type === 'import_spec') {
      const path = node.childForFieldName('path')?.text.replace(/^["`]|["`]$/g, '') ?? '';
      const named = node.childForFieldName('name')?.text;
      imports.push({ alias: named ?? (path.split('/').pop() ?? path), path });
      return;
    }
    for (const child of namedChildren(node)) walk(child);
  };
  walk(root);
  return imports;
}

export function parseGoTree(root: Node): GoFile {
  const functions: GoFunction[] = [];
  const walk = (node: Node): void => {
    if (node.type === 'function_declaration' || node.type === 'method_declaration') {
      const bare = node.childForFieldName('name')?.text ?? '';
      const receiverType = receiverTypeOf(node);
      const body = node.childForFieldName('body');
      functions.push({
        name: receiverType === null ? bare : `${receiverType}.${bare}`,
        bare,
        receiverType,
        exported: /^[A-Z]/.test(bare),
        startLine: node.startPosition.row + 1,
        endLine: node.endPosition.row + 1,
        complexity: body ? complexityOf(body) : 1,
        calls: body ? callsIn(body) : [],
        localTypes: localTypes(node),
      });
      return;
    }
    for (const child of namedChildren(node)) walk(child);
  };
  walk(root);

  let packageName = '';
  for (const child of namedChildren(root)) {
    if (child.type === 'package_clause') {
      packageName = child.namedChild(0)?.text ?? '';
      break;
    }
  }

  return { packageName, imports: importsOf(root), functions };
}

export async function parseGo(source: string): Promise<GoFile> {
  const parser = await goParser();
  const tree = parser.parse(source);
  if (!tree) return { packageName: '', imports: [], functions: [] };
  try {
    return parseGoTree(tree.rootNode);
  } finally {
    tree.delete();
  }
}

export function functionsOverlapping(
  functions: readonly GoFunction[],
  ranges: ReadonlyArray<readonly [number, number]>,
): GoFunction[] {
  return functions.filter((fn) =>
    ranges.some(([start, end]) => fn.startLine <= end && fn.endLine >= start),
  );
}
