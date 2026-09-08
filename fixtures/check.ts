import { readFileSync, readdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type {
  Hunk,
  ReviewDocument,
  RiskLevel,
  SectionName,
} from '../packages/cockpit/src/types.ts';

const here = dirname(fileURLToPath(import.meta.url));
const rank: Record<RiskLevel, number> = { low: 0, medium: 1, high: 2 };

const failures: string[] = [];

function check(name: string, condition: boolean, message: string): void {
  if (!condition) failures.push(`${name}: ${message}`);
}

function checkHunkLines(name: string, filePath: string, h: Hunk): void {
  const context = h.lines.filter((l) => l.type === 'context').length;
  const adds = h.lines.filter((l) => l.type === 'add').length;
  const dels = h.lines.filter((l) => l.type === 'del').length;

  check(
    name,
    h.oldLines === context + dels,
    `${filePath} ${h.id}: oldLines ${h.oldLines} but ${context + dels} old-side lines`,
  );
  check(
    name,
    h.newLines === context + adds,
    `${filePath} ${h.id}: newLines ${h.newLines} but ${context + adds} new-side lines`,
  );

  let oldNo = h.oldStart;
  let newNo = h.newStart;
  for (const [i, line] of h.lines.entries()) {
    const at = `${filePath} ${h.id} line ${i + 1}`;
    if (line.type === 'add') {
      check(name, line.oldNo === null, `${at}: an add line carries oldNo ${line.oldNo}`);
      check(name, line.newNo === newNo, `${at}: newNo ${line.newNo}, expected ${newNo}`);
      newNo += 1;
    } else if (line.type === 'del') {
      check(name, line.newNo === null, `${at}: a del line carries newNo ${line.newNo}`);
      check(name, line.oldNo === oldNo, `${at}: oldNo ${line.oldNo}, expected ${oldNo}`);
      oldNo += 1;
    } else {
      check(name, line.oldNo === oldNo, `${at}: oldNo ${line.oldNo}, expected ${oldNo}`);
      check(name, line.newNo === newNo, `${at}: newNo ${line.newNo}, expected ${newNo}`);
      oldNo += 1;
      newNo += 1;
    }
  }
}

function checkDocument(name: string, doc: ReviewDocument): void {
  check(name, /^1\./.test(doc.schemaVersion), `schemaVersion ${doc.schemaVersion} is not 1.x`);
  check(
    name,
    /^[0-9a-f]{40}$/.test(doc.pr.head.sha),
    `pr.head.sha is not 40 hex characters: ${doc.pr.head.sha}`,
  );
  check(
    name,
    doc.pr.changedFiles === doc.files.length,
    `pr.changedFiles ${doc.pr.changedFiles} but ${doc.files.length} files`,
  );

  const sections: SectionName[] = [
    'files',
    'comments',
    'checks',
    'groups',
    'path',
    'summary',
    'graph',
  ];
  for (const section of sections) {
    const status = doc.status[section];
    check(name, status !== undefined, `status.${section} is missing`);
    if (status?.state === 'failed') {
      check(name, !!status.message, `status.${section} is failed with no message`);
    }
  }

  const hunks = new Map<string, Hunk>();
  const hunkFile = new Map<string, string>();
  let additions = 0;
  let deletions = 0;

  for (const file of doc.files) {
    let fileAdds = 0;
    let fileDels = 0;
    for (const [i, h] of file.hunks.entries()) {
      check(
        name,
        h.id === `${file.id}.h${i + 1}`,
        `${file.path}: hunk id ${h.id}, expected ${file.id}.h${i + 1}`,
      );
      check(name, !hunks.has(h.id), `duplicate hunk id ${h.id}`);
      hunks.set(h.id, h);
      hunkFile.set(h.id, file.path);
      checkHunkLines(name, file.path, h);
      check(
        name,
        rank[h.risk.level] >= rank[h.risk.floor],
        `${h.id}: level ${h.risk.level} is below floor ${h.risk.floor}`,
      );
      check(
        name,
        h.risk.mode === (h.risk.level === 'low' ? 'skim' : 'scrutinize'),
        `${h.id}: mode ${h.risk.mode} does not follow level ${h.risk.level}`,
      );
      if (h.risk.level === 'high') {
        check(name, !!h.risk.reason, `${h.id} is high risk with no reason`);
      }
      if (h.risk.adjustedBy) {
        check(
          name,
          h.risk.adjustedBy.to === h.risk.level && h.risk.adjustedBy.from === h.risk.floor,
          `${h.id}: adjustedBy ${h.risk.adjustedBy.from}->${h.risk.adjustedBy.to} does not match floor ${h.risk.floor} and level ${h.risk.level}`,
        );
      }
      fileAdds += h.lines.filter((l) => l.type === 'add').length;
      fileDels += h.lines.filter((l) => l.type === 'del').length;
    }
    check(
      name,
      file.additions === fileAdds,
      `${file.path}: additions ${file.additions} but ${fileAdds} add lines`,
    );
    check(
      name,
      file.deletions === fileDels,
      `${file.path}: deletions ${file.deletions} but ${fileDels} del lines`,
    );
    additions += fileAdds;
    deletions += fileDels;
  }

  check(
    name,
    doc.pr.additions === additions,
    `pr.additions ${doc.pr.additions} but ${additions} add lines`,
  );
  check(
    name,
    doc.pr.deletions === deletions,
    `pr.deletions ${doc.pr.deletions} but ${deletions} del lines`,
  );

  for (const c of doc.comments) {
    if (c.hunkId === null) continue;
    const h = hunks.get(c.hunkId);
    check(name, h !== undefined, `comment ${c.id} references unknown hunk ${c.hunkId}`);
    if (!h) continue;
    check(
      name,
      hunkFile.get(c.hunkId) === c.path,
      `comment ${c.id} is on ${c.path} but ${c.hunkId} belongs to ${hunkFile.get(c.hunkId)}`,
    );
    const numbers = h.lines
      .map((l) => (c.side === 'RIGHT' ? l.newNo : l.oldNo))
      .filter((n): n is number => n !== null);
    check(
      name,
      numbers.includes(c.line),
      `comment ${c.id} is on ${c.side} line ${c.line}, which is not in ${c.hunkId}`,
    );
  }

  const grouped = new Set<string>();
  for (const group of doc.groups) {
    for (const id of group.hunkIds) {
      const h = hunks.get(id);
      check(name, h !== undefined, `group ${group.id} references unknown hunk ${id}`);
      check(name, !grouped.has(id), `hunk ${id} appears in more than one group`);
      grouped.add(id);
      if (group.mode === 'skim' && h) {
        check(
          name,
          h.risk.floor !== 'high',
          `skim group ${group.id} contains ${id}, whose floor is high`,
        );
      }
    }
  }

  const walked = new Map<string, number>();
  for (const [i, step] of doc.path.entries()) {
    check(name, step.step === i + 1, `path entry ${i + 1} has step ${step.step}`);
    if (step.ref.kind === 'hunk') {
      check(
        name,
        hunks.has(step.ref.id),
        `path step ${step.step} references unknown hunk ${step.ref.id}`,
      );
      check(
        name,
        !grouped.has(step.ref.id),
        `path step ${step.step} walks ${step.ref.id}, which is inside a group`,
      );
    } else {
      check(
        name,
        doc.groups.some((g) => g.id === step.ref.id),
        `path step ${step.step} references unknown group ${step.ref.id}`,
      );
    }
    walked.set(step.ref.id, (walked.get(step.ref.id) ?? 0) + 1);
  }
  for (const [id, count] of walked) {
    check(name, count === 1, `${id} appears ${count} times in path`);
  }

  if (doc.status.path.state === 'ready') {
    const ungrouped = [...hunks.keys()].filter((id) => !grouped.has(id));
    for (const id of ungrouped) {
      check(name, walked.has(id), `hunk ${id} is not in any group and not in path`);
    }
    for (const group of doc.groups) {
      check(
        name,
        walked.has(group.id) || group.kind === 'generated',
        `group ${group.id} is not in path`,
      );
    }
  }

  const nodeIds = new Set(doc.graph.nodes.map((n) => n.id));
  for (const node of doc.graph.nodes) {
    for (const id of node.hunkIds) {
      check(name, hunks.has(id), `graph node ${node.id} references unknown hunk ${id}`);
    }
    check(
      name,
      node.changed === (node.hunkIds.length > 0),
      `graph node ${node.id} is changed=${node.changed} with ${node.hunkIds.length} hunks`,
    );
  }
  for (const edge of doc.graph.edges) {
    check(name, nodeIds.has(edge.from), `graph edge from unknown node ${edge.from}`);
    check(name, nodeIds.has(edge.to), `graph edge to unknown node ${edge.to}`);
  }

  if (doc.status.summary.state === 'ready' && 'counts' in doc.summary) {
    const counts = doc.summary.counts;
    const all = [...hunks.values()];
    check(name, counts.hunks === all.length, `summary counts.hunks ${counts.hunks} but ${all.length} hunks`);
    const high = all.filter((h) => h.risk.level === 'high').length;
    check(name, counts.highRisk === high, `summary counts.highRisk ${counts.highRisk} but ${high} high hunks`);
    const skimmable = all.filter((h) => h.risk.mode === 'skim').length;
    check(
      name,
      counts.skimmable === skimmable,
      `summary counts.skimmable ${counts.skimmable} but ${skimmable} skim hunks`,
    );
  }

  const diffLines = [...hunks.values()].reduce((n, h) => n + h.lines.length, 0);
  console.log(
    `${name}: ${doc.files.length} files, ${hunks.size} hunks, ${diffLines} diff lines, ${doc.path.length} path steps, ${doc.graph.nodes.length} graph nodes`,
  );
}

const fixtures = readdirSync(here)
  .filter((f) => f.endsWith('.json'))
  .sort();

for (const file of fixtures) {
  const doc = JSON.parse(readFileSync(resolve(here, file), 'utf8')) as ReviewDocument;
  checkDocument(file, doc);
}

if (failures.length > 0) {
  console.error(`\n${failures.length} problem(s):`);
  for (const f of failures) console.error(`  ${f}`);
  process.exit(1);
}
console.log(`\n${fixtures.length} fixture(s) consistent`);
