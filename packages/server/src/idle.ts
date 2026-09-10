/** Long enough that a reviewer who wandered off for a coffee comes back to a live server. */
export const DEFAULT_IDLE_MINUTES = 30;

export interface IdleWatchOptions {
  /** 0 disables the clock: the server then runs until something stops it. */
  idleMinutes: number;
  clients: () => number;
  onIdle: () => void;
  now?: () => number;
}

/**
 * An open cockpit holds an event stream, so zero streams is what "nobody is here" means: a tab
 * left untouched for an hour still counts as present, and a closed tab starts the clock at once.
 */
export class IdleWatch {
  private readonly ms: number;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private armedAt: number | null = null;

  constructor(private readonly options: IdleWatchOptions) {
    this.ms = Math.max(0, options.idleMinutes) * 60_000;
    this.now = options.now ?? Date.now;
  }

  get enabled(): boolean {
    return this.ms > 0;
  }

  /** Seconds with no client attached. Zero while one is. */
  idleSeconds(): number {
    if (this.armedAt === null) return 0;
    return Math.max(0, (this.now() - this.armedAt) / 1000);
  }

  reset(): void {
    this.clear();
    if (!this.enabled || this.options.clients() > 0) return;
    this.armedAt = this.now();
    this.timer = setTimeout(() => {
      this.timer = null;
      this.options.onIdle();
    }, this.ms);
  }

  close(): void {
    this.clear();
  }

  private clear(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.armedAt = null;
  }
}
