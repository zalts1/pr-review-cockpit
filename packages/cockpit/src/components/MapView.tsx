import { useMemo, useRef, useState } from 'react';
import * as dagreModule from '@dagrejs/dagre';
import type { Graph, GraphNode, RiskLevel, SectionStatus } from '@review-cockpit/schema';

// dagre ships CommonJS, and Node's ESM interop exposes only some of its named
// exports, so reach through the default binding when the bundler provides one.
const dagre =
  (dagreModule as { default?: typeof dagreModule }).default ?? dagreModule;
const { graphlib, layout } = dagre;

const NODE_HEIGHT = 26;
const CHAR_WIDTH = 6.4;
const NODE_PADDING = 24;

interface Placed {
  node: GraphNode;
  x: number;
  y: number;
  width: number;
  height: number;
  heat: RiskLevel;
  fanIn: number;
  fanOut: number;
}

interface Cluster {
  id: string;
  label: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EdgeLine {
  key: string;
  kind: 'calls' | 'imports';
  points: Array<{ x: number; y: number }>;
}

interface Layout {
  nodes: Placed[];
  clusters: Cluster[];
  edges: EdgeLine[];
  width: number;
  height: number;
}

function packageOf(node: GraphNode): string {
  if (node.kind === 'package') return node.label;
  if (!node.file) return '(external)';
  const slash = node.file.lastIndexOf('/');
  return slash === -1 ? '(root)' : node.file.slice(0, slash);
}

function computeLayout(
  graph: Graph,
  heatOf: (hunkIds: string[]) => RiskLevel,
  onlyHigh: boolean,
): Layout {
  const heatByNode = new Map(graph.nodes.map((n) => [n.id, heatOf(n.hunkIds)] as const));

  let nodes = graph.nodes;
  if (onlyHigh) {
    const seeds = new Set(
      graph.nodes.filter((n) => heatByNode.get(n.id) === 'high').map((n) => n.id),
    );
    const keep = new Set(seeds);
    for (const edge of graph.edges) {
      if (seeds.has(edge.from)) keep.add(edge.to);
      if (seeds.has(edge.to)) keep.add(edge.from);
    }
    nodes = graph.nodes.filter((n) => keep.has(n.id));
  }

  const present = new Set(nodes.map((n) => n.id));
  const edges = graph.edges.filter((e) => present.has(e.from) && present.has(e.to));

  const fanIn = new Map<string, number>();
  const fanOut = new Map<string, number>();
  for (const edge of graph.edges) {
    fanOut.set(edge.from, (fanOut.get(edge.from) ?? 0) + 1);
    fanIn.set(edge.to, (fanIn.get(edge.to) ?? 0) + 1);
  }

  const g = new graphlib.Graph({ compound: true, multigraph: true });
  g.setGraph({ rankdir: 'LR', nodesep: 14, ranksep: 70, marginx: 24, marginy: 24 });
  g.setDefaultEdgeLabel(() => ({}));

  const clusters = new Map<string, string>();
  for (const node of nodes) {
    const pkg = packageOf(node);
    const clusterId = `cluster:${pkg}`;
    if (!clusters.has(clusterId)) {
      clusters.set(clusterId, pkg);
      g.setNode(clusterId, { label: pkg, clusterLabelPos: 'top' });
    }
    g.setNode(node.id, {
      width: Math.min(280, node.label.length * CHAR_WIDTH + NODE_PADDING),
      height: NODE_HEIGHT,
    });
    g.setParent(node.id, clusterId);
  }
  for (const [i, edge] of edges.entries()) {
    g.setEdge(edge.from, edge.to, {}, `e${i}`);
  }

  layout(g);

  const placed: Placed[] = nodes.map((node) => {
    const laid = g.node(node.id);
    return {
      node,
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
      width: laid.width,
      height: laid.height,
      heat: heatByNode.get(node.id) ?? 'low',
      fanIn: fanIn.get(node.id) ?? 0,
      fanOut: fanOut.get(node.id) ?? 0,
    };
  });

  const boxes: Cluster[] = [...clusters.entries()].map(([id, label]) => {
    const laid = g.node(id);
    return {
      id,
      label,
      x: laid.x - laid.width / 2,
      y: laid.y - laid.height / 2,
      width: laid.width,
      height: laid.height,
    };
  });

  const lines: EdgeLine[] = edges.map((edge, i) => ({
    key: `${edge.from}-${edge.to}-${i}`,
    kind: edge.kind,
    points: g.edge(edge.from, edge.to, `e${i}`).points,
  }));

  const info = g.graph();
  return {
    nodes: placed,
    clusters: boxes,
    edges: lines,
    width: info.width ?? 1000,
    height: info.height ?? 600,
  };
}

const heatColor: Record<RiskLevel, string> = {
  high: 'var(--high)',
  medium: 'var(--medium)',
  low: 'var(--link)',
};

interface Props {
  graph: Graph;
  status: SectionStatus;
  prNumber: number;
  heatOfHunks(hunkIds: string[]): RiskLevel;
  onJumpToHunk(hunkId: string): void;
}

export function MapView({ graph, status, prNumber, heatOfHunks, onJumpToHunk }: Props) {
  const [onlyHigh, setOnlyHigh] = useState(false);
  const [view, setView] = useState({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<Placed | null>(null);
  const [drawer, setDrawer] = useState<GraphNode | null>(null);
  const panning = useRef<{ x: number; y: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const laid = useMemo(
    () =>
      status.state === 'ready' && graph.nodes.length > 0
        ? computeLayout(graph, heatOfHunks, onlyHigh)
        : null,
    [graph, status.state, heatOfHunks, onlyHigh],
  );

  if (status.state === 'pending') {
    return (
      <div className="map">
        <div className="map-message">
          <p>Building call graph… this can take up to a minute on large repositories.</p>
        </div>
      </div>
    );
  }

  if (status.state === 'failed') {
    return (
      <div className="map">
        <div className="map-message">
          <p>
            {status.message ?? 'The call graph could not be built.'}
            <br />
            <br />
            Re-run from the terminal with <code>review {prNumber} --graph</code>.
          </p>
        </div>
      </div>
    );
  }

  if (!laid || laid.nodes.length === 0) {
    return (
      <div className="map">
        <div className="map-message">
          <p>No call graph nodes for this PR.</p>
        </div>
      </div>
    );
  }

  const fit = () => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box) return;
    const k = Math.min(box.width / laid.width, box.height / laid.height, 1.4);
    setView({
      x: (box.width - laid.width * k) / 2,
      y: (box.height - laid.height * k) / 2,
      k,
    });
  };

  return (
    <div className="map">
      <div className="map-toolbar">
        <span>
          Showing {laid.nodes.length} of {graph.nodes.length} nodes. Click a changed node to jump
          to its diff.
        </span>
        <div className="map-legend">
          <span className="legend-item">
            <span className="legend-swatch is-changed" /> changed in this PR
          </span>
          <span className="legend-item">
            <span className="legend-swatch" /> unchanged caller or callee
          </span>
          <span className="legend-item">
            <span className="legend-line" /> calls
          </span>
          <span className="legend-item">
            <span className="legend-line is-import" /> imports
          </span>
        </div>
        <div className="header-spacer" />
        <label className="file-viewed">
          <input
            type="checkbox"
            checked={onlyHigh}
            onChange={(e) => setOnlyHigh(e.target.checked)}
          />
          only high-risk nodes and neighbours
        </label>
        <button className="btn btn-small" onClick={fit}>
          Fit
        </button>
      </div>

      {graph.truncated && (
        <div className="banner">
          ⚠ The graph was cut to a node limit, so some neighbours are missing. Filter to the
          high-risk nodes to see the part that matters.
        </div>
      )}

      <div
        className={`map-canvas${panning.current ? ' is-panning' : ''}`}
        ref={canvas}
        onMouseDown={(e) => {
          panning.current = { x: e.clientX - view.x, y: e.clientY - view.y };
        }}
        onMouseMove={(e) => {
          if (!panning.current) return;
          setView((v) => ({
            ...v,
            x: e.clientX - (panning.current?.x ?? 0),
            y: e.clientY - (panning.current?.y ?? 0),
          }));
        }}
        onMouseUp={() => {
          panning.current = null;
        }}
        onMouseLeave={() => {
          panning.current = null;
        }}
        onWheel={(e) => {
          e.preventDefault();
          const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
          setView((v) => ({ ...v, k: Math.min(3, Math.max(0.2, v.k * factor)) }));
        }}
      >
        <svg width="100%" height="100%" role="img" aria-label="Blast radius map">
          <defs>
            <marker
              id="arrow-calls"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-muted)" />
            </marker>
            <marker
              id="arrow-imports"
              viewBox="0 0 10 10"
              refX="9"
              refY="5"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-subtle)" />
            </marker>
          </defs>

          <g transform={`translate(${view.x},${view.y}) scale(${view.k})`}>
            {laid.clusters.map((cluster) => (
              <g key={cluster.id}>
                <rect
                  x={cluster.x}
                  y={cluster.y}
                  width={cluster.width}
                  height={cluster.height}
                  rx={8}
                  fill="var(--panel)"
                  stroke="var(--border)"
                />
                <text
                  x={cluster.x + 8}
                  y={cluster.y + 14}
                  fontSize={11}
                  fill="var(--fg-muted)"
                  fontFamily="var(--mono)"
                >
                  {cluster.label}
                </text>
              </g>
            ))}

            {laid.edges.map((edge) => (
              <polyline
                key={edge.key}
                points={edge.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={edge.kind === 'calls' ? 'var(--fg-muted)' : 'var(--fg-subtle)'}
                strokeWidth={edge.kind === 'calls' ? 1.4 : 1}
                strokeDasharray={edge.kind === 'imports' ? '4 3' : undefined}
                markerEnd={`url(#arrow-${edge.kind})`}
              />
            ))}

            {laid.nodes.map((placed) => (
              <g
                key={placed.node.id}
                onMouseEnter={() => setHovered(placed)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  const first = placed.node.hunkIds[0];
                  if (placed.node.changed && first) onJumpToHunk(first);
                  else setDrawer(placed.node);
                }}
                style={{ cursor: 'pointer' }}
              >
                <rect
                  x={placed.x}
                  y={placed.y}
                  width={placed.width}
                  height={placed.height}
                  rx={6}
                  fill={placed.node.changed ? '#ddf4ff' : 'var(--page)'}
                  stroke={placed.node.changed ? heatColor[placed.heat] : 'var(--border)'}
                  strokeWidth={placed.node.changed ? 2 : 1}
                />
                <text
                  x={placed.x + 8}
                  y={placed.y + 17}
                  fontSize={11}
                  fontFamily="var(--mono)"
                  fill={placed.node.changed ? 'var(--fg)' : 'var(--fg-muted)'}
                >
                  {placed.node.changed ? '■ ' : '□ '}
                  {placed.node.label}
                </text>
              </g>
            ))}
          </g>
        </svg>

        {hovered && (
          <div className="map-hover">
            <div className="map-hover-title">{hovered.node.label}</div>
            <div>{hovered.node.file ?? hovered.node.kind}</div>
            <div>
              fan-in {hovered.fanIn} · fan-out {hovered.fanOut}
            </div>
            <div>
              {hovered.node.changed
                ? `hunks: ${hovered.node.hunkIds.join(', ')} · ${hovered.heat} risk`
                : 'unchanged'}
            </div>
          </div>
        )}

        {drawer && (
          <aside className="drawer">
            <div className="pin-open-head">
              <strong>{drawer.label}</strong>
              <div className="header-spacer" />
              <button className="btn-link" onClick={() => setDrawer(null)}>
                close
              </button>
            </div>
            <p className="node-label">{drawer.file ?? drawer.kind}</p>
            <p className="empty">
              This symbol is unchanged in this PR. Reading it from the checkout needs the local
              server, which M1 does not run.
            </p>
          </aside>
        )}
      </div>
    </div>
  );
}
