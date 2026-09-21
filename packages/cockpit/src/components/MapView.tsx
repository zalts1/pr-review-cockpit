import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Graph, RiskLevel, SectionStatus } from '@review-cockpit/schema';
import type { MapLayout, PlacedNode } from '../lib/mapLayout';
import { functionLevel, packageLevel } from '../lib/mapLayout';
import { ArrowRight, ChevronLeft, ChevronRight, Loader2, TriangleAlert } from 'lucide-react';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Callout } from './ui/callout';

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
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex flex-1 items-center justify-center bg-muted p-10">
        <div className="flex max-w-[520px] flex-col items-start gap-2 rounded-lg border border-border bg-card px-6 py-5 text-muted-foreground shadow-xs [&_code]:rounded [&_code]:bg-muted [&_code]:px-1 [&_code]:text-xs [&_h2]:m-0 [&_h2]:text-[15px] [&_h2]:font-semibold [&_h2]:text-foreground [&_p]:m-0 [&_p]:text-[13px] [&_p]:text-foreground">
          {children}
        </div>
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

function heatText(heat: RiskLevel): string {
  if (heat === 'high') return 'font-semibold text-high';
  if (heat === 'medium') return 'font-semibold text-medium';
  return '';
}

function heatWord(node: PlacedNode): string {
  if (node.highFunctions > 0) {
    return `${node.highFunctions} high`;
  }
  return node.changed ? node.heat : 'unchanged';
}

function Legend({ swatch, children }: { swatch: 'high' | 'medium' | 'muted' | 'plain' | 'line'; children: ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap">
      {swatch === 'line' ? (
        <span className="inline-block w-7 border-t-[3px] border-subtle" />
      ) : (
        <span
          className={cn(
            'inline-block size-3 flex-none rounded-[3px] border-2 border-border bg-card',
            swatch === 'high' && 'border-high',
            swatch === 'medium' && 'border-medium',
            swatch === 'muted' && 'border border-dashed border-subtle bg-muted',
          )}
        />
      )}
      {children}
    </span>
  );
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
      <div className="flex gap-2.5 text-[11px] text-muted-foreground">
        <span>{cardMeta(node)}</span>
        {node.changed && <span className={heatText(node.heat)}>{heat}</span>}
      </div>

      {node.members.length > 0 && (
        <div className="mt-0.5 flex flex-col gap-[3px] font-mono text-[11px] leading-snug">
          {node.members.map((member) => (
            <div className="flex justify-between gap-3 whitespace-nowrap" key={member.id}>
              <span className={cn('min-w-0 truncate', heatText(member.heat))}>{member.label}</span>
              <span className="flex-none text-subtle">
                {member.callers} {member.callers === 1 ? 'caller' : 'callers'}
              </span>
            </div>
          ))}
          {node.hiddenMembers > 0 && (
            <div className="text-subtle">and {node.hiddenMembers} more</div>
          )}
        </div>
      )}

      {node.clickable && (
        <span className="inline-flex items-center gap-1 text-[11px] text-link">
          Open package <ArrowRight className="size-2.5" />
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
        <span
          className={cn(
            'size-[7px] flex-none rounded-full',
            node.heat === 'high' ? 'bg-high' : 'border-[1.5px] border-medium',
          )}
          title={`${node.heat} risk`}
        />
      )}
      <span className="truncate">{node.label}</span>
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
        <Loader2 className="size-5 spinner text-link" />
        <h2>Building the call graph</h2>
        <p className="text-muted-foreground!">This can take up to a minute on a large repository.</p>
      </MapMessage>
    );
  }

  if (status.state === 'failed') {
    return (
      <MapMessage>
        <TriangleAlert className="size-5 text-high" />
        <h2>The call graph could not be built</h2>
        <p>{status.message ?? 'No message given.'}</p>
        <p className="text-muted-foreground!">
          Re-run from the terminal with <code>cockpit run {prNumber}</code>.
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
        <p className="text-muted-foreground!">
          {graph.nodes.length === 0
            ? 'The analyzer found no call graph nodes for this PR.'
            : 'Its changed hunks are outside any function the analyzer tracks.'}
        </p>
        {level.kind === 'package' && (
          <Button size="sm" onClick={() => setLevel({ kind: 'packages' })}>
            <ChevronLeft className="size-3" /> Back to all packages
          </Button>
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
    <div className="relative flex min-w-0 flex-1 flex-col">
      <div className="flex flex-none items-center gap-3 border-b border-border bg-muted px-5 py-2 text-xs text-muted-foreground">
        <span className="flex flex-none items-center gap-1.5 [&_strong]:font-mono [&_strong]:text-foreground">
          {packages ? (
            <strong>All packages</strong>
          ) : (
            <>
              <Button variant="link" className="text-xs" onClick={() => setLevel({ kind: 'packages' })}>
                All packages
              </Button>
              <ChevronRight className="size-2.5" />
              <strong title={openPackage?.label}>{openPackage?.label}</strong>
            </>
          )}
        </span>
        <span className="truncate whitespace-nowrap">
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
        <div className="ml-auto flex flex-none items-center gap-3.5">
          {packages ? (
            <>
              <Legend swatch="high">changed, high</Legend>
              <Legend swatch="medium">changed, medium</Legend>
              <Legend swatch="muted">unchanged caller</Legend>
              <Legend swatch="line">calls, thicker = more</Legend>
            </>
          ) : (
            <>
              <Legend swatch="high">changed in this PR</Legend>
              <Legend swatch="plain">unchanged caller or callee</Legend>
              <Legend swatch="muted">counted, not drawn</Legend>
            </>
          )}
          {!packages && (
            <Button size="sm" onClick={() => setLevel({ kind: 'packages' })}>
              <ChevronLeft className="size-3" /> Back
            </Button>
          )}
          <Button size="sm" onClick={fit}>
            Fit
          </Button>
        </div>
      </div>

      {packages && graph.truncated && (
        <Callout className="m-3 mb-0 flex-none">
          <TriangleAlert />
          <span>
            Some packages have more callers than the map draws. Open one to see how many were
            folded into it.
          </span>
        </Callout>
      )}

      <div
        className={cn(
          'relative flex-1 touch-none overflow-hidden bg-card',
          panning ? 'cursor-grabbing' : 'cursor-grab',
        )}
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
          className="absolute top-0 left-0 origin-top-left"
          style={{
            width: laid.width,
            height: laid.height,
            transform: `translate(${view.x}px, ${view.y}px) scale(${view.k})`,
          }}
        >
          {/* Level 2 draws one edge per call, so at a hundred of them the lines
              would read louder than the function names they connect. */}
          <svg
            className={cn(
              'pointer-events-none absolute top-0 left-0 overflow-visible',
              !packages && 'opacity-50',
            )}
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
                <path d="M 0 0 L 10 5 L 0 10 z" fill="var(--subtle)" />
              </marker>
            </defs>
            {laid.edges.map((edge) => (
              <polyline
                key={edge.key}
                points={edge.points.map((p) => `${p.x},${p.y}`).join(' ')}
                stroke="var(--subtle)"
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
              <span
                className="absolute top-1 left-2.5 font-mono text-[11px] leading-tight text-muted-foreground"
                title={box.title}
              >
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
          <div
            className="pointer-events-none absolute z-[6] flex max-w-[320px] flex-col gap-0.5 rounded-md bg-inverse px-2.5 py-2 text-xs text-inverse-foreground shadow-card [&_span]:text-inverse-foreground/70"
            style={{ left: hoverAt.left, top: hoverAt.top }}
          >
            <div className="font-mono font-semibold">{hovered.title}</div>
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
