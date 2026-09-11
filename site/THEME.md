# Paper theme

The default presentation follows AICharts: warm neutral surfaces, Nebula Sans,
compact headings, hairline rules, and a blue action color. Content, layout,
application state, and domain-specific visualizations remain product-owned.
Saved appearance choices retain their existing storage keys and behavior.

The theme lives in `vendor/paper-theme`. `provenance.json` records
its full immutable source commit and SHA-256 digests. The CSS and license are
unchanged upstream bytes. Local aliases and composition adjustments stay in
product stylesheets. The existing component package pins do not move with a
theme update; no runtime fetch, sibling checkout, or shared release train exists.

Run `bun run check:theme` to verify the snapshot offline. This is also part of
the existing validation gate. To upgrade deliberately, inspect the design-kit
Paper contract and release notes, then run its `scripts/paper-theme-snapshot.ts`
installer with `--write` for each snapshot directory and `--source-commit` set
to the reviewed full commit. Run this repository's normal checks and inspect
its supported desktop/mobile and appearance states. Commit the CSS, license,
and provenance together. Reverting that commit restores the prior theme.

Portable contract 1 keeps existing token names and meaning stable. Additive
roles may be adopted independently; incompatible meaning requires a new
contract and explicit migration. The CSS uses `light-dark()` (Chrome 123+,
Firefox 120+, Safari 17.5+). Fonts come from the product's existing approved
font installation; the snapshot itself makes no asset requests.
