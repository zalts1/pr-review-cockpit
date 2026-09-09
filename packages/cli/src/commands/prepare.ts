import { prepare } from '@review-cockpit/analyzer';
import { progress } from '../progress.js';

export function prepareCommand(prArg: string, cwd: string): number {
  const step = progress('prepare');
  const result = prepare(prArg, cwd, step);

  console.log(
    JSON.stringify(
      {
        pr: {
          owner: result.ref.owner,
          repo: result.ref.repo,
          number: result.ref.number,
          url: result.pr.url,
          title: result.pr.title,
          author: result.pr.author,
          draft: result.pr.draft,
          base: result.pr.base,
          head: result.pr.head,
          changedFiles: result.pr.changedFiles,
        },
        checkout: result.checkout,
        document: result.documentPath,
      },
      null,
      2,
    ),
  );
  return 0;
}
