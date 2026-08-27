# Publish KB

KB uses an interactive first publication and stage-only trusted publishing for
later versions. npm staged publishing cannot create a package name, so the
initial registry write follows a separate path.

## Bootstrap the npm package

Start from the current `main` commit after its required checks pass. Use Node
24, npm 11.19.0, and Bun 1.3.14. Do not create the matching Git tag yet.

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

3. Build one npm tarball and exercise that exact file through the package
   smoke.

   ```sh
   kb_npm_artifact="$(mktemp -d)"
   npm pack --json --ignore-scripts \
     --pack-destination "$kb_npm_artifact" \
     --registry=https://registry.npmjs.org
   bun run ./scripts/package-smoke.ts \
     --archive "$kb_npm_artifact/hraness-kb-0.17.1.tgz"
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
   registry metadata and downloaded tarball match the reviewed artifact. Run
   the same package smoke against the downloaded registry tarball.

The tag workflow refuses to create the immutable GitHub Release until the
matching npm artifact exists and has the same integrity as a fresh source
tarball.

## Configure trusted publishing

After the first version exists, configure one GitHub Actions trusted publisher
in the npm package settings:

- organization or owner: `hraness`
- repository: `kb`
- workflow filename: `npm-stage.yml`
- allowed action: `npm stage publish` only
- environment: none

Then require publishing two-factor authentication and disallow traditional
tokens. Do not add an npm publishing token to GitHub. Preserve
`contentPolicy.class=dual-use` and the root `DISCLOSURE` in every package.

## Stage a later version

1. Merge a new stable version to `main` and wait for required CI.
2. Dispatch **Stage npm package** from current `main`. The workflow rejects a
   tag, another branch, or a commit behind the current default-branch head.
3. Inspect the uploaded and staged artifact, including its source commit,
   version, inventory, size, integrity, dual-use declaration, and disclosure.
4. Approve the stage through npm with two-factor authentication.
5. Verify the public registry package in a clean consumer.
6. Create and push the matching `v<version>` tag on the same `main` commit. The
   tag workflow verifies npm delivery before it creates the immutable GitHub
   Release.

See npm's documentation for [trusted
publishing](https://docs.npmjs.com/trusted-publishers/), [staged
publishing](https://docs.npmjs.com/staged-publishing/), and [dual-use
content](https://docs.npmjs.com/policies/dual-use/).
