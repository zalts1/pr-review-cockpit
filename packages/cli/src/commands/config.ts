import { configFile, readUserConfig } from '@review-cockpit/analyzer';

export const CONFIG_KEYS = ['judgment', 'workspaceRoots'] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export function configCommand(action: string | undefined, key: string | undefined): number {
  if (action !== 'get') {
    console.error(`config takes one action, get. Got "${action ?? 'nothing'}".`);
    return 2;
  }
  if (key === undefined || !CONFIG_KEYS.includes(key as ConfigKey)) {
    console.error(`config get takes one of ${CONFIG_KEYS.join(', ')}. Got "${key ?? 'nothing'}".`);
    return 2;
  }

  const config = readUserConfig();
  console.error(`[config] ${configFile()}`);
  console.log(key === 'workspaceRoots' ? config.workspaceRoots.join('\n') : config.judgment);
  return 0;
}
