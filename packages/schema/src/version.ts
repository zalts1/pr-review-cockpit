export const SCHEMA_VERSION = '1.3.0';

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

/** NaN for an unparseable version, so a comparison against it is false either way. */
export function minorOf(version: string): number {
  const match = /^\d+\.(\d+)\.\d+$/.exec(version.trim());
  return match ? Number(match[1]) : Number.NaN;
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
