# Publish KB

KB used an interactive first publication and now uses direct OIDC trusted
publishing for every later version. The interactive bootstrap remains here only
as history; routine beta and stable releases need no maintainer npm session,
one-time password, staging approval, or long-lived publishing token.

## Bootstrap the npm package

This section records the one-time `0.17.1` bootstrap. Do not reuse the
interactive path for a later release; follow
[Publish a later version](#publish-a-later-version) instead. The bootstrap started
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
in the npm package settings. If a staged-publishing connection already exists,
delete and recreate it once because npm does not let a trusted publisher's
workflow, environment, or allowed action be edited in place:

- organization or owner: `hraness`
- repository: `kb`
- workflow filename: `npm-stage.yml`
- allowed action: direct `npm publish` (`--allow-publish`)
- environment: `npm-stage` (`--environment npm-stage`)

Do not grant `--allow-stage` or any staged-publishing permission. Create the
`npm-stage` GitHub environment before enabling later publishing. Disable
administrator bypass and use custom deployment policies rather than
protected-branch admission. Its sole protection rule must be `branch_policy`,
with no required deployment reviewers; its sole deployment policy must be tag
pattern `v*`. A verified release can then reach npm without a second GitHub
approval. The npm trusted publisher must name that exact environment. Then
require publishing two-factor authentication and disallow traditional tokens.
Do not add an npm publishing token to GitHub. Preserve
`contentPolicy.class=dual-use` and the root `DISCLOSURE` in every package.

GitHub Actions may retain read-and-write workflow permissions for the stable
Release job's narrowly declared `contents: write` permission. No workflow gets
`contents: write` authority to create a tag or `actions: write` authority to
dispatch another workflow. Never give the generic GitHub Actions integration a
release-tag ruleset bypass: repository branch workflows can request a
write-capable `GITHUB_TOKEN`.

Enable immutable releases in the repository settings before the first stable
OIDC release. The Release workflow requires GitHub's immutable readback; it does
not emulate immutability in workflow code.

## Publish a later version

1. Merge one unique, strictly increasing version to `main`. Stable versions use
   `M.m.p`; beta versions use `M.m.p-beta.N`, with an increasing numeric `N`.
   An agent operating under the repository's standing release authorization
   then runs the checked local tag command from a clean current `main` checkout:

   ```sh
   bun run ./scripts/push-npm-release-tag.ts <exact-version>
   ```

   The command uses only already-available `gh` and Git credentials; it never
   reads or prints a token. Before its first mutation it requires authenticated
   immutable owner `User` ID `894119`, public repository ID `1308971873`, the
   exact active **Release tag creation** and **Immutable version tags** rulesets,
   and a
   live `npm-stage` environment with administrator bypass disabled and only
   the `v*` tag deployment policy, a clean exact protected current `main`,
   matching package identity, the exact
   active `.github/workflows/ci.yml`, its sole successful `push` run for that
   commit and exact attempt, and that attempt's successful **Required** job. It
   reads a bounded remote-tag inventory twice, enforces monotonic stable or beta
   SemVer, refuses conflicting or inherited local refs, creates one annotated
   `v<version>` tag, and pushes only that exact ref. If the same annotated remote
   tag already identifies the same commit, the command reports idempotent proof
   and does nothing. Missing authentication or ambiguous evidence fails closed.
2. Wait for the read-only verification job and inspect the uploaded artifact.
   It contains exactly the tarball,
   `npm-pack.json`, and `npm-package.sha256`, bound to the source commit,
   version, complete inventory, size, integrity, dual-use declaration, and
   disclosure.
3. The protected tag push starts the workflow. Its first job binds the push
   actor and event sender to owner `User` ID `894119`, the immutable public
   repository ID, and a protected tag before checkout. The minimal OIDC job
   starts automatically after verification. Its exact
   `npm-stage` environment allows only `v*` tags. The job
   revalidates the artifact and current branch head, publishes the reviewed
   tarball directly without a maintainer OTP, and polls the registry until
   exact integrity, inventory, channel, signature, and SLSA provenance
   readback succeeds.
   Stable versions publish with `--tag latest`; beta versions publish with
   `--tag beta`. Never use `npm dist-tag` promotion: a beta promoted to stable
   is a new stable version and a new exact publication.
4. A stable protected tag also starts the Release workflow. It waits for exact
   npm readback, independently rechecks the owner-created protected annotated
   tag, npm delivery, and source, then creates the immutable GitHub Release.
   Beta tags do not start the Release workflow.

If the local command fails before creating the remote tag, update to current
`main` and rerun it. If a tag-bound workflow later fails transiently, rerun that
exact workflow run; never dispatch it against another ref or move the tag.
Never reuse a published version. If npm accepted the package but registry
readback timed out, verify that exact version and channel instead of rerunning
publication; recover only the later GitHub Release when necessary.

The verification job checks out source, installs dependencies without
lifecycle scripts, runs the complete gate, creates the three-file artifact,
and smokes the exact tarball. Its dependent publishing job is the only job with
OIDC authority. The exact `npm-stage` environment restricts deployments to
`v*` tags, disables administrator bypass, and has no required reviewers, so the job starts
automatically after verification. It checks out no source and runs no
repository code. It rebinds
identity, filename, inventory, count, modes, sizes, SHA-1,
SHA-512, and the independent SHA-256 manifest before mutation. Immediately
before publication,
it fetches current `main` into a new bare Git directory, then rehashes all
three files and invokes direct `npm publish` against
`https://registry.npmjs.org`. The registry readback must match the reviewed
artifact and intended `latest` or `beta` channel and must expose npm signatures
and SLSA provenance.

Release selection is deliberately confined to the checked local tag script and
tag-bound workflow guards. The obsolete staged push/manual selection helper and
its tests were removed rather than retained as a second executable policy that
could drift into an alternate publication path.

## Protect npm release tags without a sudo prompt

Create two repository rulesets matching `refs/tags/v*`. Name **Immutable
version tags** restricts updates and deletions with an empty bypass list. Name
**Release tag creation** restricts creation and gives only immutable owner `User` ID
`894119` an always bypass. It grants no update or delete bypass and includes no
administrator, repository-role, team, deploy-key, or integration actor. Never
give GitHub Actions integration ID `15368` this bypass: any same-repository
branch workflow could otherwise mint a release tag. Do not combine the two
rules in one bypassable ruleset, and do not create throwaway or probe tags.
After this one-time ruleset setup, the owner's existing local Git credential can
push the script's exact annotated ref without routine GitHub sudo approval;
neither the credential nor an approval is stored in the repository. Publication
and Release require `github.ref_protected`, the exact owner/event sender and
public repository identity, annotated-tag identity, package version, and source
commit before any provider mutation. The local tag command reads back both exact
active rulesets and refuses any namespace, rule, enforcement, or bypass drift.

For a larger maintainer group, replace the owner-local boundary with a dedicated
Release GitHub App only after its isolated credential and immutable installed
App ID are configured explicitly in the script/workflow and creation ruleset.
Do not use the generic Actions integration or trust an unconfigured/name-only
App.

## Recover an already-published release

If npm delivery succeeded but the GitHub Release job failed, keep the tag and
npm version immutable. Re-run the failed exact Release workflow run. Running
the local command with the same version is also a read-only proof:

```sh
bun run ./scripts/push-npm-release-tag.ts 0.19.0
```

The command idempotently accepts only the same exact owner-created annotated tag
and commit and performs no push. A publication rerun verifies the existing
package and registry channel without republishing it. The Release workflow
freshly resolves the stable repository tag,
requires its commit to remain reachable from current `main`, reads the name and
version from the tagged `package.json`, and
checks and builds the tagged source in a detached worktree. That explicit
tagged `bun run check` is the only historical build boundary. Afterward, the
workflow rebinds the release helpers to their reviewed Git blobs in the
tag-bound workflow checkout and invokes those files by absolute path while
retaining the detached tree as the package working directory. Bun loads no
working-tree config or environment file. The package step uses
`npm pack --ignore-scripts`, so it does
not run the tag's `prepack` or another historical lifecycle script. The current
helpers import their current core-only archive inspector. They do not import a
script from the tagged tree. They compare the rebuilt package with the public
npm package by canonical content and registry metadata before the write-scoped
job creates the missing immutable Release. Recovery never moves the tag or
republishes npm.

See npm's documentation for [trusted
publishing](https://docs.npmjs.com/trusted-publishers/), [package
provenance](https://docs.npmjs.com/viewing-package-provenance/), and [dual-use
content](https://docs.npmjs.com/policies/dual-use/).
