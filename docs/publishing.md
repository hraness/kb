# Publish Wordcell

The canonical artifact contract starts at `0.19.4`; that first attempt stopped
with a retained partial draft. Each successful release contains
one checked package archive, its packing receipt, a source/run manifest,
checksums, and signed GitHub provenance. The same tag run then publishes those
exact archive bytes to npm as `@hraness/wordcell` through OIDC trusted
publishing. An npm outage does not undo a GitHub release; the npm job is
retried on its own.

Wordcell 0.20.0 renamed the product from KB. The package is `@hraness/wordcell`,
the commands are `wordcell` and `wordcell-evaluation-builder` (`kb` remains a
deprecated alias through 0.20.x), the public Agent Skill is `wordcell`, and the
homepage is [wordcell.io](https://wordcell.io). The vault format keeps its
`kb` names; see the README. Versions through 0.19.6 stay published under
`@hraness/kb` with their tags and Releases. The historical npm-first
procedure is preserved in
[the 0.19.2 source](https://github.com/hraness/wordcell/blob/v0.19.2/docs/publishing.md).

## Prepare a canonical release

1. Merge the intended source and a strictly increasing stable version through
   a current-head pull request. Resolve review threads and require `Required`
   CI. Stable components are canonical decimal integers bounded by
   `Number.MAX_SAFE_INTEGER`.
2. Run the required local source gate with Bun `1.3.14`, Node `24`, and npm
   `11.19.0`:

   ```sh
   bun install --frozen-lockfile --ignore-scripts
   bun run check
   git status --porcelain --untracked-files=all -- dist bun.lock
   ```

   The final command must produce no output. Preserve separate native,
   installed-package, and live acceptance whenever the change affects them.
3. Verify exact current `main`, the package version, and the release-tag
   rulesets. **Immutable version tags** must prevent updates and deletion
   without bypass. **Release tag creation** must allow only owner User
   `894119` to create `refs/tags/v*`; it must not allow generic Actions,
   administrators, roles, teams, or other integrations to bypass creation.
4. Create the matching annotated `v<version>` tag on that reviewed `main`
   commit using the owner's existing Git credential, then push that exact
   tag. Never move a tag or create a probe tag.
5. Wait for the tag-triggered **Release** workflow and inspect its immutable
   release readback. Do not begin another stable release until this one has
   completed or its exact partial state has been reconciled.

The workflow checks owner actor and event-sender identity and public
repository ID `1308971873` before checkout. Its read-only verification job
checks out exact current `main`, requires the protected annotated tag and
current workflow closure, materializes exact tagged source, runs the complete
source gate, and checks committed outputs. It packs once with
`npm pack --ignore-scripts` and smokes those exact bytes with both Bun and npm.
Packing is local tooling, not registry publication.

The handoff contains exactly:

- `hraness-wordcell-<version>.tgz`
- `npm-pack.json`
- `release-manifest.json`
- `SHA256SUMS`
- `provenance.jsonl`

The first four files are bound to verified job outputs and attested together
by a separate source-free job. That job reauthorizes both original and
triggering actors and the exact active workflow, repository, tag, source,
run, and attempt before requesting signing credentials. It executes no
checkout, package installation, or repository code.

The publication job independently rebinds the artifact bytes and validates
GitHub's cryptographic verification output. The signed certificate must bind
public repository and owner IDs, the exact tagged source and workflow,
GitHub-hosted execution, the tag push, and the originating run/attempt.
Unsigned manifest fields or matching checksums alone never grant authority.

Publication discovers retained drafts in the authenticated release inventory
and keeps the exact release ID for draft reads, uploads, and publication.
New drafts retain the verified creation response's ID because the release list
response may omit a successful creation.
GitHub may return 404 for a draft looked up by tag; that response alone never
authorizes creating another release. Publication uploads only missing matching assets, verifies
provider asset names, sizes, SHA-256 digests, and Actions-bot creator
`41898282`, then downloads each exact asset ID and checks its bytes before
publishing an immutable Latest release. It repeats the exact asset-byte readback
after publication. Draft descriptors may use the exact versioned URL or a
same-repository `untagged-` URL with exactly twenty lowercase hexadecimal digits
and the exact asset name. Published descriptors require the versioned URL.
These browser URLs never carry authenticated downloads; those use the exact
GitHub API asset ID. Current main,
annotated tag, source ancestry, and the complete helper/workflow closure are
revalidated before each mutation. Existing matching state is reconciled;
assets are never overwritten and releases are never deleted/recreated.

A draft or release from another attempt is not relabeled as the current
attempt. If its exact original evidence cannot be proved, stop with its
release/run identity and reconcile that state. Retry the original authorized
operation only after inspecting uncertain provider results.

## Verify a published release

Resolve a published immutable version before installation. A `latest` URL is
only discovery; do not use it as an unchecked dependency pin. Download all five
assets for that version into a new directory and inspect their exact names.
With the checked repository verifier, set `VERIFIED_SOURCE_SHA` to the
independently resolved annotated tag commit and run:

```sh
VERIFIED_SOURCE_SHA=<exact-tag-commit> \
  node scripts/github-release.ts download <new-directory> <version>
```

The verifier binds release metadata, the annotated tag, packing receipt,
archive SHA-256/SHA-512, exact checksum file, complete asset inventory, and
signed provenance. It invokes `gh attestation verify` with exact repository,
signer workflow, signer digest, source digest, source ref, hosted-runner
restriction, and the downloaded bundle. Run the installed-package smoke on
that downloaded archive and packing receipt before reporting release success.

End users can install a published version directly with Bun or npm using its
versioned GitHub tarball URL. Keep dependency lifecycle scripts disabled until
the particular optional capability has been reviewed. Installation does not
initialize or modify a vault. See the [README](../README.md#install) for the
command and runtime requirements.

## Publish the same bytes to npm

The Release workflow's `publish_npm` job runs after the immutable GitHub
Release is published. It is bound to the GitHub environment `npm-release`,
whose sole deployment policy is tag pattern `v*` with administrator bypass
disabled, no required deployment reviewers, and no secrets. The job holds only
`actions: read`, `contents: read`, and `id-token: write`. It checks out no
source and runs no repository code. It reauthorizes the current attempt and
both owner actors against the active workflow and current main, downloads the
attested artifact by its numeric artifact ID, rebinds every verified hash and
the provenance bundle, and proves that the immutable Latest Release for the
tag carries the exact archive digest and size.

Immediately before mutation it reads the exact registry version. An absent
version publishes; a present version with the identical `dist.integrity` is an
already-published rerun and succeeds without publishing; any other state fails
closed. Public `latest` must be older than the candidate, and `--tag` is never
passed, so pinned npm's monotonic default-tag guard stays active. The one
mutation is:

```sh
npm publish <canonical-archive> \
  --access public \
  --ignore-scripts \
  --json \
  --provenance \
  --registry=https://registry.npmjs.org
```

It runs from a clean directory with empty user and global npm configuration
files and no ambient `npm_config_tag`. npm 11.19 returns one receipt keyed by
package name; the job requires its `id` and `integrity` to match the canonical
archive.

The dependent `admit_npm` job checks out the exact reviewed verifier closure,
downloads the canonical archive and packing receipt through the GitHub API by
asset ID, packs the registry version, compares complete content inventories
with `scripts/npm-package-identity.ts`, installs the registry version in an
isolated consumer, and verifies registry signatures, the publish attestation,
and SLSA provenance bound to `refs/tags/v<version>` of `release.yml` with
`scripts/npm-release-attestation.ts`.

If `publish_npm` fails after the GitHub Release exists, inspect the exact
registry state, then re-run the failed jobs of the same workflow run. The
artifact-by-ID download and the idempotent registry check make that retry
safe. Never re-push the tag or create another release.

## Configure trusted publishing

npm requires the package to exist before a trusted publisher can be bound.
Establish the new coordinate with a separately reviewed prerelease bootstrap
artifact, then configure trusted publishing before tagging the first stable
release. Use exactly `0.20.0-bootstrap.1` with the `bootstrap` dist-tag and no
`latest` tag. The first stable workflow accepts that one exact bootstrap state.
Retain its exact
source and archive evidence, and inspect its complete packed manifest and
contents before the owner-authenticated publication. Do not publish a dummy
package or manually publish the stable release archive: the stable
`admit_npm` gate requires the exact tag workflow's OIDC provenance.

The coordinator prepares and verifies the concrete bootstrap artifact before
requesting the owner's interactive npm authentication. Preserve npm's current
publication controls, including any exact-artifact approval it requires.
Successful package creation does not waive those controls for later releases.

Then configure the exact GitHub Actions identity once:

```sh
npm trust github @hraness/wordcell --repo hraness/wordcell --file release.yml --environment npm-release --allow-publish --yes
npm trust list @hraness/wordcell --json
```

The relationship must name `hraness/wordcell`, the exact `release.yml`
filename, the `npm-release` environment, and publish permission. Keep package
publishing access on **Require two-factor authentication and disallow
tokens**; do not add an npm token to GitHub. Later releases need no interactive
step. No npm password, OTP, recovery code, session cookie, or token belongs in
Git, workflows, task files, or chat.

## Retained v0.19.4 publication failure

[Release run 34353781377](https://github.com/hraness/wordcell/actions/runs/34353781377)
verified source, packed bytes and attestation, then stopped after uploading
`SHA256SUMS` to draft `385518557`. The descriptor used GitHub's temporary
`untagged-ef6c1bd779e9dd4032bb` path; the original verifier required a published
tag path even for a draft. Asset `552772852` is 256 bytes with SHA-256
`7439c234c0a6d0166efef952e3d8ee76dfde2178934ffe8dcdebb84cd1dfe162`.

Preserve that tag, draft, uploaded asset and original attested evidence. It is
not an admitted public release and must not be retried under changed source,
overwritten, relabeled or deleted. The `0.19.5` candidate applies the reviewed
state-aware descriptor rule while retaining exact IDs, bytes, source and
provenance admission. Its install examples remain conditional until publication.

## Site publication datum

The independent Next application in `site/` builds through its own frozen
lockfile and is required by CI. Run `cd site && bun run check` before delivery;
its README projection, source contracts, lint, types, production build, and
HTTP runtime smoke test must pass. Vercel uses `site/` as the project root.

`site/published-release.json` starts with `version` and `verificationRun` both
null. The homepage then shows the first-release preparation state and offers
no archive download. After the canonical GitHub release has passed public
verification, set both fields to the exact stable Wordcell version and its
successful `https://github.com/hraness/wordcell/actions/runs/<run-id>` URL.
Never use a pre-rename kb archive or an unverified source version as that datum.
Keep both fields null if publication or verification is incomplete. Regenerate
the README projection and validate the site before deploying the update.
