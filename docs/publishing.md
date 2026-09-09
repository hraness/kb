# Publish KB

The canonical artifact contract starts at `0.19.4`; that first attempt stopped
with a retained partial draft. The prepared `0.19.6` candidate is not installable
until its immutable release completes. Each successful release contains
one checked package archive, its packing receipt, a source/run manifest,
checksums, and signed GitHub provenance. npm is an optional mirror of those
exact archive bytes. An npm outage or pending npm promotion does not block a
GitHub release.

The package remains `@hraness/kb`; SDK imports, `kb`,
`kb-evaluation-builder`, and the public Agent Skill keep their names. Old npm
versions and existing tags remain available. The historical npm-first
procedure is preserved in
[the 0.19.2 source](https://github.com/hraness/kb/blob/v0.19.2/docs/publishing.md).

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

- `hraness-kb-<version>.tgz`
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

## Mirror an existing canonical release to npm

The existing trusted publisher remains stage-only:
`hraness/kb`, `.github/workflows/npm-stage.yml`, environment `npm-stage`, and
`npm stage publish` permission. Keep the sole environment branch policy on
selected branch `main` with type `branch`, administrator bypass disabled, no
required deployment reviewers, and no secrets. Require publishing two-factor
authentication and disallow traditional tokens. Preserve
`contentPolicy.class=dual-use` and the root `DISCLOSURE`.

Dispatch the optional mirror from current `main` after the selected package version
has its immutable canonical release. Its canonical source may precede the current
workflow commit, but must remain an ancestor of it:

```sh
gh workflow run npm-stage.yml --ref main -f publish_to_npm=true
```

The default candidate is current main's package version. To mirror an earlier
canonical release while GitHub is ahead, add `-f release_tag=v0.19.6`. The input
must be one exact stable tag no newer than current main's version; its source
must be an ancestor of the workflow commit, and its version must still be newer
than npm `latest`. Neither a Git branch with a matching name nor an unqualified
ref can supply its source identity.

A default dispatch verifies the candidate without requesting OIDC. The
explicitly opted-in staging job starts after verification. The read-only job
verifies and downloads the canonical archive; it does not rebuild mirror
bytes. It requires the exact completed successful canonical run, repeats the full source gate on current main, and runs the current package verifier against the tagged source and downloaded archive. It hands exactly the tarball,
`npm-pack.json`, and `npm-package.sha256` to the terminal staging job.

The clean consumer uses the verifier's exact, source-qualified TypeScript,
Bun, and Node declaration versions, including an explicit Node declaration
pin. Keep strict declaration checking enabled. Before compiling, the verifier
records resolved versions and manifest and lock hashes so a dependency failure
can be diagnosed without retaining private machine state. Updating this
verification tuple does not change the canonical archive or its source identity.

The terminal staging job holds only `actions: read`, `contents: read`, and `id-token: write`.
It checks out no source and runs no repository code. Its first step
reauthorizes the current attempt and both owner actors against the active
workflow and current main. It independently verifies safe packed
configuration, complete inventory, bounds, source, hashes, and clean default
`latest`; a top-level `tag` override is rejected. Pinned npm's implicit default
tag keeps its higher-version guard active.

A successful version-bound intent step immediately precedes the mutation.
Every retained attempt is inspected, including terminal writes whose job name
is malformed. An unresolved intent newer than public npm `latest` prevents a
second stage. Public promotion clears that intent; the prior npm version must
still have its annotated tag, immutable Actions-created release, and source
reachable from main. GitHub Latest may be newer than npm Latest. Historical
zero-asset releases are accepted only for the exact source-bound tags `v0.19.0`,
`v0.19.1`, and `v0.19.2` recorded in the workflow. Other prior releases must be
at least `0.19.4` and require the five canonical assets.

npm promotion remains subject to its two-factor authentication requirement
until npm approves a classification change. This is independent of canonical
GitHub delivery. No npm password, OTP, recovery code, session cookie, or token
belongs in Git, workflows, task files, or chat.

## Recover an ambiguous npm stage

Inspect the exact provider state before retrying. The trusted-publishing
assertion cannot run `npm stage list`. If a candidate is rejected, reject that
exact version through npm first, then use the exceptional
`resolved_stage_version=<rejected-version>` input with the intentional mirror
dispatch. Leave that input empty normally. It records resolution for only the
matching durable intent; it cannot clear another version or an unresolved
provider write. This is not a claim that npm exposes or prevents an
out-of-band concurrent stage.

## Retained v0.19.4 publication failure

[Release run 34353781377](https://github.com/hraness/kb/actions/runs/34353781377)
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
