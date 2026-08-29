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

4. Publish the reviewed tarball with the signed-in maintainer session.

   ```sh
   npm publish "$kb_npm_artifact/hraness-kb-0.17.1.tgz" \
     --access public \
     --ignore-scripts \
     --registry=https://registry.npmjs.org
   ```

   Complete npm's two-factor authentication prompt locally. Never put an npm
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

Create the `npm-stage` GitHub environment before enabling later publishing.
Restrict deployments to `main` and configure no required deployment reviewers,
so a verified version bump reaches npm staging without a second GitHub
approval. The npm trusted publisher must name that exact environment. Then
require publishing two-factor authentication and disallow traditional tokens.
Do not add an npm publishing token to GitHub. Preserve
`contentPolicy.class=dual-use` and the root `DISCLOSURE` in every package.

## Stage a later version

1. Merge a strictly increasing stable version to `main`. A `package.json` push
   that changes the version automatically starts **Stage npm package**. When
   `package.json` changes but its version is unchanged, the selector exits
   successfully before package verification or OIDC use.
2. Wait for the read-only verification job and inspect the uploaded artifact.
   It contains exactly the tarball,
   `npm-pack.json`, and `npm-package.sha256`, bound to the source commit,
   version, complete inventory, size, integrity, dual-use declaration, and
   disclosure.
3. The minimal OIDC job starts automatically after verification. Its exact
   `npm-stage` environment allows only `main`, and the job revalidates the
   artifact and current branch head before it stages the package.
4. Inspect and approve the staged package through npm with two-factor
   authentication.
5. Verify the public registry package in a clean consumer.
6. Create and push the matching `v<version>` tag on the same `main` commit. The
   tag workflow verifies npm delivery before it creates the immutable GitHub
   Release.

If the automatic run is missing or fails before npm staging completes,
dispatch **Stage npm package** from current `main`. Manual recovery runs the
same verification and main-branch-restricted staging jobs. The workflow rejects
a tag, another branch, or a commit behind the current default-branch head.

The verification job checks out source, installs dependencies without
lifecycle scripts, runs the complete gate, creates the three-file artifact,
and smokes the exact tarball. Its dependent staging job is the only job with
OIDC authority. The exact `npm-stage` environment restricts deployments to
`main` and has no required reviewers, so the job starts automatically after
verification. It checks out no source and runs no repository code. It rebinds
identity, filename, inventory, count, modes, sizes, SHA-1,
SHA-512, and the independent SHA-256 manifest before mutation. Immediately
before staging,
it fetches current `main` into a new bare Git directory, then rehashes all
three files and invokes only `npm stage publish` against
`https://registry.npmjs.org`.

## Recover an already-published release

If npm delivery succeeded but the tag-triggered GitHub Release job failed,
keep the tag and npm version immutable. After the recovery workflow is on
current `main`, dispatch it with the existing tag:

```sh
gh workflow run release.yml --ref main -f tag=v0.17.3
```

The recovery path accepts only the newest stable repository tag. It freshly
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
npm package by canonical content and registry metadata before the write-scoped
job creates the missing immutable Release. Recovery never moves the tag or
republishes npm.

See npm's documentation for [trusted
publishing](https://docs.npmjs.com/trusted-publishers/), [staged
publishing](https://docs.npmjs.com/staged-publishing/), and [dual-use
content](https://docs.npmjs.com/policies/dual-use/).
