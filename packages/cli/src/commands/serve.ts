import { existsSync } from 'node:fs';
import { documentFile, prDir, resolveRef, run } from '@review-cockpit/analyzer';
import { startServer } from '@review-cockpit/server';

export interface ServeFlags {
  cwd: string;
  port?: number;
  open: boolean;
}

export async function serveCommand(prArg: string, flags: ServeFlags): Promise<number> {
  const ref = resolveRef(prArg, flags.cwd);
  const directory = prDir(ref);
  const document = documentFile(ref);

  const server = await startServer({ prDir: directory, ...(flags.port === undefined ? {} : { port: flags.port }) });

  console.error(`[serve] ${ref.owner}/${ref.repo}#${ref.number} from ${directory}`);
  if (!existsSync(document)) {
    console.error('[serve] no review.json yet: run cockpit analyze, the page picks it up on its own');
  }
  console.log(server.url);

  if (flags.open) run('open', [server.url]);

  const stop = (): void => {
    void server.close().then(() => process.exit(0));
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);

  await new Promise<void>(() => {});
  return 0;
}
