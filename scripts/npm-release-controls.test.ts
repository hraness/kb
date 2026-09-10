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
const latest=publish.split("REGISTRY_JSON=\"$registry_json\" EXPECTED_VERSION=\"$EXPECTED_VERSION\" node <<'NODE'\n")[1].split('\nNODE')[0];
const metadataFetch=publish.split("node --input-type=module > \"$registry_json\" <<'NODE'\n")[1].split('\nNODE')[0];
const binding=steps.find((step:any)=>step.name==='Bind exact verified artifact').run.split("node <<'NODE'\n")[1].split('\nNODE')[0];
function execute(script:string,env:Record<string,string>={}){
 return Bun.spawnSync(['node','-e',script],{env:{...process.env,...env},stderr:'pipe',stdout:'pipe'});
}
const bootstrapVersion = '0.20.0-bootstrap.1';
const bootstrapIntegrity = 'sha512-31YbWYj6wCg3TmuFtNAN3bqiOyZUmfPWIlqHzKVau5BRDr41hOx/sw9FZ0D9o4v3i9k8Ly61vRMXqtIFtvYneA==';
function bootstrapMetadata(withLatest = false) {
 return {
  name: '@hraness/wordcell',
  'dist-tags': withLatest ? {bootstrap:bootstrapVersion, latest:bootstrapVersion} : {bootstrap:bootstrapVersion},
  versions: {[bootstrapVersion]: {name:'@hraness/wordcell',version:bootstrapVersion,dist:{integrity:bootstrapIntegrity}}},
 };
}
async function guardResult(raw:string,candidate='0.20.0') {
 const dir=await mkdtemp(resolve(tmpdir(),'wordcell-registry-fixture-'));
 try {
  const path=resolve(dir,'metadata.json');await writeFile(path,raw);
  return execute(latest,{REGISTRY_JSON:path,EXPECTED_VERSION:candidate});
 } finally {await rm(dir,{recursive:true,force:true});}
}
test('first publication accepts only the reviewed bootstrap with its optional latest alias',async()=>{
 for (const withLatest of [false,true]) {
  const metadata=bootstrapMetadata(withLatest);
  const result=await guardResult(JSON.stringify(metadata));
  expect(result.exitCode, result.stderr.toString()).toBe(0);
  for (const candidate of ['0.19.0','0.20.1','0.21.0','0.20.0-beta.1','9007199254740992.0.0']) {
   expect((await guardResult(JSON.stringify(metadata),candidate)).exitCode).not.toBe(0);
  }
 }
});
test('bootstrap admission rejects extra versions, unrelated tags and identity conflicts',async()=>{
 const mutations: Array<(metadata:any)=>void> = [
  m=>{m.name='@hraness/kb';},
  m=>{m['dist-tags']={};},
  m=>{m['dist-tags']={latest:bootstrapVersion};},
  m=>{m['dist-tags'].canary=bootstrapVersion;},
  m=>{m['dist-tags'].bootstrap='0.20.0-bootstrap.2';},
  m=>{m['dist-tags'].latest='0.20.0-beta.1';},
  m=>{m['dist-tags'].latest=null;},
  m=>{m.versions['0.19.0']={};},
  m=>{m.versions['0.21.0']={};},
  m=>{m.versions['0.20.0-beta.1']={};},
  m=>{m.versions['0.20.0']={};},
  m=>{m.versions={};},
  m=>{m.versions[bootstrapVersion]=null;},
  m=>{m.versions[bootstrapVersion].name='@hraness/soulscrape';},
  m=>{m.versions[bootstrapVersion].version='0.20.0-bootstrap.2';},
  m=>{m.versions[bootstrapVersion].dist.integrity=bootstrapIntegrity.replace('31Yb','41Yb');},
  m=>{delete m.versions[bootstrapVersion].dist;},
  m=>{delete m.versions;},
  m=>{m.versions=[];},
  m=>{delete m['dist-tags'];},
  m=>{m['dist-tags']=[];},
 ];
 for (const withLatest of [false,true]) for (const mutate of mutations) {
  const metadata=bootstrapMetadata(withLatest);mutate(metadata);
  const result=await guardResult(JSON.stringify(metadata));
  expect(result.exitCode,JSON.stringify(metadata)).not.toBe(0);
 }
 for (const raw of ['', '{', 'null', '[]', '{}']) expect((await guardResult(raw)).exitCode).not.toBe(0);
});
test('ordinary publication retains strictly increasing stable version ordering',async()=>{
 for (const [value,success] of [['0.19.6',true],['0.20.0',false],['0.21.0',false],['1.0.0',false],['0.20.0-bootstrap.2',false],['9007199254740992.0.0',false],[null,false]] as const) {
  const metadata={name:'@hraness/wordcell','dist-tags':{latest:value},versions:{'0.19.6':{name:'@hraness/wordcell',version:'0.19.6'}}};
  expect((await guardResult(JSON.stringify(metadata))).exitCode===0,JSON.stringify(value)).toBe(success);
 }
 const appeared={name:'@hraness/wordcell','dist-tags':{latest:'0.19.6'},versions:{'0.20.0':{}}};
 expect((await guardResult(JSON.stringify(appeared))).exitCode).not.toBe(0);
});
test('registry snapshot fetch fails closed without falling back or running repository code',()=>{
 const mock = (status:number,body:string) => `globalThis.fetch = async (url, options) => {
  if (url !== 'https://registry.npmjs.org/%40hraness%2Fwordcell' || options.redirect !== 'error' || options.cache !== 'no-store' || options.headers.Accept !== 'application/json') throw new Error('Fetch boundary changed');
  return {status:${status},text:async()=>${body}};
 };\n`;
 for (const status of [401,403,404,429,500]) {
  const result=Bun.spawnSync(['node','--input-type=module','-e',mock(status,'"{}"')+metadataFetch],{stderr:'pipe',stdout:'pipe'});
  expect(result.exitCode).not.toBe(0);
 }
 const payload=JSON.stringify(bootstrapMetadata(true));
 const success=Bun.spawnSync(['node','--input-type=module','-e',mock(200,JSON.stringify(payload))+metadataFetch],{stderr:'pipe',stdout:'pipe'});
 expect(success.exitCode,success.stderr.toString()).toBe(0);
 expect(success.stdout.toString()).toBe(payload);
 const oversized=Bun.spawnSync(['node','--input-type=module','-e',mock(200,'"x".repeat(5_000_001)')+metadataFetch],{stderr:'pipe',stdout:'pipe'});
 expect(oversized.exitCode).not.toBe(0);
 const rejected=Bun.spawnSync(['node','--input-type=module','-e','globalThis.fetch=async()=>{throw new Error("network unavailable")};\n'+metadataFetch],{stderr:'pipe',stdout:'pipe'});
 expect(rejected.exitCode).not.toBe(0);
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
