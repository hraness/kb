import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { parse } from 'yaml';
const source = await Bun.file(new URL('../.github/workflows/release.yml', import.meta.url)).text();
const workflow = parse(source);
const steps=workflow.jobs.publish_npm.steps;
const publish=steps.find((step:any)=>step.id==='npm').run;
const latest=publish.split("LATEST_JSON=\"$latest_json\" EXPECTED_VERSION=\"$EXPECTED_VERSION\" node <<'NODE'\n")[1].split('\nNODE')[0];
const binding=steps.find((step:any)=>step.name==='Bind exact verified artifact').run.split("node <<'NODE'\n")[1].split('\nNODE')[0];
function execute(script:string,env:Record<string,string>={}){
 return Bun.spawnSync(['node','-e',script],{env:{...process.env,...env},stderr:'pipe',stdout:'pipe'});
}
test('first-publication exception requires exactly the reviewed bootstrap; malformed latest fails closed',()=>{
 for (const [tags,success] of [
  [{bootstrap:'0.20.0-bootstrap.1'},true],
  [{},false],[{bootstrap:'0.20.0-bootstrap.2'},false],[{bootstrap:'0.19.0-bootstrap.1'},false],
  [{bootstrap:'0.20.0-bootstrap.1',canary:'0.20.0-beta.1'},false],
  [{latest:'0.19.6'},true],[{latest:'0.20.0'},false],[{latest:'0.21.0'},false],
  [{latest:null},false],[{latest:'0.20.0-bootstrap.1'},false],[null,false],[[],false],
  [{latest:'9007199254740992.0.0'},false],
 ] as const){
  expect(execute(latest,{LATEST_JSON:JSON.stringify(tags),EXPECTED_VERSION:'0.20.0'}).exitCode===0,JSON.stringify(tags)).toBe(success);
 }
 expect(execute(latest,{LATEST_JSON:'',EXPECTED_VERSION:'0.20.0'}).exitCode).not.toBe(0);
 expect(execute(latest,{LATEST_JSON:'{}',EXPECTED_VERSION:'9007199254740992.0.0'}).exitCode).not.toBe(0);
 expect(publish).not.toContain('|| true');
});
test('exact artifact binding accepts only this run and current or earlier valid attempts',async()=>{
 const dir=await mkdtemp(resolve(tmpdir(),'wordcell-handoff-fixture-'));
 const archive='hraness-wordcell-0.20.0.tgz';
 const base={repository:'hraness/wordcell',repositoryId:1308971873,package:'@hraness/wordcell',sourceSha:'b'.repeat(40),workflowSha:'c'.repeat(40),tag:'v0.20.0',version:'0.20.0',runId:123,runAttempt:1};
 const contents:Record<string,string>={[archive]:'fixture bytes','npm-pack.json':'[]','SHA256SUMS':'fixture checksums'};
 try {
  for(const [patch,success] of [[{},true],[{runAttempt:2},true],[{runAttempt:3},false],[{runAttempt:0},false],[{runAttempt:1.5},false],[{runId:124},false]] as const){
   contents['release-manifest.json']=JSON.stringify({...base,...patch});
   await Promise.all(Object.entries(contents).map(([name,bytes])=>writeFile(`${dir}/${name}`,bytes)));
   const hashes=Object.fromEntries(Object.entries(contents).map(([name,bytes])=>[name,createHash('sha256').update(bytes).digest('hex')]));
   expect(execute(binding,{ARTIFACT_DIRECTORY:dir,EXPECTED_HASHES:JSON.stringify(hashes),EXPECTED_ARCHIVE:archive,EXPECTED_BUNDLE:'',VERIFIED_SOURCE_SHA:base.sourceSha,WORKFLOW_SHA:base.workflowSha,VERIFIED_TAG:base.tag,GITHUB_RUN_ID:'123',GITHUB_RUN_ATTEMPT:'2'}).exitCode===0,JSON.stringify(patch)).toBe(success);
  }
 }finally{await rm(dir,{recursive:true,force:true});}
});
test('npm mirroring remains checkout-free and bound to canonical release authority',()=>{
 expect(steps.some((s:any)=>String(s.uses??'').startsWith('actions/checkout'))).toBe(false);
 expect(workflow.jobs.publish_npm.environment).toBe('npm-release');
 expect(workflow.jobs.publish_npm.needs).toEqual(['verify','attest','publish']);
 expect(publish.indexOf('current_main=')).toBeLessThan(publish.indexOf('npm publish "$TARBALL"'));
 expect(publish).toContain('scripts/npm-release-attestation.ts');
 const admit=workflow.jobs.admit_npm.steps.at(-1).run;
 expect(admit).toContain('cmp --silent "$work/registry/$EXPECTED_ARCHIVE" "$work/canonical/$EXPECTED_ARCHIVE"');
 expect(admit).toContain('--expected-run-id "$GITHUB_RUN_ID"');
 expect(admit).toContain('--maximum-run-attempt "$GITHUB_RUN_ATTEMPT"');
});
