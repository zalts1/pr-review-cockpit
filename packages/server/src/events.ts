import { existsSync, watch, type FSWatcher } from 'node:fs';
import type { ServerResponse } from 'node:http';
import { join } from 'node:path';
import { DOCUMENT_FILENAME } from './paths.js';

export const DEFAULT_DEBOUNCE_MS = 100;
export const HEARTBEAT_MS = 20_000;

const DOCUMENT_EVENT = 'data: {"type":"document"}\n\n';
const HEARTBEAT_LINE = ': ping\n\n';

export type ShutdownReason = 'idle' | 'stopped';

function shutdownEvent(reason: ShutdownReason): string {
  return `data: ${JSON.stringify({ type: 'shutdown', reason })}\n\n`;
}

export type Unsubscribe = () => void;

/**
 * Watches the directory rather than the document itself: the analyzer publishes the
 * document by writing a temp file and renaming it over the old one, so a watch bound to
 * the original inode stops reporting changes after the first publish.
 */
export class DocumentWatcher {
  private readonly listeners = new Set<() => void>();
  private watcher: FSWatcher | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly dir: string,
    private readonly basename: string = DOCUMENT_FILENAME,
    private readonly debounceMs: number = DEFAULT_DEBOUNCE_MS,
  ) {}

  subscribe(listener: () => void): Unsubscribe {
    this.listeners.add(listener);
    if (this.watcher === null) this.start();
    return () => {
      this.listeners.delete(listener);
      if (this.listeners.size === 0) this.close();
    };
  }

  close(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    this.watcher?.close();
    this.watcher = null;
  }

  private start(): void {
    let watcher: FSWatcher;
    try {
      watcher = watch(this.dir, { persistent: true });
    } catch {
      return;
    }
    watcher.on('error', () => this.close());
    watcher.on('change', (_event, filename) => {
      if (filename === null || basenameOf(filename) !== this.basename) return;
      this.schedule();
    });
    this.watcher = watcher;
  }

  private schedule(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = setTimeout(() => {
      this.timer = null;
      for (const listener of [...this.listeners]) listener();
    }, this.debounceMs);
  }
}

function basenameOf(filename: string | Buffer): string {
  const text = typeof filename === 'string' ? filename : filename.toString('utf8');
  const cut = text.lastIndexOf('/');
  return cut === -1 ? text : text.slice(cut + 1);
}

export class EventStreamHub {
  private readonly clients = new Set<ServerResponse>();
  private unsubscribe: Unsubscribe | null = null;
  private heartbeat: NodeJS.Timeout | null = null;

  constructor(
    private readonly prDir: string,
    private readonly watcher: DocumentWatcher,
    private readonly onClientsChanged: () => void = () => undefined,
  ) {}

  get size(): number {
    return this.clients.size;
  }

  attach(res: ServerResponse): void {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
    });
    res.flushHeaders();

    this.clients.add(res);
    if (this.clients.size === 1) this.startSources();
    this.onClientsChanged();

    res.on('close', () => this.detach(res));

    if (existsSync(join(this.prDir, DOCUMENT_FILENAME))) res.write(DOCUMENT_EVENT);
  }

  /**
   * The last thing a client hears. Without it a cockpit cannot tell a server that stopped on
   * purpose from a connection that dropped, and shows the wrong banner for the next few tries.
   */
  announceShutdown(reason: ShutdownReason): void {
    this.broadcast(shutdownEvent(reason));
  }

  close(): void {
    for (const client of [...this.clients]) {
      this.clients.delete(client);
      client.end();
    }
    this.stopSources();
  }

  private detach(res: ServerResponse): void {
    if (!this.clients.delete(res)) return;
    if (this.clients.size === 0) this.stopSources();
    this.onClientsChanged();
  }

  private startSources(): void {
    this.unsubscribe = this.watcher.subscribe(() => this.broadcast(DOCUMENT_EVENT));
    this.heartbeat = setInterval(() => this.broadcast(HEARTBEAT_LINE), HEARTBEAT_MS);
  }

  private stopSources(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    if (this.heartbeat !== null) {
      clearInterval(this.heartbeat);
      this.heartbeat = null;
    }
  }

  private broadcast(payload: string): void {
    for (const client of this.clients) client.write(payload);
  }
}
