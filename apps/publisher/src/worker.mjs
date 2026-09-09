import { spawn } from 'node:child_process';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { activateRelease, currentRelease, prepareRelease, pruneExpiredReleases, validId } from './release.mjs';

const workspace=path.resolve(import.meta.dirname,'../../..');
const root=path.resolve(process.env.RELEASE_ROOT||path.join(workspace,'.local/published'));
const api=new URL('/api/v1/internal/',process.env.API_ORIGIN||'http://127.0.0.1:28080');
const token=process.env.WORKER_TOKEN;
if(!token||token.length<32) throw new Error('WORKER_TOKEN must contain at least 32 characters');
// Preserve Node's automatic heap sizing unless an operator supplies a budget.
// Accept only a heap size, never arbitrary NODE_OPTIONS such as --require.
const buildHeapMb=process.env.PUBLISHER_BUILD_HEAP_MB;
if(buildHeapMb!==undefined&&(!/^\d+$/.test(buildHeapMb)||Number(buildHeapMb)<256||Number(buildHeapMb)>32768)) {
  throw new Error('PUBLISHER_BUILD_HEAP_MB must be an integer between 256 and 32768 MiB');
}
let stopping=false;
process.on('SIGINT',()=>{stopping=true;}); process.on('SIGTERM',()=>{stopping=true;});
async function request(relative, method='GET', body) {
  let response;
  try {response=await fetch(new URL(relative,api),{method,headers:{'X-Worker-Token':token,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(30000)});} catch {throw new Error(`Internal API ${method} ${relative} timed out or was unavailable`);}
  if(response.status===204)return null;
  if(!response.ok)throw new Error(`Internal API ${method} ${relative} failed (${response.status})`);
  return response.json();
}
function build(snapshotFile,buildDir,signal) {
  return new Promise((resolve,reject)=>{
    const started=Date.now();
    const heapBudget=buildHeapMb===undefined?'automatic':`${Number(buildHeapMb)} MiB`;
    console.log(`static build started (Node old-space ${heapBudget})`);
    // Fixed command/arguments. Article text, slugs and user input never become executable text.
    const child=spawn('pnpm',['--filter','@hadesd/web','build'],{
      cwd:workspace, shell:false, signal,
      env:{PATH:process.env.PATH,HOME:process.env.HOME,CI:'true',NODE_ENV:'production',...(buildHeapMb===undefined?{}:{NODE_OPTIONS:`--max-old-space-size=${Number(buildHeapMb)}`}),HADESD_SNAPSHOT:snapshotFile,HADESD_BUILD_DIR:buildDir,SITE_ORIGIN:process.env.SITE_ORIGIN||'https://hadesd.sh'},
      stdio:['ignore','pipe','pipe']
    });
    // Drain output without retaining or logging article text, private paths or environment values.
    for(const stream of [child.stdout,child.stderr]) stream.resume();
    child.once('error',reject);
    child.once('close',(code,exitSignal)=>{
      const diagnostic=`exit ${code??'none'}, signal ${exitSignal??'none'}, Node old-space ${heapBudget}, ${Date.now()-started} ms`;
      if(code===0) {console.log(`static build completed (${diagnostic})`);resolve();}
      else {
        const hint=code===137||exitSignal==='SIGKILL'
          ? 'check container OOM evidence and PUBLISHER_MEMORY_LIMIT before retrying'
          : 'run the trusted web build locally to inspect diagnostics';
        reject(new Error(`Static build failed (${diagnostic}); ${hint}`));
      }
    });
  });
}
export async function runOnce() {
  const job=await request('jobs/claim','POST',{}); if(!job)return false;
  const id=validId(job.releaseId);const controller=new AbortController();let leaseError;
  const status=(value,error)=>request(`jobs/${validId(job.id)}/status`,'POST',{leaseToken:job.leaseToken,status:value,...(error?{error}:{})});
  const heartbeat=setInterval(()=>{request(`jobs/${job.id}/heartbeat`,'POST',{leaseToken:job.leaseToken}).catch(error=>{leaseError=error;controller.abort();});},15000);heartbeat.unref();
  try {
    if(await currentRelease(root)===id) {await status('SUCCEEDED'); console.log(`reconciled ${id}`);return true;}
    const snapshot=await request(`snapshot/${id}`);
    if(snapshot.releaseId!==id)throw new Error('Snapshot identity mismatch');
    const work=path.join(root,'work',id);await mkdir(work,{recursive:true});
    const snapshotFile=path.join(work,'snapshot.json');await writeFile(snapshotFile,JSON.stringify(snapshot),{mode:0o600});
    const buildDir=path.join(work,'build');
    await build(snapshotFile,buildDir,controller.signal);if(leaseError)throw leaseError;
    await prepareRelease({root,buildClient:path.join(buildDir,'client'),snapshot,origin:process.env.SITE_ORIGIN||'https://hadesd.sh'});
    console.log(`validated ${id}`);
    await status('READY'); if(leaseError)throw leaseError;
    console.log(`ready ${id}`);
    await status('DEPLOYING'); if(leaseError)throw leaseError;
    // No asynchronous API action between final lease verification and pointer switch.
    await request(`jobs/${job.id}/heartbeat`,'POST',{leaseToken:job.leaseToken});
    await activateRelease(root,id);
    await status('SUCCEEDED');
    await rm(work,{recursive:true,force:true});
    try {const retention=await request('retention');await pruneExpiredReleases(root,retention.expiredReleaseIds);} catch {console.warn('retention deferred; live release is unaffected');}
    console.log(`published ${id}`);return true;
  } catch(error) {
    // A switch is authoritative even if the API acknowledgement was interrupted.
    const active=await currentRelease(root).catch(()=>null);
    if(active===id) {try {await status('SUCCEEDED');}catch{} console.warn(`activation ${id} awaits reconciliation`);}
    else {try {await status('FAILED',error.name==='AbortError'?'Build cancelled after lease loss. Retry the job.':'Static build or validation failed. Inspect local build and retry.');} catch{}console.error(`publish ${id} failed: ${error.message.replaceAll(root,'[release-root]').replaceAll(workspace,'[workspace]')}`);}
    return true;
  }finally{clearInterval(heartbeat);}
}
await mkdir(root,{recursive:true});
if(process.argv.includes('--once'))await runOnce();
else while(!stopping){try{await runOnce();}catch(error){console.error(`publisher unavailable: ${error.message}`);} if(!stopping)await delay(Math.max(1000,Math.min(60000,Number(process.env.WORKER_POLL_MS)||3000)));}
