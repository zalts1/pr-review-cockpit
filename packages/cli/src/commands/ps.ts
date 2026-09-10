import { cacheRoot } from '@review-cockpit/analyzer';
import type { RecordedServer } from '../servers.js';
import { healthOf, identify, recordedServers, target } from '../servers.js';

export interface PsRow {
  target: string;
  port: number;
  pid: number;
  started: string;
  idleFor: string;
  clients: string;
}

const COLUMNS: Array<{ head: string; of: (row: PsRow) => string }> = [
  { head: 'pull request', of: (row) => row.target },
  { head: 'port', of: (row) => String(row.port) },
  { head: 'pid', of: (row) => String(row.pid) },
  { head: 'started', of: (row) => row.started },
  { head: 'idle for', of: (row) => row.idleFor },
  { head: 'clients', of: (row) => row.clients },
];

export async function psRows(root: string = cacheRoot(), at: number = Date.now()): Promise<PsRow[]> {
  const recorded = recordedServers(root);
  const live = await Promise.all(
    recorded.map(async (server) => ((await identify(server.file)) === 'cockpit' ? server : null)),
  );
  return Promise.all(
    live.filter((server): server is RecordedServer => server !== null).map((server) => row(server, at)),
  );
}

export async function psCommand(root?: string): Promise<number> {
  const rows = await psRows(root);
  if (rows.length === 0) {
    console.log('no cockpit server is running');
    return 0;
  }
  console.log(renderPs(rows));
  return 0;
}

export function renderPs(rows: readonly PsRow[]): string {
  const widths = COLUMNS.map((column) =>
    Math.max(column.head.length, ...rows.map((row) => column.of(row).length)),
  );
  const line = (cells: readonly string[]): string =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ').trimEnd();
  return [line(COLUMNS.map((column) => column.head)), ...rows.map((row) => line(COLUMNS.map((column) => column.of(row))))].join(
    '\n',
  );
}

async function row(server: RecordedServer, at: number): Promise<PsRow> {
  const health = await healthOf(server.file.url);
  return {
    target: target(server.ref),
    port: server.file.port,
    pid: server.file.pid,
    started: age(server.file.startedAt, at),
    idleFor: health === null ? '?' : duration(health.idleSeconds),
    clients: health === null ? '?' : String(health.clients),
  };
}

function age(startedAt: string, at: number): string {
  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return '?';
  return `${duration((at - started) / 1000)} ago`;
}

export function duration(seconds: number): string {
  const whole = Math.max(0, Math.round(seconds));
  if (whole < 60) return `${whole}s`;
  const minutes = Math.floor(whole / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, '0')}m`;
}
