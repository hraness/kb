import { expect, test } from "bun:test";
import fc from "fast-check";
import { verifyCanonicalPublication, verifyCanonicalRun, type ReleaseManifest } from "./github-release.js";

const manifest: ReleaseManifest = {
  schema: "hraness-github-release-v1", repository: "hraness/wordcell", repositoryId: 1308971873,
  package: "@hraness/wordcell", version: "0.20.0", tag: "v0.20.0",
  sourceSha: "a3b44090b38aa22228e26b4be8e7727232b3ff17", workflowSha: "a3b44090b38aa22228e26b4be8e7727232b3ff17",
  workflow: ".github/workflows/release.yml", runId: 34540823193, runAttempt: 1,
  archive: { name: "hraness-wordcell-0.20.0.tgz", bytes: 1105942, sha256: "5a3c61436d9d87ea90409e19ae8ad1511d2a5dc3f5c9a529037eb6fd49ce017a", sha512: "a".repeat(128) },
};
const run = {
  id: manifest.runId, run_attempt: 1, workflow_id: 320004141, name: "Release", path: manifest.workflow,
  status: "completed", conclusion: "failure", event: "push", head_branch: manifest.tag, head_sha: manifest.sourceSha,
  actor: { id: 894119, type: "User" }, triggering_actor: { id: 894119, type: "User" },
  repository: { id: 1308971873, full_name: "hraness/wordcell", private: false },
};
// Bounded public-provider fields from Wordcell run 34540823193 attempt 1.
const names = ["Authorize owner release tag", "Verify", "Attest verified artifact", "Publish", "Publish exact npm package", "Admit the public npm package"];
const ids = [103082855785, 103082873470, 103083773742, 103083810613, 103083968559, 103084059827];
const jobs = names.map((name, index) => ({ id: ids[index]!, name, run_id: run.id, run_attempt: 1,
  head_sha: manifest.sourceSha, status: "completed", conclusion: index === 5 ? "failure" : "success" }));
const inventory = (values = jobs) => ({ total_count: values.length, jobs: values });
const proof = () => ({ originalJobs: inventory(), latestRun: run, latestJobs: inventory() });

test("canonical admission survives the observed npm-admission failure with its original receipt intact", () => {
  expect(() => verifyCanonicalRun(run, manifest, proof())).not.toThrow();
  const successful = { ...run, conclusion: "success" };
  const allSuccess = inventory(jobs.map((job) => ({ ...job, conclusion: "success" })));
  expect(() => verifyCanonicalRun(successful, manifest, { originalJobs: allSuccess, latestRun: successful, latestJobs: allSuccess })).not.toThrow();
  const failedPublish = inventory(jobs.map((job, index) => ({ ...job, conclusion: index === 4 ? "failure" : index === 5 ? "skipped" : "success" })));
  expect(() => verifyCanonicalRun(run, manifest, { originalJobs: failedPublish, latestRun: run, latestJobs: failedPublish })).not.toThrow();
});

test("failed-only retry admits provider-owned fresh job IDs and attempt numbers, never relabeling the receipt", () => {
  // GitHub's observed failed-only retry returns all six effective jobs, including
  // inherited successes with fresh IDs and the new run_attempt value.
  // IDs observed on Soulscrape retry 34540931915/2; normalize repository,
  // source, and job names to this Wordcell fixture.
  const retryIds = [103084743956, 103084744550, 103084744574, 103084745323, 103084746407, 103084745464];
  const retried = inventory(jobs.map((job, index) => ({ ...job, id: retryIds[index]!, run_attempt: 2, conclusion: "success" })));
  expect(() => verifyCanonicalRun(run, manifest, { originalJobs: inventory(), latestRun: { ...run, run_attempt: 2, conclusion: "success" }, latestJobs: retried })).not.toThrow();
  // Also accept an explicitly inherited success still identified by its original
  // attempt in an otherwise complete effective inventory.
  expect(() => verifyCanonicalRun(run, manifest, { originalJobs: inventory(), latestRun: { ...run, run_attempt: 2, conclusion: "success" }, latestJobs: inventory(retried.jobs.map((job, index) => index < 4 ? jobs[index]! : job)) })).not.toThrow();
  expect(manifest.runAttempt).toBe(1);
  const failedCanonical = inventory(retried.jobs.map((job, index) => index === 3 ? { ...job, conclusion: "failure" } : job));
  expect(() => verifyCanonicalRun(run, manifest, { originalJobs: inventory(), latestRun: { ...run, run_attempt: 2 }, latestJobs: failedCanonical })).toThrow("canonical");
});

test("original and latest run identity and terminal result remain mandatory", () => {
  for (const change of [
    { id: 1 }, { run_attempt: 0 }, { run_attempt: 1.5 }, { run_attempt: "1" }, { workflow_id: 1 },
    { status: "in_progress" }, { conclusion: "cancelled" }, { conclusion: null }, { conclusion: "success" },
    { event: "workflow_dispatch" }, { head_sha: "f".repeat(40) }, { head_branch: "main" }, { path: ".github/workflows/other.yml" },
    { actor: { id: 1, type: "User" } }, { triggering_actor: { id: 894119, type: "Bot" } },
    { repository: { ...run.repository, private: true } },
  ]) {
    expect(() => verifyCanonicalRun({ ...run, ...change }, manifest, proof())).toThrow();
    expect(() => verifyCanonicalRun(run, manifest, { ...proof(), latestRun: { ...run, ...change } })).toThrow();
  }
  expect(() => verifyCanonicalRun(run, { ...manifest, runAttempt: 2 }, proof())).toThrow();
});

test("job inventory rejects hidden, missing, duplicate, foreign, pending, and failed canonical work", () => {
  const mutations: unknown[] = [null, [], {}, { total_count: 7, jobs }, { total_count: 6, jobs: jobs.slice(1) },
    inventory([...jobs, jobs[0]!]), inventory([jobs[0]!, ...jobs.slice(0, 5)])];
  for (const change of [
    { id: 0 }, { id: jobs[1]!.id }, { name: "Unreviewed job" }, { name: names[1] },
    { run_id: 1 }, { run_attempt: 0 }, { run_attempt: 2 }, { head_sha: "f".repeat(40) },
    { status: "queued" }, { conclusion: "skipped" }, { conclusion: "failure" }, { conclusion: "cancelled" },
  ]) mutations.push(inventory(jobs.map((job, index) => index === 0 ? { ...job, ...change } : job) as typeof jobs));
  mutations.push(inventory(jobs.map((job, index) => index === 5 ? { ...job, conclusion: "timed_out" } : job)));
  for (const mutation of mutations) {
    expect(() => verifyCanonicalRun(run, manifest, { ...proof(), originalJobs: mutation })).toThrow();
    expect(() => verifyCanonicalRun(run, manifest, { ...proof(), latestJobs: mutation })).toThrow();
  }
  fc.assert(fc.property(fc.integer({ min: 0, max: 5 }), (index) => {
    expect(() => verifyCanonicalRun(run, manifest, { ...proof(), latestJobs: inventory(jobs.filter((_, offset) => offset !== index)) })).toThrow();
  }), { numRuns: 24 });
});

test("canonical readback uses bounded original and effective job endpoints and rejects an intervening rerun", () => {
  const endpoint = `/repos/hraness/wordcell/actions/runs/${manifest.runId}`;
  for (const race of [false, true]) {
    const paths: string[] = [];
    let latestReads = 0;
    const read = (path: string): unknown => {
      paths.push(path);
      if (path === `${endpoint}/attempts/1`) return run;
      if (path === `${endpoint}/attempts/1/jobs?per_page=100`) return inventory();
      if (path === `${endpoint}/jobs?filter=latest&per_page=100`) return inventory();
      if (path === endpoint) return ++latestReads === 2 && race ? { ...run, run_attempt: 2, status: "in_progress" } : run;
      throw new Error("Unexpected provider read");
    };
    if (race) expect(() => verifyCanonicalPublication(manifest, read)).toThrow();
    else expect(() => verifyCanonicalPublication(manifest, read)).not.toThrow();
    expect(paths).toEqual([`${endpoint}/attempts/1`, `${endpoint}/attempts/1/jobs?per_page=100`, endpoint, `${endpoint}/jobs?filter=latest&per_page=100`, endpoint]);
  }
});
