import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Graph, RiskLevel, SectionStatus } from '@review-cockpit/schema';
import type { MapLayout, PlacedNode } from '../lib/mapLayout';
import { functionLevel, packageLevel } from '../lib/mapLayout';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const FIT_ZOOM = 1.4;

const heatColor: Record<RiskLevel, string> = {
  high: 'var(--high)',
  medium: 'var(--medium)',
  low: 'var(--link)',
};

type Level = { kind: 'packages' } | { kind: 'package'; id: string };

interface View {
  x: number;
  y: number;
  k: number;
}

interface Props {
  graph: Graph;
  status: SectionStatus;
  prNumber: number;
  heatOfHunks(hunkIds: string[]): RiskLevel;
  onJumpToHunk(hunkId: string): void;
}

function clamp(value: number, low: number, high: number): number {
  return Math.min(high, Math.max(low, value));
}

export function MapView({ graph, status, prNumber, heatOfHunks, onJumpToHunk }: Props) {
  const [level, setLevel] = useState<Level>({ kind: 'packages' });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<PlacedNode | null>(null);
  const [panning, setPanning] = useState(false);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const canvas = useRef<HTMLDivElement>(null);

  const ready = status.state === 'ready' && graph.nodes.length > 0;

  const openPackage = level.kind === 'package' ? graph.nodes.find((n) => n.id === level.id) : null;

  const laid: MapLayout | null = useMemo(() => {
    if (!ready) return null;
    return openPackage === null || openPackage === undefined
      ? packageLevel(graph, heatOfHunks)
      : functionLevel(graph, openPackage.id, heatOfHunks);
  }, [ready, graph, heatOfHunks, openPackage]);

  const fit = useCallback(() => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box || !laid || laid.width === 0 || laid.height === 0) return;
    const k = clamp(Math.min(box.width / laid.width, box.height / laid.height), MIN_ZOOM, FIT_ZOOM);
    setView({ x: (box.width - laid.width * k) / 2, y: (box.height - laid.height * k) / 2, k });
  }, [laid]);

  // Each level lays out on its own scale, so the view is fitted when one opens
  // and left alone after that: refitting on every document event would undo the
  // reviewer's zoom.
  const levelKey = level.kind === 'packages' ? 'packages' : level.id;
  const fitted = useRef<string | null>(null);
  useEffect(() => {
    if (laid === null || fitted.current === levelKey) return;
    fitted.current = levelKey;
    fit();
  }, [laid, levelKey, fit]);

  useEffect(() => {
    const element = canvas.current;
    if (element === null) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const box = element.getBoundingClientRect();
      const px = event.clientX - box.left;
      const py = event.clientY - box.top;
      setView((current) => {
        const k = clamp(current.k * (event.deltaY < 0 ? 1.1 : 1 / 1.1), MIN_ZOOM, MAX_ZOOM);
        const ratio = k / current.k;
        return { k, x: px - (px - current.x) * ratio, y: py - (py - current.y) * ratio };
      });
    };
    element.addEventListener('wheel', onWheel, { passive: false });
    return () => element.removeEventListener('wheel', onWheel);
  }, []);

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

  if (laid === null || laid.nodes.length === 0) {
    return (
      <div className="map">
        <div className="map-message">
          <p>
            {graph.nodes.length === 0
              ? 'No call graph nodes for this PR.'
              : 'This package has no changed function to show.'}
          </p>
          {level.kind === 'package' && (
            <button className="btn btn-small" onClick={() => setLevel({ kind: 'packages' })}>
              Back to all packages
            </button>
          )}
        </div>
      </div>
    );
  }

  const packages = level.kind === 'packages';
  const counts = laid.counts;

  return (
    <div className="map">
      <div className="map-toolbar">
        <span className="map-crumbs">
          {packages ? (
            <strong>All packages</strong>
          ) : (
            <>
              <button className="btn-link" onClick={() => setLevel({ kind: 'packages' })}>
                All packages
              </button>
              <span aria-hidden="true">›</span>
              <strong title={openPackage?.label}>{openPackage?.label}</strong>
            </>
          )}
        </span>
        <span className="map-count">
          {packages
            ? `${counts.nodes} packages · ${counts.changedFunctions} changed functions · click a changed package`
            : `${counts.changedFunctions}${counts.hiddenFunctions > 0 ? ` of ${counts.changedFunctions + counts.hiddenFunctions}` : ''} changed functions · ${counts.neighbours} neighbours${counts.folded > 0 ? ` · ${counts.folded} callers folded` : ''}`}
        </span>
        <div className="header-spacer" />
        <div className="map-legend">
          {packages ? (
            <>
              <span className="legend-item">
                <span className="legend-swatch is-changed" /> has a changed function
              </span>
              <span className="legend-item">
                <span className="legend-swatch" /> caller or callee only
              </span>
              <span className="legend-item">
                <span className="legend-line is-thick" /> more calls
              </span>
            </>
          ) : (
            <>
              <span className="legend-item">
                <span className="legend-swatch is-changed" /> changed in this PR
              </span>
              <span className="legend-item">
                <span className="legend-swatch" /> unchanged caller or callee
              </span>
              <span className="legend-item">
                <span className="legend-swatch is-folded" /> counted, not drawn
              </span>
            </>
          )}
        </div>
        {!packages && (
          <button className="btn btn-small" onClick={() => setLevel({ kind: 'packages' })}>
            Back
          </button>
        )}
        <button className="btn btn-small" onClick={fit}>
          Fit
        </button>
      </div>

      {packages && graph.truncated && (
        <div className="banner">
          ⚠ Some packages have more callers than the map draws. Open one to see how many were
          folded into it.
        </div>
      )}

      <div
        className={`map-canvas${panning ? ' is-panning' : ''}`}
        ref={canvas}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragFrom.current = { x: e.clientX - view.x, y: e.clientY - view.y };
          setPanning(true);
        }}
        onPointerMove={(e) => {
          const from = dragFrom.current;
          if (from === null) return;
          setView((current) => ({ ...current, x: e.clientX - from.x, y: e.clientY - from.y }));
        }}
        onPointerUp={() => {
          dragFrom.current = null;
          setPanning(false);
        }}
        onPointerCancel={() => {
          dragFrom.current = null;
          setPanning(false);
        }}
        onDoubleClick={fit}
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
              id="arrow-folded"
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
            {laid.boxes.map((box) => (
              <g key={box.id}>
                <rect
                  x={box.x}
                  y={box.y}
                  width={box.width}
                  height={box.height}
                  rx={8}
                  fill="var(--panel)"
                  stroke="var(--border)"
                />
                <text
                  x={box.x + 8}
                  y={box.y + 14}
                  fontSize={11}
                  fill="var(--fg-muted)"
                  fontFamily="var(--mono)"
                >
                  {box.label}
                  <title>{box.title}</title>
                </text>
              </g>
            ))}

            {laid.edges.map((edge) => (
              <polyline
                key={edge.key}
                points={edge.points.map((p) => `${p.x},${p.y}`).join(' ')}
                fill="none"
                stroke={edge.folded ? 'var(--fg-subtle)' : 'var(--fg-muted)'}
                strokeWidth={edge.width}
                strokeDasharray={edge.folded ? '4 3' : undefined}
                markerEnd={`url(#arrow-${edge.folded ? 'folded' : 'calls'})`}
              />
            ))}

            {laid.nodes.map((node) => (
              <g
                key={node.id}
                onMouseEnter={() => setHovered(node)}
                onMouseLeave={() => setHovered(null)}
                onClick={() => {
                  if (!node.clickable) return;
                  if (node.kind === 'package') {
                    setLevel({ kind: 'package', id: node.id });
                    return;
                  }
                  const first = node.hunkIds[0];
                  if (first !== undefined) onJumpToHunk(first);
                }}
                style={{ cursor: node.clickable ? 'pointer' : 'default' }}
              >
                <rect
                  x={node.x}
                  y={node.y}
                  width={node.width}
                  height={node.height}
                  rx={6}
                  fill={node.filled ? '#ddf4ff' : 'var(--page)'}
                  stroke={node.changed ? heatColor[node.heat] : 'var(--border)'}
                  strokeWidth={node.changed ? 2 : 1}
                  strokeDasharray={node.kind === 'folded' ? '4 3' : undefined}
                />
                <text
                  x={node.x + 8}
                  y={node.y + node.height / 2 + 4}
                  fontSize={11}
                  fontFamily="var(--mono)"
                  fill={node.changed ? 'var(--fg)' : 'var(--fg-muted)'}
                >
                  {node.kind === 'folded' ? '' : node.filled ? '■ ' : '□ '}
                  {node.label}
                  <title>{node.title}</title>
                </text>
              </g>
            ))}
          </g>
        </svg>

        {hovered && (
          <div className="map-hover">
            <div className="map-hover-title">{hovered.title}</div>
            {hovered.kind === 'package' ? (
              <>
                <div>
                  {hovered.changedFunctions} changed functions · {hovered.foldedNeighbours} callers
                  folded
                </div>
                <div>
                  calls in {hovered.fanIn} · calls out {hovered.fanOut}
                </div>
                <div>{hovered.changed ? `${hovered.heat} risk` : 'unchanged'}</div>
              </>
            ) : hovered.kind === 'folded' ? (
              <div>Callers counted on the package node instead of drawn.</div>
            ) : (
              <>
                <div>
                  fan-in {hovered.fanIn} · fan-out {hovered.fanOut}
                </div>
                <div>
                  {hovered.changed
                    ? `hunks: ${hovered.hunkIds.join(', ')} · ${hovered.heat} risk`
                    : 'unchanged'}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
