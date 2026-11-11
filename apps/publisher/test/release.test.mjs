import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, writeFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { activateRelease, currentRelease, prepareRelease, secureHtml, pruneExpiredReleases, snapshotRoutes, validRoute } from '../src/release.mjs';
const empty = id => ({releaseId:id,createdAt:'2026-09-09T00:00:00Z',site:{title:'HADESD',tagline:'a personal daemon.'},contents:[]});
async function build(root,snapshot){const dir=path.join(root,'build-'+snapshot.releaseId);for(const route of snapshotRoutes(snapshot)){const p=path.join(dir,decodeURIComponent(route));await mkdir(p,{recursive:true});await writeFile(path.join(p,'index.html'),'<html><head><script>window.boot=1</script></head><body>正文</body></html>');}await mkdir(path.join(dir,'assets'));await writeFile(path.join(dir,'assets','app-AbC123.js'),'export {}');return dir;}
test('reject path traversal, encoded traversal and admin namespace',()=>{for(const route of ['/posts/../admin','/posts/%2e%2e','/admin','/posts/a%2fb','//posts/x','/posts/%00']) assert.throws(()=>validRoute(route));assert.equal(validRoute('/tags/%E4%B8%AD%E6%96%87'),'/tags/%E4%B8%AD%E6%96%87');});
test('CSP grants only actual inline script hashes, never unsafe-eval',()=>{const secured=secureHtml('<html><head><script>x()</script><script src="/a.js"></script></head></html>');assert.match(secured,/sha256-/);assert.doesNotMatch(secured,/unsafe-eval/);assert.match(secured,/Content-Security-Policy/);});
test('failed build validation leaves old pointer; atomic switch, retry and rollback are real filesystem operations',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'hadesd-release-'));try{
const a=empty('release-a');await prepareRelease({root,buildClient:await build(root,a),snapshot:a,origin:'https://hadesd.sh'});await activateRelease(root,a.releaseId);assert.equal(await currentRelease(root),'release-a');
const b=empty('release-b');const buildB=await build(root,b);await rm(path.join(buildB,'posts','index.html'));await assert.rejects(prepareRelease({root,buildClient:buildB,snapshot:b,origin:'https://hadesd.sh'}),/Missing prerendered/);assert.equal(await currentRelease(root),'release-a');
await writeFile(path.join(buildB,'posts','index.html'),'<html><head></head><body>目录</body></html>');await prepareRelease({root,buildClient:buildB,snapshot:b,origin:'https://hadesd.sh'});await activateRelease(root,'release-b');await activateRelease(root,'release-b');assert.equal(await currentRelease(root),'release-b');await activateRelease(root,'release-a');assert.equal(await currentRelease(root),'release-a');assert.equal((await stat(path.join(root,'assets','app-AbC123.js'))).isFile(),true);assert.match(await readFile(path.join(root,'current','site','rss.xml'),'utf8'),/<rss/);
}finally{await rm(root,{recursive:true,force:true});}});
test('duplicate content public routes prevent publication',()=>{assert.throws(()=>snapshotRoutes({...empty('duplicate'),contents:[{route:'/posts/x',tags:[]},{route:'/posts/x',tags:[]}]}),/Duplicate/);});

test('retention protects active release even when given an expired list containing it',async()=>{const root=await mkdtemp(path.join(os.tmpdir(),'hadesd-retention-'));try{for(const id of ['old','active']){const s=empty(id);await prepareRelease({root,buildClient:await build(root,s),snapshot:s,origin:'https://hadesd.sh'});await activateRelease(root,id);}assert.equal(await pruneExpiredReleases(root,['old','active']),1);assert.equal(await currentRelease(root),'active');await assert.rejects(stat(path.join(root,'releases','old')));assert.equal(await pruneExpiredReleases(root,['old']),0);}finally{await rm(root,{recursive:true,force:true});}});

async function dualBuild(root, snapshot, origin, directory, assetDirectory) {
  const dir=path.join(root,directory);
  for (const route of snapshotRoutes(snapshot)) {
    const folder=path.join(dir,decodeURIComponent(route));
    await mkdir(folder,{recursive:true});
    await writeFile(path.join(folder,'index.html'),`<html><head><link rel="canonical" href="${origin}${route}"><meta property="og:url" content="${origin}${route}"><script>window.boot=1</script></head><body>${directory}</body></html>`);
  }
  await mkdir(path.join(dir,assetDirectory));
  await writeFile(path.join(dir,assetDirectory,'app-AbC123.js'),directory);
  return dir;
}

test('dual frontend publication shares a release pointer while isolating assets and SEO origins',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hadesd-dual-release-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const snapshot=empty('dual-release');
  const web=await dualBuild(root,snapshot,'https://hadesd.sh','web-build','assets');
  const journal=await dualBuild(root,snapshot,'https://itshades.dev','journal-build','journal-assets');
  await prepareRelease({root,buildClient:web,snapshot,origin:'https://hadesd.sh',journal:{buildClient:journal,origin:'https://itshades.dev'}});
  await activateRelease(root,snapshot.releaseId);
  for(const [folder,origin] of [['site','https://hadesd.sh'],['journal','https://itshades.dev']]){
    const site=path.join(root,'current',folder);
    assert.equal(JSON.parse(await readFile(path.join(site,'release.json'),'utf8')).releaseId,'dual-release');
    assert.match(await readFile(path.join(site,'index.html'),'utf8'),new RegExp(`rel="canonical" href="${origin}/"`));
    assert.match(await readFile(path.join(site,'index.html'),'utf8'),/Content-Security-Policy/);
    assert.ok((await readFile(path.join(site,'sitemap.xml'),'utf8')).includes(`<loc>${origin}/</loc>`));
    assert.ok((await readFile(path.join(site,'rss.xml'),'utf8')).includes(`<link>${origin}</link>`));
  }
  assert.equal(await readFile(path.join(root,'assets','app-AbC123.js'),'utf8'),'web-build');
  assert.equal(await readFile(path.join(root,'journal-assets','app-AbC123.js'),'utf8'),'journal-build');
});

test('invalid second frontend cannot become active or leave an activatable partial release',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hadesd-dual-failure-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const old=empty('old-release');await prepareRelease({root,buildClient:await build(root,old),snapshot:old,origin:'https://hadesd.sh'});await activateRelease(root,old.releaseId);
  const snapshot=empty('invalid-dual');
  const web=await dualBuild(root,snapshot,'https://hadesd.sh','web-build','assets');
  const journal=await dualBuild(root,snapshot,'https://itshades.dev','journal-build','journal-assets');
  await rm(path.join(journal,'posts','index.html'));
  await assert.rejects(prepareRelease({root,buildClient:web,snapshot,origin:'https://hadesd.sh',journal:{buildClient:journal,origin:'https://itshades.dev'}}),/Missing prerendered/);
  assert.equal(await currentRelease(root),'old-release');
  await assert.rejects(activateRelease(root,snapshot.releaseId));
  assert.equal(await currentRelease(root),'old-release');
});

test('dual frontend validation rejects copied metadata from the other domain',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hadesd-dual-seo-'));t.after(()=>rm(root,{recursive:true,force:true}));
  const snapshot=empty('wrong-origin');
  const web=await dualBuild(root,snapshot,'https://hadesd.sh','web-build','assets');
  const journal=await dualBuild(root,snapshot,'https://hadesd.sh','journal-build','journal-assets');
  await assert.rejects(prepareRelease({root,buildClient:web,snapshot,origin:'https://hadesd.sh',journal:{buildClient:journal,origin:'https://itshades.dev'}}),/canonical/i);
});

test('two frontend origins must use separate hostnames, even if ports or schemes differ',async t=>{
  const root=await mkdtemp(path.join(os.tmpdir(),'hadesd-same-host-'));t.after(()=>rm(root,{recursive:true,force:true}));
  for(const origin of ['https://hadesd.sh:8443','http://hadesd.sh']) {
    await assert.rejects(prepareRelease({root,buildClient:'unused',snapshot:empty('same-host'),origin:'https://hadesd.sh',journal:{buildClient:'unused',origin}}),/hostname/i);
  }
});
