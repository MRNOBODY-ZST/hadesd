import { spawn } from 'node:child_process';
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
const root=path.resolve(import.meta.dirname,'..');
const mode=process.argv[2]||'run';
let command,args;
if(mode==='build'){command='./gradlew';args=['clean','bootJar'];}
else if(mode==='test'){command='./gradlew';args=['test'];}
else if(mode==='run'||mode==='bootstrap'||mode==='cleanup'){
 const files=await readdir(path.join(root,'backend/build/libs')).catch(()=>[]);
 const jar=files.find(f=>f.endsWith('.jar')&&!f.endsWith('-plain.jar'));
 if(!jar)throw new Error('Build the backend first: pnpm backend:build');
 const bytes=await readFile(path.join(root,'backend/build/libs',jar));
 const runtime=path.join(root,'.local/runtime');await mkdir(runtime,{recursive:true});
 const stableJar=path.join(runtime,`daemon-${createHash('sha256').update(bytes).digest('hex').slice(0,16)}.jar`);
 await writeFile(stableJar,bytes,{flag:'wx'}).catch(error=>{if(error.code!=='EEXIST')throw error;});
 command='java';args=['--enable-native-access=ALL-UNNAMED','-jar',stableJar,...(mode==='bootstrap'?['--bootstrap-admin']:mode==='cleanup'?['--cleanup-media',...process.argv.slice(3)]:[])];
}else throw new Error('Expected build, test, run, bootstrap or cleanup');
const child=spawn(command,args,{cwd:path.join(root,'backend'),env:process.env,stdio:'inherit',shell:false});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>child.kill(signal));
child.on('exit',code=>{process.exitCode=code??1;});child.on('error',error=>{console.error(error.message);process.exitCode=1;});
