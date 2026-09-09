import { spawn } from 'node:child_process';
import { readdir, readFile, writeFile, mkdir, cp } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { verifyDirectory } from './file-integrity.mjs';
const root=path.resolve(import.meta.dirname,'..');
const backups=path.join(root,'.local/backups');
const name=process.argv[2]||(await readdir(backups)).sort().at(-1);
if(!name||name.includes('/')||name.includes('..'))throw new Error('Expected a backup directory name');
const backup=path.join(backups,name);const manifest=JSON.parse(await readFile(path.join(backup,'backup.json'),'utf8'));
const sql=await readFile(path.join(backup,'database.sql'));
if(createHash('sha256').update(sql).digest('hex')!==manifest.databaseSha256)throw new Error('Backup checksum mismatch');
const database=`hadesd_restore_${Date.now()}`;
async function mysql(input){return new Promise((resolve,reject)=>{
 const child=spawn('docker',['compose','--env-file','.env','-f','infra/compose/dependencies.yaml','exec','-T','-e','MYSQL_PWD','mysql','mysql','-uroot','--batch','--skip-column-names'],{cwd:root,env:{...process.env,MYSQL_PWD:process.env.MYSQL_ROOT_PASSWORD},stdio:['pipe','pipe','pipe']});let output='',error='';child.stdout.on('data',x=>output+=x);child.stderr.on('data',x=>error+=x);child.on('error',reject);child.on('close',code=>code===0?resolve(output):reject(new Error(`Restore command failed (${code})`)));child.stdin.end(input);
});}
await mysql(`CREATE DATABASE ${database} CHARACTER SET utf8mb4;\n`);
try{
 await mysql(Buffer.concat([Buffer.from(`USE ${database};\n`),sql]));
 // Read only the restored schema. Optional tables may be absent in pre-V4 backups;
 // absence is reported separately instead of being confused with an empty table.
 const tables=[
  ['content','contents'],['revision','revisions'],['release_snapshot','releases'],
  ['media','media'],['revision_media','revision_media'],['release_media','release_media'],
  ['blog_account','blog_account'],['blog_comment','blog_comment'],
  ['user_file','user_file'],['comment_file','comment_file']
 ];
 const existing=new Set((await mysql(`SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA='${database}' AND TABLE_TYPE='BASE TABLE';`)).trim().split('\n').filter(Boolean));
 const missingCore=tables.slice(0,3).filter(([table])=>!existing.has(table)).map(([table])=>table);
 if(missingCore.length)throw new Error(`Restored backup is missing required tables: ${missingCore.join(', ')}`);
 const present=tables.filter(([table])=>existing.has(table));
 // Identifiers and labels below come exclusively from the fixed allowlist above.
 const counts=await mysql(present.map(([table,label])=>`SELECT '${label}', COUNT(*) FROM ${database}.${table}`).join(' UNION ALL ')+';');
 const rowCounts=new Map(counts.trim().split('\n').map(line=>{const [label,count]=line.split('\t');return [label,Number(count)];}));
 const restoredTables=tables.map(([table,label])=>({table,present:existing.has(table),rowCount:existing.has(table)?rowCounts.get(label):null}));
 if(restoredTables.some(table=>table.present&&(!Number.isSafeInteger(table.rowCount)||table.rowCount<0)))throw new Error('Invalid restored table row count');
 const absentOptionalTables=restoredTables.filter(table=>!table.present).map(table=>table.table);
 const restored=path.join(root,'.local/restore-drill',name);await mkdir(restored,{recursive:true});
 await cp(path.join(backup,'media'),path.join(restored,'media'),{recursive:true});await cp(path.join(backup,'published'),path.join(restored,'published'),{recursive:true,verbatimSymlinks:true});
 const verifiedFiles=manifest.integrity?{media:await verifyDirectory(path.join(restored,'media'),manifest.integrity.media),published:await verifyDirectory(path.join(restored,'published'),manifest.integrity.published)}:null;
 if(manifest.release){const restoredManifest=JSON.parse(await readFile(path.join(restored,'published/current/manifest.json'),'utf8'));if(restoredManifest.releaseId!==manifest.release.releaseId)throw new Error('Restored release pointer mismatch');}
 const report={performedAt:new Date().toISOString(),backup:name,databaseSha256:manifest.databaseSha256,restoredCounts:counts.trim().split('\n'),restoredTables,absentOptionalTables,releaseId:manifest.release?.releaseId??null,verifiedFiles,result:'PASS',method:'isolated temporary MySQL database + copied immutable media and release files'};
 await mkdir(path.join(root,'.local/reports'),{recursive:true});await writeFile(path.join(root,'.local/reports/restore.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await mysql(`DROP DATABASE ${database};`);}
