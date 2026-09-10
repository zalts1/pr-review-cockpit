import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Graph, RiskLevel, SectionStatus } from '@review-cockpit/schema';
import type { MapLayout, PlacedNode } from '../lib/mapLayout';
import { functionLevel, packageLevel } from '../lib/mapLayout';
import {
  ArrowRightIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  SpinnerIcon,
  WarnIcon,
} from './Icons';

const MIN_ZOOM = 0.15;
const MAX_ZOOM = 3;
const FIT_ZOOM = 1.4;
/** A pointer that travelled further than this was panning, not clicking a card. */
const CLICK_SLOP = 4;
const TOP_MARGIN = 24;

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

function MapMessage({ children }: { children: ReactNode }) {
  return (
    <div className="map">
      <div className="map-message">
        <div className="map-message-card">{children}</div>
      </div>
    </div>
  );
}

/**
 * A package the analyzer tracked no changed function in, such as regenerated
 * protobuf output, still carries changed hunks: count those instead of saying
 * "0 changed functions" about a package the reviewer can see in the diff.
 */
function cardMeta(node: PlacedNode): string {
  const plural = (n: number): string => (n === 1 ? 'call' : 'calls');
  if (!node.changed) {
    return node.fanOut > 0
      ? `calls in · ${node.fanOut} ${plural(node.fanOut)}`
      : `called · ${node.fanIn} ${plural(node.fanIn)}`;
  }
  if (node.changedFunctions > 0) {
    return `${node.changedFunctions} changed ${
      node.changedFunctions === 1 ? 'function' : 'functions'
    }`;
  }
  const hunks = node.hunkIds.length;
  return `${hunks} changed ${hunks === 1 ? 'hunk' : 'hunks'}`;
}

function heatWord(node: PlacedNode): string {
  if (node.highFunctions > 0) {
    return `${node.highFunctions} high`;
  }
  return node.changed ? node.heat : 'unchanged';
}

function PackageCard({
  node,
  open,
  onOpen,
  onHover,
}: {
  node: PlacedNode;
  open: boolean;
  onOpen(): void;
  onHover(node: PlacedNode | null): void;
}) {
  const muted = !node.changed;
  const heat = heatWord(node);
  const Tag = node.clickable ? 'button' : 'div';

  return (
    <Tag
      className={[
        'map-card',
        muted ? 'is-muted' : 'is-changed',
        muted ? '' : `heat-card-${node.heat}`,
        node.clickable ? 'is-clickable' : '',
        open ? 'is-open' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: node.x, top: node.y, width: node.width, minHeight: node.height }}
      onClick={node.clickable ? onOpen : undefined}
      onMouseEnter={() => onHover(node)}
      onMouseLeave={() => onHover(null)}
      title={node.title}
    >
      <div className="map-card-name">{node.label}</div>
      <div className="map-card-meta">
        <span>{cardMeta(node)}</span>
        {node.changed && <span className={`map-card-heat-${node.heat}`}>{heat}</span>}
      </div>

      {node.members.length > 0 && (
        <div className="map-members">
          {node.members.map((member) => (
            <div className="map-member" key={member.id}>
              <span className={`map-member-${member.heat}`}>{member.label}</span>
              <span className="map-member-callers">
                {member.callers} {member.callers === 1 ? 'caller' : 'callers'}
              </span>
            </div>
          ))}
          {node.hiddenMembers > 0 && (
            <div className="map-more">and {node.hiddenMembers} more</div>
          )}
        </div>
      )}

      {node.clickable && (
        <span className="map-open">
          Open package <ArrowRightIcon size={10} />
        </span>
      )}
    </Tag>
  );
}

function FunctionNode({
  node,
  onClick,
  onHover,
}: {
  node: PlacedNode;
  onClick(): void;
  onHover(node: PlacedNode | null): void;
}) {
  const Tag = node.clickable ? 'button' : 'div';
  return (
    <Tag
      className={[
        'map-node',
        node.changed ? 'is-changed' : '',
        node.changed ? `heat-card-${node.heat}` : '',
        node.kind === 'folded' ? 'is-folded' : '',
        node.clickable ? 'is-clickable' : '',
      ]
        .filter(Boolean)
        .join(' ')}
      style={{ left: node.x, top: node.y, width: node.width, height: node.height }}
      onClick={node.clickable ? onClick : undefined}
      onMouseEnter={() => onHover(node)}
      onMouseLeave={() => onHover(null)}
      title={node.title}
    >
      {node.changed && node.heat !== 'low' && (
        <span className={`rail-dot rail-dot-${node.heat}`} title={`${node.heat} risk`} />
      )}
      <span className="map-node-label">{node.label}</span>
    </Tag>
  );
}

export function MapView({ graph, status, prNumber, heatOfHunks, onJumpToHunk }: Props) {
  const [level, setLevel] = useState<Level>({ kind: 'packages' });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hovered, setHovered] = useState<PlacedNode | null>(null);
  const [panning, setPanning] = useState(false);
  const dragFrom = useRef<{ x: number; y: number } | null>(null);
  const travelled = useRef(0);
  const canvas = useRef<HTMLDivElement>(null);

  const ready = status.state === 'ready' && graph.nodes.length > 0;
  const openPackage =
    level.kind === 'package' ? graph.nodes.find((n) => n.id === level.id) : null;

  const laid: MapLayout | null = useMemo(() => {
    if (!ready) return null;
    return openPackage === null || openPackage === undefined
      ? packageLevel(graph, heatOfHunks)
      : functionLevel(graph, openPackage.id, heatOfHunks);
  }, [ready, graph, heatOfHunks, openPackage]);

  const fit = useCallback(() => {
    const box = canvas.current?.getBoundingClientRect();
    if (!box || !laid || laid.width === 0 || laid.height === 0) return;
    const k = clamp(
      Math.min(box.width / laid.width, box.height / laid.height),
      MIN_ZOOM,
      FIT_ZOOM,
    );
    // A wide, shallow graph centred vertically floats in a field of white, so
    // anything shorter than the canvas is anchored near the top instead.
    setView({
      x: (box.width - laid.width * k) / 2,
      y: Math.min((box.height - laid.height * k) / 2, TOP_MARGIN),
      k,
    });
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
      <MapMessage>
        <SpinnerIcon size={20} />
        <h2>Building the call graph</h2>
        <p className="empty">This can take up to a minute on a large repository.</p>
      </MapMessage>
    );
  }

  if (status.state === 'failed') {
    return (
      <MapMessage>
        <WarnIcon size={20} className="map-message-warn" />
        <h2>The call graph could not be built</h2>
        <p>{status.message ?? 'No message given.'}</p>
        <p className="empty">
          Re-run from the terminal with <code>review {prNumber} --graph</code>.
        </p>
      </MapMessage>
    );
  }

  if (laid === null || laid.nodes.length === 0) {
    return (
      <MapMessage>
        <h2>
          {graph.nodes.length === 0
            ? 'Nothing to map'
            : 'This package has no changed function'}
        </h2>
        <p className="empty">
          {graph.nodes.length === 0
            ? 'The analyzer found no call graph nodes for this PR.'
            : 'Its changed hunks are outside any function the analyzer tracks.'}
        </p>
        {level.kind === 'package' && (
          <button className="btn btn-small" onClick={() => setLevel({ kind: 'packages' })}>
            <ChevronLeftIcon size={11} /> Back to all packages
          </button>
        )}
      </MapMessage>
    );
  }

  const packages = level.kind === 'packages';
  const counts = laid.counts;
  const hoverAt =
    hovered === null
      ? null
      : {
          left: hovered.x * view.k + view.x,
          top: (hovered.y + hovered.height) * view.k + view.y + 8,
        };

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
              <ChevronRightIcon size={10} />
              <strong title={openPackage?.label}>{openPackage?.label}</strong>
            </>
          )}
        </span>
        <span className="map-count">
          {packages
            ? `· ${counts.nodes} packages touched, ${counts.neighbours} with no changed function of their own`
            : `· level 2 · ${counts.changedFunctions}${
                counts.hiddenFunctions > 0
                  ? ` of ${counts.changedFunctions + counts.hiddenFunctions}`
                  : ''
              } changed, ${counts.neighbours} callers and callees shown${
                counts.folded > 0 ? `, ${counts.folded} folded` : ''
              }`}
        </span>
        <div className="map-legend">
          {packages ? (
            <>
              <span className="legend-item">
                <span className="legend-swatch is-high" /> changed, high
              </span>
              <span className="legend-item">
                <span className="legend-swatch is-medium" /> changed, medium
              </span>
              <span className="legend-item">
                <span className="legend-swatch is-muted" /> unchanged caller
              </span>
              <span className="legend-item">
                <span className="legend-line" /> calls, thicker = more
              </span>
            </>
          ) : (
            <>
              <span className="legend-item">
                <span className="legend-swatch is-high" /> changed in this PR
              </span>
              <span className="legend-item">
                <span className="legend-swatch" /> unchanged caller or callee
              </span>
              <span className="legend-item">
                <span className="legend-swatch is-muted" /> counted, not drawn
              </span>
            </>
          )}
          {!packages && (
            <button className="btn btn-small" onClick={() => setLevel({ kind: 'packages' })}>
              <ChevronLeftIcon size={11} /> Back
            </button>
          )}
          <button className="btn btn-small" onClick={fit}>
            Fit
          </button>
        </div>
      </div>

      {packages && graph.truncated && (
        <div className="banner">
          <WarnIcon size={13} />
          <span>
            Some packages have more callers than the map draws. Open one to see how many were
            folded into it.
          </span>
        </div>
      )}

      <div
        className={`map-canvas${panning ? ' is-panning' : ''}`}
        ref={canvas}
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragFrom.current = { x: e.clientX - view.x, y: e.clientY - view.y };
          travelled.current = 0;
          setPanning(true);
        }}
        onPointerMove={(e) => {
          const from = dragFrom.current;
          if (from === null) return;
          travelled.current += Math.abs(e.movementX) + Math.abs(e.movementY);
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
        onClickCapture={(e) => {
          if (travelled.current > CLICK_SLOP) e.stopPropagation();
        }}
        onDoubleClick={fit}
      >
        <div
          className="map-scene"
          style={{
            width: laid.width,
            height: laid.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          }}
        >
          <svg
            className={`map-edges${packages ? '' : ' is-dense'}`}
            width={laid.width}
            height={laid.height}
            fill="none"
          >
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
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--fg-subtle)" />
              </marker>
            </defs>
            {laid.edges.map((edge) => (
              <polyline
                key={edge.key}
                points={edge.points.map((p) => `${p.x},${p.y}`).join(' ')}
                stroke="var(--fg-subtle)"
                strokeWidth={edge.width}
                strokeDasharray={edge.folded ? '4 4' : undefined}
                markerEnd="url(#arrow-calls)"
              />
            ))}
          </svg>

          {laid.boxes.map((box) => (
            <div
              className="map-box"
              key={box.id}
              style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
            >
              <span className="map-box-label" title={box.title}>
                {box.label}
              </span>
            </div>
          ))}

          {laid.nodes.map((node) =>
            node.kind === 'package' ? (
              <PackageCard
                key={node.id}
                node={node}
                open={false}
                onOpen={() => setLevel({ kind: 'package', id: node.id })}
                onHover={setHovered}
              />
            ) : (
              <FunctionNode
                key={node.id}
                node={node}
                onClick={() => {
                  const first = node.hunkIds[0];
                  if (first !== undefined) onJumpToHunk(first);
                }}
                onHover={setHovered}
              />
            ),
          )}
        </div>

        {hovered && hoverAt && (
          <div className="map-hover" style={{ left: hoverAt.left, top: hoverAt.top }}>
            <div className="map-hover-title">{hovered.title}</div>
            {hovered.kind === 'package' ? (
              <>
                <span>
                  {hovered.changedFunctions} changed · {hovered.fanIn} calls in ·{' '}
                  {hovered.fanOut} calls out
                  {hovered.foldedNeighbours > 0 && ` · ${hovered.foldedNeighbours} callers folded`}
                </span>
                <span>
                  {hovered.clickable
                    ? 'Click to see its functions. A changed function jumps to its diff.'
                    : 'No changed function of its own, so it does not open.'}
                </span>
              </>
            ) : hovered.kind === 'folded' ? (
              <span>Counted on the package node instead of drawn.</span>
            ) : (
              <>
                <span>
                  fan-in {hovered.fanIn} · fan-out {hovered.fanOut}
                </span>
                <span>
                  {hovered.changed
                    ? `${hovered.heat} risk · click to open its diff`
                    : 'unchanged'}
                </span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
