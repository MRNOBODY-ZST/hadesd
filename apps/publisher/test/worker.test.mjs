import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { createServer } from 'node:http';
import { spawn } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { activateRelease, prepareRelease, snapshotRoutes, currentRelease } from '../src/release.mjs';

for(const failJournal of [false,true]) {
  test(`worker ${failJournal ? 'keeps the old release when journal build fails' : 'builds both frontends with one snapshot and separate origins'}`,async t=>{
    const root=await mkdtemp(path.join(tmpdir(),'dual-worker-'));
    t.after(()=>rm(root,{recursive:true,force:true}));
    const snapshot={releaseId:'new-release',createdAt:'2026-11-11T00:00:00Z',site:{title:'Blog',tagline:'Notes'},contents:[]};
    const old={...snapshot,releaseId:'old-release'};
    const oldBuild=path.join(root,'old-build');
    for(const route of snapshotRoutes(old)) {
      const folder=path.join(oldBuild,route);await mkdir(folder,{recursive:true});
      await writeFile(path.join(folder,'index.html'),'<html><head></head><body>old</body></html>');
    }
    await prepareRelease({root,buildClient:oldBuild,snapshot:old,origin:'https://hadesd.sh'});await activateRelease(root,old.releaseId);
    const bin=path.join(root,'bin');await mkdir(bin);
    // The fake executable replaces only the expensive compiler boundary. The
    // worker still claims jobs over HTTP and stages/activates real artifacts.
    await writeFile(path.join(bin,'pnpm'),`#!${process.execPath}\n`+`
      const fs=require('node:fs/promises'), path=require('node:path');
      (async()=>{
        const pkg=process.argv[3], snapshot=JSON.parse(await fs.readFile(process.env.HADESD_SNAPSHOT,'utf8'));
        await fs.appendFile(path.join(process.env.HOME,'builds.jsonl'),JSON.stringify({pkg,snapshot:process.env.HADESD_SNAPSHOT,origin:process.env.SITE_ORIGIN})+'\\n');
        if(${failJournal} && pkg==='@hadesd/journal')process.exit(17);
        const client=path.join(process.env.HADESD_BUILD_DIR,'client');
        for(const route of ${JSON.stringify(snapshotRoutes(snapshot))}) {
          const folder=path.join(client,route);await fs.mkdir(folder,{recursive:true});
          const url=process.env.SITE_ORIGIN+route;
          await fs.writeFile(path.join(folder,'index.html'),'<html><head><link rel="canonical" href="'+url+'"><meta property="og:url" content="'+url+'"></head><body>'+snapshot.releaseId+'</body></html>');
        }
      })().catch(error=>{console.error(error);process.exit(1)});
    `,{mode:0o755});
    const statuses=[];
    const server=createServer(async(req,res)=>{
      let raw='';for await(const chunk of req)raw+=chunk;
      res.setHeader('Content-Type','application/json');
      if(req.url.endsWith('/jobs/claim'))res.end(JSON.stringify({id:'job-a',releaseId:snapshot.releaseId,leaseToken:'lease'}));
      else if(req.url.includes('/snapshot/'))res.end(JSON.stringify(snapshot));
      else if(req.url.endsWith('/status')){statuses.push(JSON.parse(raw).status);res.end('{}');}
      else if(req.url.endsWith('/retention'))res.end(JSON.stringify({expiredReleaseIds:[]}));
      else res.end('{}');
    });
    await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
    t.after(()=>new Promise(resolve=>server.close(resolve)));
    const child=spawn(process.execPath,[path.resolve(import.meta.dirname,'../src/worker.mjs'),'--once'],{env:{...process.env,PATH:`${bin}:${process.env.PATH}`,HOME:root,API_ORIGIN:`http://127.0.0.1:${server.address().port}`,RELEASE_ROOT:root,SITE_ORIGIN:'https://hadesd.sh',JOURNAL_SITE_ORIGIN:'https://itshades.dev',WORKER_TOKEN:'a'.repeat(32)},stdio:['ignore','pipe','pipe']});
    let diagnostics='';for(const stream of [child.stdout,child.stderr])stream.on('data',chunk=>{diagnostics+=chunk;});
    const code=await new Promise((resolve,reject)=>{child.once('error',reject);child.once('exit',resolve);});
    assert.equal(code,0,diagnostics);
    const builds=(await readFile(path.join(root,'builds.jsonl'),'utf8')).trim().split('\n').map(JSON.parse);
    assert.deepEqual(builds.map(({pkg,origin})=>({pkg,origin})),[{pkg:'@hadesd/web',origin:'https://hadesd.sh'},{pkg:'@hadesd/journal',origin:'https://itshades.dev'}]);
    assert.equal(builds[0].snapshot,builds[1].snapshot);
    assert.equal(await currentRelease(root),failJournal ? 'old-release' : 'new-release');
    assert.deepEqual(statuses,failJournal ? ['FAILED'] : ['READY','DEPLOYING','SUCCEEDED']);
  });
}
