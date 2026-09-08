import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReviewDocument, RiskLevel } from './types';
import { SUPPORTED_MAJOR, derive, levelRank, majorOf } from './lib/derive';
import type { Draft } from './lib/drafts';
import { draftsKey, loadDrafts, preview, saveDrafts } from './lib/drafts';
import type { DragRange, EditorTarget, LineTarget } from './lib/interaction';
import { editorTargetFromDrag } from './lib/interaction';
import { AutopilotBar } from './components/AutopilotBar';
import { DiffFile } from './components/DiffFile';
import { FileTree } from './components/FileTree';
import { GroupHeader } from './components/GroupHeader';
import { Header } from './components/Header';
import type { Tab } from './components/Header';
import type { DiffHandlers } from './components/Hunk';
import { KeyboardHelp } from './components/KeyboardHelp';
import { MapView } from './components/MapView';
import { StatusBanner } from './components/StatusBanner';
import { SubmitModal } from './components/SubmitModal';
import type { Verdict } from './components/SubmitModal';
import { SummaryCard } from './components/SummaryCard';

const fixtureName =
  new URLSearchParams(window.location.search).get('fixture') ?? 'pr-fake-1';

type Load =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; doc: ReviewDocument };

export function App() {
  const [load, setLoad] = useState<Load>({ kind: 'loading' });

  useEffect(() => {
    const url = `./fixtures/${fixtureName}.json`;
    fetch(url)
      .then(async (response) => {
        if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
        return (await response.json()) as ReviewDocument;
      })
      .then((doc) => setLoad({ kind: 'ready', doc }))
      .catch((error: unknown) =>
        setLoad({
          kind: 'error',
          message: `${url}: ${error instanceof Error ? error.message : String(error)}`,
        }),
      );
  }, []);

  if (load.kind === 'loading') {
    return (
      <div className="centered">
        <h1>Loading the review document…</h1>
        <p className="empty">
          Fixture <code>{fixtureName}</code>
        </p>
      </div>
    );
  }

  if (load.kind === 'error') {
    return (
      <div className="centered">
        <h1>The review document could not be loaded</h1>
        <p>{load.message}</p>
        <p className="empty">
          Pick a fixture with <code>?fixture=pr-fake-1</code>.
        </p>
      </div>
    );
  }

  const major = majorOf(load.doc.schemaVersion);
  if (major !== SUPPORTED_MAJOR) {
    return (
      <div className="centered">
        <h1>This document has an unsupported schema version</h1>
        <p>
          The document is <code>{load.doc.schemaVersion}</code>. This cockpit renders{' '}
          <code>{SUPPORTED_MAJOR}.x</code> documents only.
        </p>
        <p className="empty">
          A major version means a field changed meaning, so rendering it could show the wrong
          diff. Re-run the analyzer to get a current document.
        </p>
      </div>
    );
  }

  return <Cockpit doc={load.doc} />;
}

export function Cockpit({ doc }: { doc: ReviewDocument }) {
  const derived = useMemo(() => derive(doc), [doc]);
  const storageKey = draftsKey(doc.pr, fixtureName);

  const [tab, setTab] = useState<Tab>('files');
  const [viewed, setViewed] = useState<Set<string>>(new Set());
  const [collapsedFiles, setCollapsedFiles] = useState<Set<string>>(
    () => new Set(doc.files.filter((f) => f.generated.is).map((f) => f.id)),
  );
  const [expandedGroups, setExpandedGroups] = useState<Set<string>>(
    () =>
      new Set(
        doc.groups
          .filter((g) => g.mode === 'scrutinize' || !g.collapsedByDefault)
          .map((g) => g.id),
      ),
  );
  const [stepIndex, setStepIndex] = useState(-1);
  const [seen, setSeen] = useState<Set<string>>(new Set());
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  const [drafts, setDrafts] = useState<Draft[]>(() => loadDrafts(storageKey));
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

  useEffect(() => saveDrafts(storageKey, drafts), [storageKey, drafts]);

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
    pane.scrollTo({ top: Math.max(0, top - pane.clientHeight / 3), behavior: 'smooth' });
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

  const revealFile = useCallback((fileId: string) => {
    setCollapsedFiles((current) => {
      if (!current.has(fileId)) return current;
      const next = new Set(current);
      next.delete(fileId);
      return next;
    });
  }, []);

  const goToStep = useCallback(
    (index: number) => {
      const step = derived.steps[index];
      if (!step) return;
      setTab('files');
      setStepIndex(index);
      setSummaryCollapsed(true);

      if (step.ref.kind === 'hunk') {
        const location = derived.hunkById.get(step.ref.id);
        if (location) revealFile(location.file.id);
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
    [derived, revealFile],
  );

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
      revealFile(location.file.id);
      const group = derived.groupOfHunk.get(hunkId);
      if (group) setExpandedGroups((current) => new Set(current).add(group.id));
      setSeen((current) => new Set(current).add(hunkId));
      setFlashed(hunkId);
      setPendingScroll(hunkId);
    },
    [derived, goToStep, revealFile],
  );

  const skipToHigh = useCallback(() => {
    const next =
      derived.highHunkIds.find((id) => !seenHunks.has(id)) ?? derived.highHunkIds[0];
    if (next) jumpToHunk(next);
  }, [derived.highHunkIds, seenHunks, jumpToHunk]);

  const toggleViewed = useCallback(
    (fileId: string) => {
      setViewed((current) => {
        const next = new Set(current);
        if (next.has(fileId)) next.delete(fileId);
        else next.add(fileId);
        return next;
      });
      setCollapsedFiles((current) => {
        const next = new Set(current);
        if (viewed.has(fileId)) next.delete(fileId);
        else next.add(fileId);
        return next;
      });
    },
    [viewed],
  );

  const toggleGroup = useCallback((groupId: string) => {
    setExpandedGroups((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  }, []);

  const currentStep = derived.steps[stepIndex];
  const targetFileId =
    currentStep?.ref.kind === 'hunk'
      ? (derived.hunkById.get(currentStep.ref.id)?.file.id ?? null)
      : null;
  const targetGroupId = currentStep?.ref.kind === 'group' ? currentStep.ref.id : null;

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
          goToStep(Math.min(stepIndex + 1, derived.steps.length - 1));
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
    derived.steps.length,
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
          createdAt: new Date().toISOString(),
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
    (hunkIds: string[]): RiskLevel => {
      let heat: RiskLevel = 'low';
      for (const id of hunkIds) {
        const level = derived.hunkById.get(id)?.hunk.risk.level;
        if (level && levelRank[level] > levelRank[heat]) heat = level;
      }
      return heat;
    },
    [derived.hunkById],
  );

  const groupEntries = doc.groups.map((group) => ({
    group,
    entries: derived.groupFiles.get(group.id) ?? [],
  }));

  const onlyGenerated =
    doc.files.length > 0 &&
    derived.standaloneFiles.length === 0 &&
    groupEntries.every(({ group }) => group.kind === 'generated');

  return (
    <div className="app">
      <Header
        pr={doc.pr}
        checks={doc.checks}
        checksPending={doc.status.checks.state === 'pending'}
        draftCount={drafts.length}
        tab={tab}
        onTab={setTab}
        onSubmit={() => setSubmitOpen(true)}
        onHelp={() => setHelpOpen(true)}
      />

      <div className="main">
        {tab === 'files' ? (
          <>
            <aside className="sidebar">
              <FileTree
                files={derived.standaloneFiles.map((entry) => entry.file)}
                totalFiles={doc.files.length}
                heatByFile={derived.heatByFile}
                groups={groupEntries.map(({ group, entries }) => ({
                  group,
                  fileCount: entries.length,
                }))}
                groupsPending={doc.status.groups.state === 'pending'}
                viewed={viewed}
                targetFileId={targetFileId}
                targetGroupId={targetGroupId}
                onFile={(fileId) => {
                  revealFile(fileId);
                  setPendingScroll(fileId);
                }}
                onGroup={(groupId) => setPendingScroll(groupId)}
              />

              {derived.outdatedComments.length > 0 && (
                <div className="sidebar-section">
                  <div className="sidebar-title">
                    Outdated comments ({derived.outdatedComments.length})
                  </div>
                  <ul className="outdated">
                    {derived.outdatedComments.map((comment) => (
                      <li key={comment.id}>
                        <span className="outdated-path">
                          {comment.path}:{comment.line} ({comment.side})
                        </span>
                        <span>
                          {comment.author}: “{preview(comment.body, 80)}” ·{' '}
                          <a href={comment.url} target="_blank" rel="noreferrer">
                            GitHub
                          </a>
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
            </aside>

            <div
              className="pane"
              ref={paneRef}
              onScroll={(e) => {
                if (e.currentTarget.scrollTop > 160) setSummaryCollapsed(true);
              }}
            >
              <StatusBanner doc={doc} />

              <SummaryCard
                summary={derived.summary}
                status={doc.status.summary}
                prBody={doc.pr.body}
                collapsed={summaryCollapsed}
                onToggle={() => setSummaryCollapsed((current) => !current)}
              />

              {doc.files.length === 0 && (
                <div className="card file-note">This PR has no textual changes.</div>
              )}

              {onlyGenerated && (
                <div className="card file-note">
                  Every change in this PR matched a generated-code pattern.
                </div>
              )}

              {groupEntries.length > 0 && (
                <div className="groups">
                  {groupEntries.map(({ group, entries }) => (
                    <GroupHeader
                      key={group.id}
                      group={group}
                      entries={entries}
                      expanded={expandedGroups.has(group.id)}
                      isTarget={targetGroupId === group.id}
                      flashed={flashed === group.id}
                      handlers={handlers}
                      registerGroup={(id, el) => {
                        if (el) groupEls.current.set(id, el);
                        else groupEls.current.delete(id);
                      }}
                      onToggle={() => toggleGroup(group.id)}
                      onHover={setHoveredGroup}
                    />
                  ))}
                </div>
              )}

              {derived.standaloneFiles.map(({ file, hunks }) => (
                <DiffFile
                  key={file.id}
                  file={file}
                  hunks={hunks}
                  collapsed={collapsedFiles.has(file.id)}
                  viewed={viewed.has(file.id)}
                  handlers={handlers}
                  registerFile={(id, el) => {
                    if (el) fileEls.current.set(id, el);
                    else fileEls.current.delete(id);
                  }}
                  onToggleCollapsed={() =>
                    setCollapsedFiles((current) => {
                      const next = new Set(current);
                      if (next.has(file.id)) next.delete(file.id);
                      else next.add(file.id);
                      return next;
                    })
                  }
                  onToggleViewed={() => toggleViewed(file.id)}
                  onOverflow={() => setToast('M1: the file menu is a placeholder')}
                />
              ))}
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

      <AutopilotBar
        steps={derived.steps}
        index={stepIndex}
        pathPending={doc.status.path.state === 'pending'}
        stage2Failed={doc.status.path.state === 'failed'}
        totalHigh={derived.highHunkIds.length}
        highRemaining={highRemaining}
        onPrev={() => goToStep(stepIndex - 1)}
        onNext={() => goToStep(Math.min(stepIndex + 1, derived.steps.length - 1))}
        onSkipHigh={skipToHigh}
      />

      {submitOpen && (
        <SubmitModal
          pr={doc.pr}
          drafts={drafts}
          unseenHigh={highRemaining}
          onCancel={() => setSubmitOpen(false)}
          onPost={(verdict: Verdict) => {
            setSubmitOpen(false);
            setToast(`M1: not connected to GitHub (${verdict} with ${drafts.length} comments)`);
          }}
        />
      )}

      {helpOpen && <KeyboardHelp onClose={() => setHelpOpen(false)} />}

      {toast && <div className="toast">{toast}</div>}
    </div>
  );
}
