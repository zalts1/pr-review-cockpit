export const SCHEMA_VERSION = '1.1.0';

export const SUPPORTED_SCHEMA_MAJOR = 1;

export interface VersionCheck {
  ok: boolean;
  documentVersion: string;
  documentMajor: number | null;
  supportedMajor: number;
}

export function majorOf(version: string): number | null {
  const match = /^(\d+)\.\d+\.\d+$/.exec(version.trim());
  return match ? Number(match[1]) : null;
}

export function checkVersion(doc: { schemaVersion: string }): VersionCheck {
  const documentMajor = majorOf(doc.schemaVersion);
  return {
    ok: documentMajor === SUPPORTED_SCHEMA_MAJOR,
    documentVersion: doc.schemaVersion,
    documentMajor,
    supportedMajor: SUPPORTED_SCHEMA_MAJOR,
  };
}
