import { existsSync } from 'node:fs';
import { documentFile, prDir, resolveRef, run } from '@review-cockpit/analyzer';
import { DEFAULT_IDLE_MINUTES, readServerFile, serverIsAlive, startServer } from '@review-cockpit/server';

export interface ServeFlags {
  cwd: string;
  port?: number;
  open: boolean;
  idleMinutes?: number;
  sessionId?: string;
}

export async function serveCommand(prArg: string, flags: ServeFlags): Promise<number> {
  const ref = resolveRef(prArg, flags.cwd);
  const directory = prDir(ref);
  const document = documentFile(ref);

  const existing = readServerFile(directory);
  if (existing !== null && serverIsAlive(existing)) {
    console.error(
      `[serve] a server for ${ref.owner}/${ref.repo}#${ref.number} is already running (pid ${existing.pid})`,
    );
    console.log(existing.url);
    if (flags.open) run('open', [existing.url]);
    return 0;
  }

  const idleMinutes = flags.idleMinutes ?? DEFAULT_IDLE_MINUTES;
  const server = await startServer({
    prDir: directory,
    idleMinutes,
    ...(flags.port === undefined ? {} : { port: flags.port }),
    ...(flags.sessionId === undefined ? {} : { sessionId: flags.sessionId }),
  });

  console.error(`[serve] ${ref.owner}/${ref.repo}#${ref.number} from ${directory}`);
  console.error(
    idleMinutes > 0
      ? `[serve] stops itself after ${idleMinutes} minutes with no cockpit connected`
      : '[serve] no idle timeout: it runs until it is stopped',
  );
  if (!existsSync(document)) {
    console.error('[serve] no review.json yet: run cockpit analyze, the page picks it up on its own');
  }
  console.log(server.url);

  if (flags.open) run('open', [server.url]);

  const stop = (): void => {
    void server.stop('stopped').then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await server.idleExit;
  return 0;
}
