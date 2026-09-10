import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Group, Hunk, ReviewDocument, ReviewFile } from '@review-cockpit/schema';
import { checkVersion } from '@review-cockpit/schema/version';
import { derive, pendingLabel } from './lib/derive';
import {
  askClaudePrompt,
  heatOf,
  highRiskAhead,
  nextStepLabel,
  phaseProgress,
  reviewOrder,
  skippableHunkCount,
} from './lib/plan';
import type { RailEntry } from './lib/plan';
import { copyText } from './lib/clipboard';
import {
  documentSource,
  documentUrlOf,
  storageSourceOf,
  useDocumentSource,
} from './lib/documentSource';
import type { CockpitDraft } from './lib/drafts';
import { draftsFileOf, draftsKey, loadDrafts, saveDrafts } from './lib/drafts';
import type { DragRange, EditorTarget, LineTarget } from './lib/interaction';
import { editorTargetFromDrag } from './lib/interaction';
import { DiffFile } from './components/DiffFile';
import { GroupHeader } from './components/GroupHeader';
import { Header } from './components/Header';
import type { Tab } from './components/Header';
import type { DiffHandlers } from './components/Hunk';
import { SpinnerIcon, WarnIcon } from './components/Icons';
import { KeyboardHelp } from './components/KeyboardHelp';
import { MapView } from './components/MapView';
import { PlanStrip } from './components/PlanStrip';
import { Rail } from './components/Rail';
import { StatusBanner } from './components/StatusBanner';
import { StepCard } from './components/StepCard';
import { SubmitModal } from './components/SubmitModal';
import type { Verdict } from './components/SubmitModal';

const fixture = documentSource.mode === 'fixture' ? documentSource.fixture : null;

export function App() {
  const { load, disconnected } = useDocumentSource(documentSource);

  if (load.kind === 'loading') {
    return (
      <div className="centered">
        <div className="centered-card">
          <SpinnerIcon size={22} />
          <h1>Loading the review document</h1>
          <p className="empty">
            {fixture !== null ? (
              <>
                Fixture <code>{fixture}</code>
              </>
            ) : (
              <>
                From the local server at <code>{documentUrlOf(documentSource)}</code>
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="centered">
        <div className="centered-card is-warn">
          <WarnIcon size={22} />
          <h1>The review document could not be loaded</h1>
          <p>{load.message}</p>
          <p className="empty">
            {fixture !== null ? (
              <>
                Pick a fixture with <code>?fixture=pr-fake-1</code>.
              </>
            ) : (
              <>
                The analysis may still be running. This page loads the document as soon as the
                server has it.
              </>
            )}
          </p>
        </div>
      </div>
    );
  }

  const version = checkVersion(load.doc);
  if (!version.ok) {
    return (
      <div className="centered">
        <div className="centered-card is-warn">
          <WarnIcon size={22} />
          <h1>This document has an unsupported schema version</h1>
          <p>
            The document is <code>{version.documentVersion}</code>. This cockpit renders{' '}
            <code>{version.supportedMajor}.x</code> documents only.
          </p>
          <p className="empty">
            A major version means a field changed meaning, so rendering it could show the wrong
            diff. Re-run the analyzer to get a current document.
          </p>
        </div>
      </div>
    );
  }

  return <Cockpit doc={load.doc} disconnected={disconnected} />;
}

interface CockpitProps {
  doc: ReviewDocument;
  disconnected: boolean;
}

type PaneItem =
  | { kind: 'file'; id: string; file: ReviewFile; hunks: Hunk[]; step: number | null }
  | {
      kind: 'group';
      id: string;
      group: Group;
      entries: Array<{ file: ReviewFile; hunks: Hunk[] }>;
      step: number | null;
    };

export function Cockpit({ doc, disconnected }: CockpitProps) {
  const derived = useMemo(() => derive(doc), [doc]);
  const order = useMemo(() => reviewOrder(derived), [derived]);
  const storageKey = draftsKey(doc.pr, storageSourceOf(documentSource));

  const seedExpanded = useMemo(
    () => doc.groups.filter((g) => !g.collapsedByDefault).map((g) => g.id),
    [doc.groups],
  );

  const [tab, setTab] = useState<Tab>('files');
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [openedByHand, setOpenedByHand] = useState<Set<string>>(new Set());
  const [closedByHand, setClosedByHand] = useState<Set<string>>(new Set());
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(() => new Set(seedExpanded));
  const [stepIndex, setStepIndex] = useState(0);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  // Open on load when there is a brief to read. With stage 2 still pending the
  // detail is only the raw PR description, which is not worth the whole strip.
  const [planOpen, setPlanOpen] = useState(() => derived.summary !== null);
  const planAutoCollapse = useRef<'armed' | 'spent' | 'user'>('armed');
  const collapsePlan = useCallback(() => {
    if (planAutoCollapse.current !== 'armed') return;
    planAutoCollapse.current = 'spent';
    setPlanOpen(false);
  }, []);
  const [drafts, setDrafts] = useState<CockpitDraft[]>(() => loadDrafts(storageKey));
  const [editor, setEditor] = useState<EditorTarget | null>(null);
  const [drag, setDrag] = useState<DragRange | null>(null);
  const [hoveredLine, setHoveredLine] = useState<LineTarget | null>(null);
  const [hoveredGroup, setHoveredGroup] = useState<string | null>(null);
  const [expandedComments, setExpandedComments] = useState<Set<string>>(new Set());
  const [flashed, setFlashed] = useState<string | null>(null);
  const [pendingScroll, setPendingScroll] = useState<string | null>(null);
  const [submitOpen, setSubmitOpen] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  const paneRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<DragRange | null>(null);
  const hunkEls = useRef(new Map<string, HTMLElement>());
  const fileEls = useRef(new Map<string, HTMLElement>());
  const groupEls = useRef(new Map<string, HTMLElement>());
  const seededExpanded = useRef(new Set(seedExpanded));
  const stepId = useRef<string | null>(null);

  // The analyzer rewrites the document under a live cockpit, so each id is seeded once:
  // folding the whole seed back in would undo every fold the reviewer has toggled since.
  useEffect(() => {
    const added = seedExpanded.filter((id) => !seededExpanded.current.has(id));
    if (added.length === 0) return;
    for (const id of added) seededExpanded.current.add(id);
    setExpandedGroups((current) => new Set([...current, ...added]));
  }, [seedExpanded]);

  // A new walkthrough puts the same hunk at a different index, so the step follows its id.
  // A rewritten path can also fold that hunk into a group step, or split the group the
  // reviewer was on back into hunks, and then the nearest step carrying it takes over.
  useEffect(() => {
    const id = stepId.current;
    if (id === null) return;
    const at = derived.steps.findIndex((step) => step.ref.id === id);
    if (at >= 0) {
      setStepIndex(at);
      return;
    }
    const groupId = derived.groupOfHunk.get(id)?.id;
    const hunkIds = derived.groupById.get(id)?.hunkIds ?? [];
    const nearest = derived.steps.findIndex(
      (step) => step.ref.id === groupId || hunkIds.includes(step.ref.id),
    );
    setStepIndex(Math.max(0, nearest));
    stepId.current = derived.steps[nearest]?.ref.id ?? null;
  }, [derived.steps, derived.groupOfHunk, derived.groupById]);

  useEffect(
    () => saveDrafts(storageKey, draftsFileOf(doc.pr, drafts)),
    [storageKey, doc.pr, drafts],
  );

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 2600);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    if (!flashed) return;
    const timer = window.setTimeout(() => setFlashed(null), 1000);
    return () => window.clearTimeout(timer);
  }, [flashed]);

  const scrollToId = useCallback((id: string) => {
    const pane = paneRef.current;
    const el = hunkEls.current.get(id) ?? groupEls.current.get(id) ?? fileEls.current.get(id);
    if (!pane || !el) return;
    const top =
      el.getBoundingClientRect().top - pane.getBoundingClientRect().top + pane.scrollTop;
    pane.scrollTo({ top: Math.max(0, top - pane.clientHeight / 4), behavior: 'smooth' });
  }, []);

  useEffect(() => {
    if (!pendingScroll) return;
    scrollToId(pendingScroll);
    setPendingScroll(null);
  }, [pendingScroll, scrollToId]);

  useEffect(() => {
    const finish = () => {
      const range = dragRef.current;
      if (!range) return;
      dragRef.current = null;
      setDrag(null);
      setEditor(editorTargetFromDrag(range));
    };
    window.addEventListener('mouseup', finish);
    return () => window.removeEventListener('mouseup', finish);
  }, []);

  const seenHunks = useMemo(() => {
    const all = new Set(seen);
    for (const file of doc.files) {
      if (viewed.has(file.id)) for (const h of file.hunks) all.add(h.id);
    }
    return all;
  }, [seen, viewed, doc.files]);

  const highRemaining = derived.highHunkIds.filter((id) => !seenHunks.has(id)).length;

  const currentStep = derived.steps[stepIndex];
  const targetFileId =
    currentStep?.ref.kind === 'hunk'
      ? (derived.hunkById.get(currentStep.ref.id)?.file.id ?? null)
      : null;
  const targetGroupId = currentStep?.ref.kind === 'group' ? currentStep.ref.id : null;

  const goToStep = useCallback(
    (index: number) => {
      const step = derived.steps[index];
      if (!step) return;
      setTab('files');
      setStepIndex(index);
      stepId.current = step.ref.id;
      collapsePlan();

      if (step.ref.kind === 'hunk') {
        const location = derived.hunkById.get(step.ref.id);
        // The walk opening a file the reviewer had closed by hand is the walk
        // winning: it is the reviewer who asked to go there.
        if (location) {
          setClosedByHand((current) => {
            if (!current.has(location.file.id)) return current;
            const next = new Set(current);
            next.delete(location.file.id);
            return next;
          });
        }
        setSeen((current) => new Set(current).add(step.ref.id));
      } else {
        const group = derived.groupById.get(step.ref.id);
        if (group) {
          setSeen((current) => {
            const next = new Set(current);
            for (const id of group.hunkIds) next.add(id);
            return next;
          });
        }
      }
      setFlashed(step.ref.id);
      setPendingScroll(step.ref.id);
    },
    [derived, collapsePlan],
  );

  const goNext = useCallback(() => {
    if (stepIndex + 1 < derived.steps.length) goToStep(stepIndex + 1);
  }, [goToStep, stepIndex, derived.steps.length]);

  const jumpToHunk = useCallback(
    (hunkId: string) => {
      const stepAt = derived.steps.findIndex(
        (s) => s.ref.kind === 'hunk' && s.ref.id === hunkId,
      );
      if (stepAt >= 0) {
        goToStep(stepAt);
        return;
      }
      const location = derived.hunkById.get(hunkId);
      if (!location) return;
      setTab('files');
      setOpenedByHand((current) => new Set(current).add(location.file.id));
      const group = derived.groupOfHunk.get(hunkId);
      if (group) setExpandedGroups((current) => new Set(current).add(group.id));
      setSeen((current) => new Set(current).add(hunkId));
      setFlashed(hunkId);
      setPendingScroll(hunkId);
    },
    [derived, goToStep],
  );

  const skipToHigh = useCallback(() => {
    const next =
      derived.highHunkIds.find((id) => !seenHunks.has(id)) ?? derived.highHunkIds[0];
    if (next) jumpToHunk(next);
  }, [derived.highHunkIds, seenHunks, jumpToHunk]);

  const toggleViewed = useCallback((fileId: string) => {
    setViewed((current) => {
      const next = new Set(current);
      if (next.has(fileId)) next.delete(fileId);
      else next.add(fileId);
      return next;
    });
  }, []);

  const markReviewed = useCallback(() => {
    if (targetFileId !== null && !viewed.has(targetFileId)) toggleViewed(targetFileId);
    goNext();
  }, [targetFileId, viewed, toggleViewed, goNext]);

  const toggleFile = useCallback(
    (fileId: string, open: boolean) => {
      setOpenedByHand((current) => {
        const next = new Set(current);
        if (open) next.delete(fileId);
        else next.add(fileId);
        return next;
      });
      setClosedByHand((current) => {
        const next = new Set(current);
        if (open) next.add(fileId);
        else next.delete(fileId);
        return next;
      });
      if (!open) setPendingScroll(fileId);
    },
    [],
  );

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const askAbout = useCallback(
    (hunkId: string) => {
      const at = derived.hunkById.get(hunkId);
      if (!at) return;
      const prompt = askClaudePrompt({
        pr: doc.pr,
        checkoutPath: doc.checkout.path,
        file: at.file,
        hunk: at.hunk,
      });
      void copyText(prompt).then((ok) =>
        setToast(ok ? 'Copied' : 'The browser blocked the clipboard'),
      );
    },
    [derived.hunkById, doc.pr, doc.checkout.path],
  );

  const askAboutStep = useCallback(() => {
    if (currentStep?.ref.kind !== 'hunk') return;
    askAbout(currentStep.ref.id);
  }, [currentStep, askAbout]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'TEXTAREA' ||
          target.tagName === 'INPUT' ||
          target.isContentEditable)
      ) {
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case 'n':
          goNext();
          break;
        case 'p':
          if (stepIndex > 0) goToStep(stepIndex - 1);
          break;
        case 'h':
          skipToHigh();
          break;
        case 'v': {
          const fileId = targetFileId ?? hoveredLine?.fileId;
          if (fileId) toggleViewed(fileId);
          break;
        }
        case 'c':
          if (hoveredLine) {
            setEditor({ ...hoveredLine, startLine: null, startSide: null });
          }
          break;
        case 'e': {
          const groupId = hoveredGroup ?? targetGroupId;
          if (groupId) toggleGroup(groupId);
          break;
        }
        case 'a':
          askAboutStep();
          break;
        case 'm':
          setTab((current) => (current === 'files' ? 'map' : 'files'));
          break;
        case '?':
          setHelpOpen(true);
          break;
        case 'Escape':
          setHelpOpen(false);
          setSubmitOpen(false);
          setEditor(null);
          break;
        default:
          return;
      }
      event.preventDefault();
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [
    askAboutStep,
    goNext,
    goToStep,
    hoveredGroup,
    hoveredLine,
    skipToHigh,
    stepIndex,
    targetFileId,
    targetGroupId,
    toggleGroup,
    toggleViewed,
  ]);

  const handlers: DiffHandlers = {
    commentsByHunk: derived.commentsByHunk,
    drafts,
    expandedComments,
    toggleComment: (id) =>
      setExpandedComments((current) => {
        const next = new Set(current);
        if (next.has(id)) next.delete(id);
        else next.add(id);
        return next;
      }),
    editor,
    openEditor: setEditor,
    closeEditor: () => setEditor(null),
    addDraft: (target, body) => {
      const location = derived.hunkById.get(target.hunkId);
      if (!location) return;
      const now = new Date().toISOString();
      setDrafts((current) => [
        ...current,
        {
          id: `d${Date.now()}${current.length}`,
          fileId: location.file.id,
          hunkId: target.hunkId,
          path: target.path,
          side: target.side,
          line: target.line,
          startLine: target.startLine,
          startSide: target.startSide,
          body,
          commitId: doc.pr.head.sha,
          createdAt: now,
          updatedAt: now,
        },
      ]);
      setEditor(null);
    },
    removeDraft: (id) => setDrafts((current) => current.filter((d) => d.id !== id)),
    drag,
    startDrag: (target) => {
      dragRef.current = { start: target, end: target };
      setDrag(dragRef.current);
    },
    extendDrag: (target) => {
      const current = dragRef.current;
      if (!current) return;
      if (current.start.hunkId !== target.hunkId || current.start.side !== target.side) return;
      dragRef.current = { start: current.start, end: target };
      setDrag(dragRef.current);
    },
    hoverLine: (target) => {
      if (target) setHoveredLine(target);
    },
    registerHunk: (id, el) => {
      if (el) hunkEls.current.set(id, el);
      else hunkEls.current.delete(id);
    },
    flashedHunkId: flashed,
  };

  const heatOfHunks = useCallback(
    (hunkIds: string[]) => heatOf(derived, hunkIds),
    [derived],
  );

  const stepOf = useMemo(() => {
    const byId = new Map<string, number>();
    for (const entry of order.entries) byId.set(entry.id, entry.step);
    for (const group of order.skippable) {
      if (group.stepIndex !== null) {
        byId.set(group.id, (derived.steps[group.stepIndex]?.step ?? 0) || 0);
      }
    }
    return byId;
  }, [order, derived.steps]);

  // The pane follows the rail, so the two lists never disagree about where a
  // file sits; anything the walk never reaches falls in after it, in file order.
  const paneItems = useMemo<PaneItem[]>(() => {
    const standalone = new Map(
      derived.standaloneFiles.map((entry) => [entry.file.id, entry] as const),
    );
    const groupEntry = (group: Group): PaneItem => ({
      kind: 'group',
      id: group.id,
      group,
      entries: derived.groupFiles.get(group.id) ?? [],
      step: stepOf.get(group.id) ?? null,
    });

    const items: PaneItem[] = [];
    const placed = new Set<string>();
    for (const entry of order.entries) {
      if (entry.kind === 'file') {
        const at = standalone.get(entry.fileId);
        if (at === undefined || placed.has(entry.fileId)) continue;
        placed.add(entry.fileId);
        items.push({
          kind: 'file',
          id: at.file.id,
          file: at.file,
          hunks: at.hunks,
          step: entry.step,
        });
        continue;
      }
      const group = derived.groupById.get(entry.groupId);
      if (group === undefined || placed.has(group.id)) continue;
      placed.add(group.id);
      items.push(groupEntry(group));
    }
    for (const at of derived.standaloneFiles) {
      if (placed.has(at.file.id)) continue;
      placed.add(at.file.id);
      items.push({
        kind: 'file',
        id: at.file.id,
        file: at.file,
        hunks: at.hunks,
        step: stepOf.get(at.file.id) ?? null,
      });
    }
    for (const skip of order.skippable) {
      const group = derived.groupById.get(skip.id);
      if (group === undefined || placed.has(group.id)) continue;
      placed.add(group.id);
      items.push(groupEntry(group));
    }
    return items;
  }, [derived, order, stepOf]);

  const isOpen = (fileId: string): boolean =>
    openedByHand.has(fileId) || (fileId === targetFileId && !closedByHand.has(fileId));

  const onlyGenerated =
    doc.files.length > 0 &&
    derived.standaloneFiles.length === 0 &&
    doc.groups.length > 0 &&
    doc.groups.every((group) => group.kind === 'generated');

  const currentFile = targetFileId === null ? null : derived.fileById.get(targetFileId);
  const currentHunk =
    currentStep?.ref.kind === 'hunk' ? derived.hunkById.get(currentStep.ref.id) : undefined;

  return (
    <div className="app">
      {disconnected && (
        <div className="banner-offline" role="alert">
          <WarnIcon size={13} />
          Disconnected from the local server. Drafts are saved locally.
        </div>
      )}

      <Header
        pr={doc.pr}
        checks={doc.checks}
        checksPending={doc.status.checks.state === 'pending'}
        draftCount={drafts.length}
        nextLabel={nextStepLabel(derived, stepIndex)}
        tab={tab}
        onTab={setTab}
        onNext={goNext}
        onSubmit={() => setSubmitOpen(true)}
        onHelp={() => setHelpOpen(true)}
      />

      {tab === 'files' && (
        <PlanStrip
          summary={derived.summary}
          status={doc.status.summary}
          prBody={doc.pr.body}
          phases={phaseProgress(derived.steps, stepIndex)}
          stepIndex={stepIndex}
          stepCount={derived.steps.length}
          highAhead={highRiskAhead(derived, stepIndex)}
          skippable={skippableHunkCount(derived)}
          open={planOpen}
          onToggle={() => {
            planAutoCollapse.current = 'user';
            setPlanOpen((current) => !current);
          }}
        />
      )}

      <div className="main">
        {tab === 'files' ? (
          <>
            <aside className="sidebar">
              <Rail
                entries={order.entries}
                skippable={order.skippable}
                currentIndex={stepIndex}
                currentFileId={targetFileId}
                currentGroupId={targetGroupId}
                viewed={viewed}
                pathPending={
                  doc.status.path.state === 'pending' ? pendingLabel(doc.status.path) : null
                }
                fileCount={doc.files.length}
                outdated={derived.outdatedComments}
                onEntry={(entry: RailEntry) => goToStep(entry.stepIndex)}
                onSkippable={(groupId) => {
                  setExpandedGroups((current) => new Set(current).add(groupId));
                  setFlashed(groupId);
                  setPendingScroll(groupId);
                }}
              />
            </aside>

            <div className="pane-wrap">
              <StatusBanner doc={doc} />

              {currentStep && (
                <StepCard
                  step={currentStep.step}
                  total={derived.steps.length}
                  phase={currentStep.phase}
                  symbol={
                    currentHunk?.hunk.symbols[0] ??
                    derived.groupById.get(currentStep.ref.id)?.title ??
                    null
                  }
                  note={currentStep.note}
                  fileLabel={currentFile?.path ?? currentStep.ref.id}
                  reviewed={targetFileId !== null && viewed.has(targetFileId)}
                  canPrev={stepIndex > 0}
                  canAsk={currentStep.ref.kind === 'hunk'}
                  onPrev={() => goToStep(stepIndex - 1)}
                  onMarkReviewed={markReviewed}
                  onAsk={askAboutStep}
                />
              )}

              <div className="pane" ref={paneRef}>
                {doc.files.length === 0 && (
                  <div className="pane-empty">
                    <h2>No textual changes</h2>
                    <p className="empty">
                      This pull request changes no file content, so there is nothing to read
                      here. The summary above says what it does.
                    </p>
                  </div>
                )}

                {onlyGenerated && (
                  <div className="pane-empty">
                    <h2>Everything here is generated</h2>
                    <p className="empty">
                      Every change in this PR matched a generated-code pattern. Expand the group
                      below to read it anyway.
                    </p>
                  </div>
                )}

                {paneItems.map((item) =>
                  item.kind === 'file' ? (
                    <DiffFile
                      key={item.id}
                      file={item.file}
                      hunks={item.hunks}
                      open={isOpen(item.file.id)}
                      viewed={viewed.has(item.file.id)}
                      current={item.file.id === targetFileId}
                      heat={derived.heatByFile.get(item.file.id) ?? 'low'}
                      step={item.step}
                      handlers={handlers}
                      registerFile={(id, el) => {
                        if (el) fileEls.current.set(id, el);
                        else fileEls.current.delete(id);
                      }}
                      onToggleOpen={() => toggleFile(item.file.id, isOpen(item.file.id))}
                      onToggleViewed={() => toggleViewed(item.file.id)}
                    />
                  ) : (
                    <GroupHeader
                      key={item.id}
                      group={item.group}
                      entries={item.entries}
                      expanded={expandedGroups.has(item.group.id)}
                      isTarget={targetGroupId === item.group.id}
                      flashed={flashed === item.group.id}
                      step={item.step}
                      handlers={handlers}
                      registerGroup={(id, el) => {
                        if (el) groupEls.current.set(id, el);
                        else groupEls.current.delete(id);
                      }}
                      onToggle={() => toggleGroup(item.group.id)}
                      onHover={setHoveredGroup}
                    />
                  ),
                )}
              </div>
            </div>
          </>
        ) : (
          <MapView
            graph={doc.graph}
            status={doc.status.graph}
            prNumber={doc.pr.number}
            heatOfHunks={heatOfHunks}
            onJumpToHunk={jumpToHunk}
          />
        )}
      </div>

      {submitOpen && (
        <SubmitModal
          pr={doc.pr}
          drafts={drafts}
          unseenHigh={highRemaining}
          onCancel={() => setSubmitOpen(false)}
          onPost={(verdict: Verdict) => {
            setSubmitOpen(false);
            setToast(`Not connected to GitHub yet (${verdict} with ${drafts.length} comments)`);
          }}
        />
      )}

      {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
