import * as dagreModule from '@dagrejs/dagre';
import type { Graph, GraphNode, RiskLevel } from '@review-cockpit/schema';

// dagre ships CommonJS, and Node's ESM interop exposes only some of its named
// exports, so reach through the default binding when the bundler provides one.
const dagre = (dagreModule as { default?: typeof dagreModule }).default ?? dagreModule;
const { graphlib, layout } = dagre;

export const NEIGHBOUR_CAP = 40;

// A package label can hold spaces, as "(repository root)" does, so pairs are
// keyed on a character no path contains.
const PAIR = '\u0001';

const CHAR_WIDTH = 6.4;
const LABEL_PADDING = 26;
const MIN_WIDTH = 118;
const MAX_WIDTH = 300;
const MIN_HEIGHT = 28;
const MAX_HEIGHT = 46;
const FUNCTION_HEIGHT = 26;
const MAX_EDGE_WIDTH = 6;

export type HeatOf = (hunkIds: string[]) => RiskLevel;

export interface PlacedNode {
  id: string;
  kind: 'package' | 'function' | 'file' | 'folded';
  label: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** True when the node carries changed hunks: it takes a heat border and reads as in the PR. */
  changed: boolean;
  /** True when the node holds a changed function of its own. */
  filled: boolean;
  heat: RiskLevel;
  hunkIds: string[];
  fanIn: number;
  fanOut: number;
  changedFunctions: number;
  foldedNeighbours: number;
  clickable: boolean;
}

export interface PlacedEdge {
  key: string;
  weight: number;
  width: number;
  points: Array<{ x: number; y: number }>;
  folded: boolean;
}

export interface PlacedBox {
  id: string;
  label: string;
  title: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MapCounts {
  nodes: number;
  changedFunctions: number;
  neighbours: number;
  folded: number;
}

export interface MapLayout {
  nodes: PlacedNode[];
  edges: PlacedEdge[];
  boxes: PlacedBox[];
  counts: MapCounts;
  width: number;
  height: number;
}

export function packageOf(node: GraphNode): string {
  if (node.kind === 'package') return node.label;
  if (node.file === null) return '(external)';
  const slash = node.file.lastIndexOf('/');
  return slash === -1 ? '(repository root)' : node.file.slice(0, slash);
}

/** The last two segments, so a deep Go package path still fits in a node. */
export function shortPackage(path: string): string {
  const segments = path.split('/');
  return segments.length <= 2 ? path : `…/${segments.slice(-2).join('/')}`;
}

function labelWidth(label: string): number {
  return Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, label.length * CHAR_WIDTH + LABEL_PADDING));
}

function edgeWidth(weight: number): number {
  return Math.min(MAX_EDGE_WIDTH, 1.2 + Math.log2(weight + 1) * 1.1);
}

interface Degrees {
  fanIn: Map<string, number>;
  fanOut: Map<string, number>;
}

function degreesOf(graph: Graph): Degrees {
  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const edge of graph.edges) {
    fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
    fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
  }
  return { fanIn, fanOut };
}

interface Sized {
  id: string;
  width: number;
  height: number;
  parent?: string;
}

interface Wire {
  from: string;
  to: string;
  weight: number;
  folded: boolean;
}

function run(
  sized: Sized[],
  wires: Wire[],
  boxes: Map<string, string>,
): { position: (id: string) => { x: number; y: number; width: number; height: number }; edges: PlacedEdge[]; boxes: PlacedBox[]; width: number; height: number } {
  const g = new graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 18, ranksep: 78, marginx: 26, marginy: 26 });
  g.setDefaultEdgeLabel(() => ({}));

  for (const [id, label] of boxes) g.setNode(id, { label, clusterLabelPos: 'top' });
  for (const node of sized) {
    g.setNode(node.id, { width: node.width, height: node.height });
    if (node.parent !== undefined) g.setParent(node.id, node.parent);
  }
  for (const [i, wire] of wires.entries()) g.setEdge(wire.from, wire.to, {}, `e${i}`);

  layout(g);

  const at = (id: string): { x: number; y: number; width: number; height: number } => {
    const laid = g.node(id) as { x: number; y: number; width: number; height: number };
    return {
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
      width: laid.width,
      height: laid.height,
    };
  };

  const edges: PlacedEdge[] = wires.map((wire, i) => ({
    key: `${wire.from}-${wire.to}-${i}`,
    weight: wire.weight,
    width: edgeWidth(wire.weight),
    points: (g.edge(wire.from, wire.to, `e${i}`) as { points: Array<{ x: number; y: number }> })
      .points,
    folded: wire.folded,
  }));

  const placedBoxes: PlacedBox[] = [...boxes].map(([id, label]) => ({
    id,
    label: shortPackage(label),
    title: label,
    ...at(id),
  }));

  const info = g.graph() as { width?: number; height?: number };
  return {
    position: at,
    edges,
    boxes: placedBoxes,
    width: info.width ?? 800,
    height: info.height ?? 600,
  };
}

/** Level 1: one node per package, one edge per package pair, weighted by resolved calls. */
export function packageLevel(graph: Graph, heatOf: HeatOf): MapLayout {
  const packages = graph.nodes.filter((node) => node.kind === 'package');
  const byLabel = new Map(packages.map((node) => [node.label, node] as const));
  const packageOfNode = new Map(
    graph.nodes.map((node) => [node.id, packageOf(node)] as const),
  );

  const weights = new Map<string, number>();
  for (const edge of graph.edges) {
    const from = packageOfNode.get(edge.from);
    const to = packageOfNode.get(edge.to);
    if (from === undefined || to === undefined || from === to) continue;
    if (!byLabel.has(from) || !byLabel.has(to)) continue;
    const key = `${from}${PAIR}${to}`;
    weights.set(key, (weights.get(key) ?? 0) + 1);
  }

  const changedFunctionsOf = (node: GraphNode): number => node.count?.changedFunctions ?? 0;
  const most = Math.max(0, ...packages.map(changedFunctionsOf));

  // A package with changed hunks but no changed function, such as a generated
  // proto package, has nothing to show at level 2, so it does not open.
  const openable = new Set(
    graph.nodes
      .filter((node) => node.kind !== 'package' && node.changed)
      .map((node) => packageOf(node)),
  );

  const sized: Sized[] = packages.map((node) => {
    const share = most === 0 ? 0 : Math.log1p(changedFunctionsOf(node)) / Math.log1p(most);
    return {
      id: node.id,
      width: Math.min(MAX_WIDTH, labelWidth(shortPackage(node.label)) + 70 * share),
      height: MIN_HEIGHT + (MAX_HEIGHT - MIN_HEIGHT) * share,
    };
  });

  const wires: Wire[] = [...weights].map(([key, weight]) => {
    const [from, to] = key.split(PAIR);
    return {
      from: byLabel.get(from as string)?.id as string,
      to: byLabel.get(to as string)?.id as string,
      weight,
      folded: false,
    };
  });

  const laid = run(sized, wires, new Map());
  const fanOfPackage = new Map<string, { in: number; out: number }>();
  for (const [key, weight] of weights) {
    const [from, to] = key.split(PAIR) as [string, string];
    const out = fanOfPackage.get(from) ?? { in: 0, out: 0 };
    out.out += weight;
    fanOfPackage.set(from, out);
    const into = fanOfPackage.get(to) ?? { in: 0, out: 0 };
    into.in += weight;
    fanOfPackage.set(to, into);
  }

  return {
    nodes: packages.map((node) => {
      const fan = fanOfPackage.get(node.label) ?? { in: 0, out: 0 };
      const changedFunctions = changedFunctionsOf(node);
      return {
        id: node.id,
        kind: 'package' as const,
        label: shortPackage(node.label),
        title: node.label,
        ...laid.position(node.id),
        changed: node.changed,
        filled: changedFunctions > 0,
        heat: heatOf(node.hunkIds),
        hunkIds: node.hunkIds,
        fanIn: fan.in,
        fanOut: fan.out,
        changedFunctions,
        foldedNeighbours: node.count?.foldedNeighbours ?? 0,
        clickable: openable.has(node.label),
      };
    }),
    edges: laid.edges,
    boxes: laid.boxes,
    counts: {
      nodes: packages.length,
      changedFunctions: packages.reduce((total, node) => total + changedFunctionsOf(node), 0),
      neighbours: packages.filter((node) => changedFunctionsOf(node) === 0).length,
      folded: packages.reduce((total, node) => total + (node.count?.foldedNeighbours ?? 0), 0),
    },
    width: laid.width,
    height: laid.height,
  };
}

/**
 * Level 2: the changed functions of one package and their one-hop neighbours,
 * boxed by the neighbour's own package. The cap is the analyzer's, applied
 * again here because a document written before the fold can carry more.
 */
export function functionLevel(
  graph: Graph,
  packageId: string,
  heatOf: HeatOf,
  cap = NEIGHBOUR_CAP,
): MapLayout {
  const pkg = graph.nodes.find((node) => node.id === packageId);
  const empty: MapLayout = {
    nodes: [],
    edges: [],
    boxes: [],
    counts: { nodes: 0, changedFunctions: 0, neighbours: 0, folded: 0 },
    width: 0,
    height: 0,
  };
  if (pkg === undefined) return empty;

  const byId = new Map(graph.nodes.map((node) => [node.id, node] as const));
  const members = graph.nodes.filter(
    (node) => node.kind !== 'package' && node.changed && packageOf(node) === pkg.label,
  );
  const memberIds = new Set(members.map((node) => node.id));

  const callersOf = new Set<string>();
  const calleesOf = new Set<string>();
  for (const edge of graph.edges) {
    if (memberIds.has(edge.to) && !memberIds.has(edge.from)) callersOf.add(edge.from);
    if (memberIds.has(edge.from) && !memberIds.has(edge.to)) calleesOf.add(edge.to);
  }
  for (const id of callersOf) calleesOf.delete(id);

  const { fanIn, fanOut } = degreesOf(graph);
  const rank = (id: string, caller: boolean): [number, number, string] => [
    caller ? 0 : 1,
    -(fanIn.get(id) ?? 0),
    byId.get(id)?.label ?? id,
  ];
  const neighbours = [
    ...[...callersOf].map((id) => ({ id, key: rank(id, true) })),
    ...[...calleesOf].map((id) => ({ id, key: rank(id, false) })),
  ]
    .sort((a, b) => a.key[0] - b.key[0] || a.key[1] - b.key[1] || a.key[2].localeCompare(b.key[2]))
    .slice(0, cap)
    .map((entry) => byId.get(entry.id))
    .filter((node): node is GraphNode => node !== undefined);

  const shown = [...members, ...neighbours];
  const shownIds = new Set(shown.map((node) => node.id));

  const boxes = new Map<string, string>();
  const sized: Sized[] = shown.map((node) => {
    const box = packageOf(node);
    const boxId = `box:${box}`;
    boxes.set(boxId, box);
    return { id: node.id, width: labelWidth(node.label), height: FUNCTION_HEIGHT, parent: boxId };
  });

  const wires: Wire[] = [];
  const seen = new Set<string>();
  for (const edge of graph.edges) {
    if (!shownIds.has(edge.from) || !shownIds.has(edge.to)) continue;
    const key = `${edge.from} ${edge.to}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wires.push({ from: edge.from, to: edge.to, weight: 1, folded: false });
  }

  const folded = pkg.count?.foldedNeighbours ?? 0;
  const foldedId = 'folded';
  const foldedLabel = `and ${folded} more callers`;
  if (folded > 0 && members.length > 0) {
    sized.push({ id: foldedId, width: labelWidth(foldedLabel), height: FUNCTION_HEIGHT });
    wires.push({ from: foldedId, to: members[0]!.id, weight: folded, folded: true });
  }

  const laid = run(sized, wires, boxes);

  const nodes: PlacedNode[] = shown.map((node) => ({
    id: node.id,
    kind: node.kind === 'file' ? 'file' : 'function',
    label: node.label,
    title: node.file ?? node.label,
    ...laid.position(node.id),
    changed: node.changed,
    filled: node.changed,
    heat: heatOf(node.hunkIds),
    hunkIds: node.hunkIds,
    fanIn: fanIn.get(node.id) ?? 0,
    fanOut: fanOut.get(node.id) ?? 0,
    changedFunctions: 0,
    foldedNeighbours: 0,
    clickable: node.changed && node.hunkIds.length > 0,
  }));

  if (folded > 0 && members.length > 0) {
    nodes.push({
      id: foldedId,
      kind: 'folded',
      label: foldedLabel,
      title: `${folded} callers of this package were folded into its package node`,
      ...laid.position(foldedId),
      changed: false,
      filled: false,
      heat: 'low',
      hunkIds: [],
      fanIn: 0,
      fanOut: 0,
      changedFunctions: 0,
      foldedNeighbours: folded,
      clickable: false,
    });
  }

  return {
    nodes,
    edges: laid.edges,
    boxes: laid.boxes,
    counts: {
      nodes: nodes.length,
      changedFunctions: members.length,
      neighbours: neighbours.length,
      folded,
    },
    width: laid.width,
    height: laid.height,
  };
}
