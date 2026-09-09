import type {
  DiffLine,
  Hunk,
  HunkKind,
  Risk,
  RiskFactor,
  RiskLevel,
} from '@review-cockpit/schema';

export function diffLines(
  oldStart: number,
  newStart: number,
  body: string,
): { lines: DiffLine[]; oldLines: number; newLines: number } {
  const rows = body.replace(/^\n/, '').replace(/\n$/, '').split('\n');
  let oldNo = oldStart;
  let newNo = newStart;
  const lines: DiffLine[] = [];
  for (const row of rows) {
    const marker = row.slice(0, 1);
    const text = row.slice(1);
    if (marker === '+') {
      lines.push({ type: 'add', oldNo: null, newNo: newNo++, text });
    } else if (marker === '-') {
      lines.push({ type: 'del', oldNo: oldNo++, newNo: null, text });
    } else {
      lines.push({ type: 'context', oldNo: oldNo++, newNo: newNo++, text: text });
    }
  }
  return {
    lines,
    oldLines: lines.filter((l) => l.type !== 'add').length,
    newLines: lines.filter((l) => l.type !== 'del').length,
  };
}

export interface RiskSpec {
  floor: RiskLevel;
  level?: RiskLevel;
  score: number;
  factors: RiskFactor[];
  reason?: string | null;
  adjustedBy?: Risk['adjustedBy'];
}

export function risk(spec: RiskSpec): Risk {
  const level = spec.level ?? spec.floor;
  return {
    floor: spec.floor,
    level,
    score: spec.score,
    mode: level === 'low' ? 'skim' : 'scrutinize',
    factors: spec.factors,
    reason: spec.reason ?? null,
    adjustedBy: spec.adjustedBy ?? null,
  };
}

export interface HunkSpec {
  oldStart: number;
  newStart: number;
  header: string;
  symbols: string[];
  kind: HunkKind;
  risk: Risk;
  body: string;
}

export function hunk(fileId: string, index: number, spec: HunkSpec): Hunk {
  const { lines, oldLines, newLines } = diffLines(spec.oldStart, spec.newStart, spec.body);
  return {
    id: `${fileId}.h${index}`,
    oldStart: spec.oldStart,
    oldLines,
    newStart: spec.newStart,
    newLines,
    header: spec.header,
    symbols: spec.symbols,
    kind: spec.kind,
    lines,
    risk: spec.risk,
  };
}

export function lowRisk(score: number, factors: RiskFactor[]): Risk {
  return risk({ floor: 'low', score, factors });
}

export function descriptorBytes(payload: string, perLine = 12): string {
  const bytes = [...Buffer.from(payload, 'utf8')];
  const rows: string[] = [];
  for (let i = 0; i < bytes.length; i += perLine) {
    const chunk = bytes.slice(i, i + perLine).map((b) => `0x${b.toString(16).padStart(2, '0')}`);
    rows.push(`+\t${chunk.join(', ')},`);
  }
  return rows.join('\n');
}
