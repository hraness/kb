/** Offline validation; throws for altered or unowned files and returns the admitted inventory. */
export interface MarketingSnapshot {
  readonly schemaVersion: 1;
  readonly contractVersion: 1;
  readonly source: {
    readonly repository: "https://github.com/hraness/design-kit";
    readonly commit: string;
    readonly export: "@hraness/design-kit/product-marketing-preset.css";
  };
  readonly files: Readonly<Record<string, { readonly path: string; readonly sha256: string }>>;
}
export function checkMarketingSnapshot(directory?: string): Promise<MarketingSnapshot>;
