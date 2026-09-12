/** Finite, asset-free portable presentation contract. */
export const lanternSnapshotPaths: Readonly<{
  "lantern-material.css": "src/lantern-material.css";
  "check.mjs": "scripts/check-lantern-material-snapshot.mjs";
  "check.d.mts": "scripts/check-lantern-material-snapshot.d.mts";
  LICENSE: "LICENSE";
}>;
export type LanternSnapshotArtifact = keyof typeof lanternSnapshotPaths;
export const lanternSnapshotFileLimits: Readonly<Record<LanternSnapshotArtifact, number>>;
export interface LanternMaterialSnapshot {
  readonly schemaVersion: 1;
  readonly contractVersion: 1;
  readonly source: {
    readonly repository: "https://github.com/hraness/design-kit";
    readonly commit: string;
    readonly export: "@hraness/design-kit/lantern-material.css";
  };
  readonly files: Readonly<Record<LanternSnapshotArtifact, {
    readonly path: string;
    readonly sha256: string;
  }>>;
}
export function createLanternMaterialSnapshot(commit: string, files: Readonly<Record<LanternSnapshotArtifact, Uint8Array>>): LanternMaterialSnapshot;
export function parseLanternMaterialSnapshot(value: unknown): LanternMaterialSnapshot;
/** Offline byte/provenance consistency check. This does not authenticate a GitHub release. */
export function checkLanternMaterialSnapshot(directory?: string): Promise<LanternMaterialSnapshot>;
