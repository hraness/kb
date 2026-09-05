# Publish KB

KB uses an interactive first publication and stage-only trusted publishing for
later versions. npm staged publishing cannot create a package name, so the
initial registry write follows a separate path.

## Bootstrap the npm package

This section records the one-time `0.17.1` bootstrap. Do not reuse the
interactive path for a later release; follow
[Stage a later version](#stage-a-later-version) instead. The bootstrap started
from the checked `main` commit with Node 24, npm 11.19.0, and Bun 1.3.14. The
matching Git tag was created only after the public package was verified.

1. Install without dependency lifecycle scripts and run the complete gate.

   ```sh
   bun install --frozen-lockfile --ignore-scripts
   bun run check
   ```

2. Confirm that the check did not change the committed package outputs.

   ```sh
   git status --porcelain --untracked-files=all -- dist bun.lock
   ```

   Continue only when the command produces no output.

3. Build one npm tarball with its exact npm pack descriptor and exercise that
   pair through the package smoke.

   ```sh
   kb_npm_artifact="$(mktemp -d)"
   bun run ./scripts/prepare-npm-package.ts "$kb_npm_artifact"
   bun run ./scripts/package-smoke.ts \
     --archive "$kb_npm_artifact/hraness-kb-0.17.1.tgz" \
     --pack-json "$kb_npm_artifact/npm-pack.json"
   ```

   Review the complete inventory, file count, packed size, unpacked size, and
   integrity before continuing. The smoke installs the exact archive with both
   Bun and npm, with lifecycle scripts disabled.

4. Historical bootstrap record: the signed-in maintainer published that exact
   reviewed tarball and completed npm's two-factor authentication prompt. The
   direct command is intentionally omitted because the package now exists and
   later versions must use the stage-only workflow below. Never put an npm
   password, one-time password, recovery code, session cookie, or token in Git,
   a workflow, a task file, or chat.

5. Confirm that `@hraness/kb@0.17.1` is public, `latest` names `0.17.1`, and the
   registry metadata and downloaded package content match the reviewed
   artifact. Run the same package smoke against the downloaded registry
   tarball and its exact npm pack descriptor.

The tag workflow refuses to create the immutable GitHub Release until the
matching npm artifact exists. It verifies each tarball's own npm and registry
integrity, then compares the canonical extracted path, type, mode, size, and
regular-file hashes. Gzip bytes may legitimately differ across operating
systems.

## Configure trusted publishing

After the first version exists, configure one GitHub Actions trusted publisher
in the npm package settings:

- organization or owner: `hraness`
- repository: `kb`
- workflow filename: `npm-stage.yml`
- allowed action: `npm stage publish` only
- environment: `npm-stage`

Create the `npm-stage` GitHub environment before enabling later publishing
and disable administrator bypass. Its sole protection rule must be
`branch_policy`, and its sole deployment policy must be the selected branch
`main` with type `branch`. Configure no required deployment reviewers and no
environment secrets, so a verified version bump reaches npm staging without a
second GitHub approval only after an explicit release dispatch. Pushes and
default manual dispatches build and upload the candidate but cannot request the
OIDC staging job; current-main dispatch must set `publish_to_npm=true`. The npm
trusted publisher must name that exact environment. Then
require publishing two-factor authentication and disallow traditional tokens.
Do not add an npm publishing token to GitHub. Preserve
`contentPolicy.class=dual-use` and the root `DISCLOSURE` in every package.

## Stage a later version

1. Merge a strictly increasing stable version to `main`. A `package.json` push
   that changes the version automatically starts **Stage npm package** in
   build-only mode. When
   `package.json` changes but its version is unchanged, the selector exits
   successfully before package verification or OIDC use.
2. Wait for the read-only verification job and inspect the uploaded artifact.
   It contains exactly the tarball,
   `npm-pack.json`, and `npm-package.sha256`, bound to the source commit,
   version, complete inventory, size, integrity, dual-use declaration, and
   disclosure.
3. When the stable train is intentionally ready for npm staging, dispatch the
   exact workflow from current `main` with the explicit opt-in:

   ```sh
   gh workflow run npm-stage.yml --ref main -f publish_to_npm=true
   ```

   The run repeats candidate verification. Only then may the minimal OIDC job
   start. Its exact `npm-stage` environment allows only `main`. Its first step,
   before Node setup or artifact download, reauthorizes the current attempt
   through GitHub's API. Both the original actor and triggering actor must be
   owner `User` ID `894119`; the run must identify the active **Stage npm
   package** workflow, public repository ID `1308971873`, protected `main`, the
   exact verified source SHA, and the explicit true input. A collaborator
   rerun, a missing or false input, a push, another branch, or a stale commit
   cannot reach npm.
4. Batch the unavoidable human gate into an intentional stable release, then
   inspect and approve the staged package through npm with two-factor
   authentication.
5. Verify the public registry package in a clean consumer.
6. Create and push the matching annotated `v<version>` tag on the same `main`
   commit using the owner's existing local Git credential. The protected tag
   workflow verifies owner and event-sender ID `894119`, public repository ID
   `1308971873`, npm delivery, and exact source identity before it creates the
   immutable GitHub Release. The release verification installs the exact
   public package in an isolated directory with lifecycle scripts disabled and
   runs pinned npm `11.19.0` `npm audit signatures --json
   --include-attestations`. It requires a nonempty registry signature and the
   canonical npm publish and SLSA provenance attestations for that tarball and
   source commit. It also requires `dist-tags.latest` to equal the release
   version and reads `latest` again immediately before any GitHub Release
   mutation.

If candidate generation is missing or fails, dispatch **Stage npm package** from
current `main` without the opt-in. That recovery remains build-only. Use
`publish_to_npm=true` only for an intentional stable train after reviewing the
candidate. Every dispatch runs the same verification and main-branch checks.

Stable semantic-version components are canonical decimal integers and may not
exceed `Number.MAX_SAFE_INTEGER`; selectors, package tools, provenance checks,
and release ordering all fail closed beyond that boundary.

The verification job checks out source, installs dependencies without
lifecycle scripts, runs the complete gate, creates the three-file artifact,
and smokes the exact tarball. Its dependent staging job is the only job with
OIDC authority. That job has only `actions: read` and `id-token: write`. The
exact `npm-stage` environment restricts deployments to `main` and has no
required reviewers, so an explicitly opted-in staging job
starts after verification without another GitHub approval. It checks out no
source and runs no repository code. It rebinds
identity, filename, inventory, count, modes, sizes, SHA-1,
SHA-512, and the independent SHA-256 manifest before mutation. Immediately
before staging,
it fetches current `main` into a new bare Git directory, then rehashes all
three files and invokes only `npm stage publish` against
`https://registry.npmjs.org`, with the destination channel explicitly fixed by
`--tag latest`.

## Protect release tags without a sudo prompt

Keep two active repository rulesets matching `refs/tags/v*`. **Immutable
version tags** restricts update and deletion with an empty bypass list.
**Release tag creation** restricts creation only and gives immutable owner
`User` ID `894119` the sole always-bypass entry. Do not grant the generic
GitHub Actions integration, an administrator, a repository role, a team, or
another integration this bypass, and never combine creation with update or
deletion. This one-time provider setup lets the already-authenticated owner
create the exact release tag under standing task authority without a routine
GitHub sudo approval. Never create probe tags, move a version tag, or tag before
the matching staged package has been promoted and independently verified.

## Recover an already-published release

If npm delivery succeeded but the tag-triggered GitHub Release job failed,
keep the tag and npm version immutable and rerun that exact failed workflow
attempt. The workflow accepts only the newest stable repository tag. It freshly
resolves that tag from GitHub, requires its commit to remain reachable from
current `main`, reads the name and version from the tagged `package.json`, and
checks and builds the tagged source in a detached worktree. That explicit
tagged `bun run check` is the only historical build boundary. Afterward, the
workflow rebinds the release helpers to their reviewed Git blobs in the current
workflow checkout and invokes those files by absolute path while retaining the
tagged tree as the package working directory. Bun loads no tag-owned config or
environment file. The package step uses `npm pack --ignore-scripts`, so it does
not run the tag's `prepack` or another historical lifecycle script. The current
helpers import their current core-only archive inspector. They do not import a
script from the tagged tree. They compare the rebuilt package with the public
npm package by canonical content and registry metadata. The pinned signature
audit must cryptographically validate both registry and Sigstore evidence. The
decoded attestations must bind the downloaded tarball SHA-512 to the exact npm
publish predicate and to SLSA provenance for
`.github/workflows/npm-stage.yml` on `refs/heads/main`, `workflow_dispatch`,
repository ID `1308971873`, owner ID `307125679`, the sole source Git commit, a
GitHub-hosted builder, and a canonical Actions run-attempt URL. Only after that
read-only job succeeds can the write-scoped job reauthorize its own current
attempt, re-read the live tag, `main`, repository state, and npm `latest`, and
create the missing immutable Release. Recovery never moves the tag or
republishes npm.

See npm's documentation for [trusted
publishing](https://docs.npmjs.com/trusted-publishers/), [staged
publishing](https://docs.npmjs.com/staged-publishing/), and [dual-use
content](https://docs.npmjs.com/policies/dual-use/).
