import { test, expect, type APIRequestContext, type Page } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const api='/api/v1';
async function login(request:APIRequestContext){const token=await (await request.get(api+'/auth/csrf')).json();const response=await request.post(api+'/auth/login',{form:{username:process.env.ADMIN_BOOTSTRAP_USERNAME||'hades',password:(await readFile(process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE!,'utf8')).trim()},headers:{[token.headerName]:token.token}});expect(response.status()).toBe(200);return(await request.get(api+'/auth/csrf')).json();}
async function waitJob(request:APIRequestContext,id:string){for(let n=0;n<180;n++){const result=await request.get(api+`/admin/publish-jobs/${id}`);expect(result.ok()).toBeTruthy();const job=await result.json();if(job.status==='SUCCEEDED')return job;expect(job.status,job.error||'publisher job failed').not.toBe('FAILED');await new Promise(r=>setTimeout(r,1000));}throw new Error('Publisher timeout');}
async function enterTerminal(page:Page){
 const stage=page.locator('.terminal-stage');
 await expect(stage).toHaveAttribute('data-renderer',/^(WebGPU|WebGL2|DOM)$/,{timeout:35000});
 if(await stage.getAttribute('data-stage-ready')!=='true')await page.getByRole('button',{name:'跳过片头，进入终端',exact:true}).click();
 await expect(stage).toHaveAttribute('data-stage-ready','true',{timeout:35000});
 await expect(stage).toHaveAttribute('data-reveal-step','7');
}
test('real persisted draft → media → publish → edit isolation → withdraw → rollback',async({request,page})=>{
 const csrf=await login(request);const headers={[csrf.headerName]:csrf.token};
 const publish=async(body:object)=>{const res=await request.post(api+'/admin/publish-jobs',{headers,data:body});expect(res.status()).toBe(202);return waitJob(request,(await res.json()).id);};
 const initial=await(await request.get(api+'/public/release')).json();
 const slug=`qa-lifecycle-${Date.now()}`;
 const draft={type:'POST',title:'示例验收 · Reactive 发布闭环',slug,summary:'自动化验收测试内容，结束后撤稿。',markdown:'# 验收正文\n\n尚未发布的独特文本 draft-secret-'+slug,tags:['验收示例'],language:'zh-CN'};
 const created=await request.post(api+'/admin/contents',{headers,data:draft});expect(created.status()).toBe(201);let content=await created.json();
 expect((await request.get(api+'/public/contents/'+content.id)).status()).toBe(404);
 const hidden=await(await request.get(api+'/public/search',{params:{q:slug}})).json();expect(hidden.total).toBe(0);
 const noCsrf=await request.post(api+`/admin/contents/${content.id}/revisions`,{data:{...draft,version:content.version}});expect(noCsrf.status()).toBe(403);
 const forbidden=await request.post(api+'/admin/media',{headers,multipart:{file:{name:'unsafe.svg',mimeType:'image/svg+xml',buffer:Buffer.from('<svg onload="alert(1)"></svg>')}}});expect(forbidden.status()).toBe(415);
 const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aF5sAAAAASUVORK5CYII=','base64');
 const uploaded=await request.post(api+'/admin/media',{headers,multipart:{file:{name:'qa.png',mimeType:'image/png',buffer:png}}});expect(uploaded.status()).toBe(201);const media=await uploaded.json();
 expect((await request.get(api+'/public/media/'+media.id)).status()).toBe(404);
 const saved=await request.post(api+`/admin/contents/${content.id}/revisions`,{headers,data:{...draft,markdown:'# 验收正文\n\n已发布版本一。\n\n![验收图片](/api/v1/public/media/'+media.id+')\n\n```js\nconst daemon = true;\n```',version:content.version}});expect(saved.status()).toBe(200);content=await saved.json();const revisionOne=content.latestRevision;
 const conflict=await request.post(api+`/admin/contents/${content.id}/revisions`,{headers,data:{...draft,version:1}});expect(conflict.status()).toBe(409);
 try{
 const first=await publish({operation:'PUBLISH',contentId:content.id,revisionId:revisionOne.id});
 expect((await request.get(api+'/public/media/'+media.id)).status()).toBe(200);
 await page.goto('/posts/'+slug);await enterTerminal(page);await expect(page.getByRole('heading',{name:draft.title,exact:true})).toBeVisible();await expect(page.getByText('已发布版本一。',{exact:true})).toBeVisible();
 const updated=await request.post(api+`/admin/contents/${content.id}/revisions`,{headers,data:{...draft,version:content.version,markdown:'# 新修订\n\n新草稿独特文本 UNPUBLISHED-'+slug}});expect(updated.status()).toBe(200);content=await updated.json();
 const publicBefore=await(await request.get(api+'/public/contents/'+content.id)).json();expect(publicBefore.revisionId).toBe(revisionOne.id);expect(publicBefore.markdown).toContain('已发布版本一');
 const immutable=await(await request.get(api+`/admin/contents/${content.id}/revisions/${revisionOne.id}`)).json();expect(immutable.markdown).toContain('已发布版本一');
 await page.reload();await enterTerminal(page);await expect(page.getByText('已发布版本一。',{exact:true})).toBeVisible();
 const second=await publish({operation:'PUBLISH',contentId:content.id,revisionId:content.latestRevision.id});
 const stale=await request.get(api+'/public/contents',{params:{releaseId:first.releaseId}});expect(stale.status()).toBe(409);expect((await stale.json()).code).toBe('RELEASE_CHANGED');
 await page.reload();await enterTerminal(page);await expect(page.getByText('新草稿独特文本 UNPUBLISHED-'+slug,{exact:true})).toBeVisible();
 await publish({operation:'WITHDRAW',contentId:content.id});
 expect((await request.get('/posts/'+slug)).status()).toBe(404);expect((await request.get(api+'/public/contents/'+content.id)).status()).toBe(404);expect((await request.get(api+'/public/media/'+media.id)).status()).toBe(404);
 const blockedDelete=await request.delete(api+'/admin/media/'+media.id,{headers});expect(blockedDelete.status()).toBe(409);
 await publish({operation:'ROLLBACK',releaseId:first.releaseId});expect((await request.get('/posts/'+slug)).status()).toBe(200);
 const restored=await(await request.get(api+'/public/contents/'+content.id)).json();expect(restored.revisionId).toBe(revisionOne.id);
 }finally{
 if(initial.releaseId)await publish({operation:'ROLLBACK',releaseId:initial.releaseId});else await publish({operation:'WITHDRAW',contentId:content.id});
 }
});
test('anonymous security boundaries and true static 404',async({request})=>{
 expect((await request.get(api+'/admin/contents')).status()).toBe(401);
 expect((await request.get(api+'/auth/me')).status()).toBe(401);
 expect((await request.get(api+'/internal/snapshot/anything')).status()).toBe(403);
 for(const target of ['/posts/does-not-exist','/releases/private','/snapshot.json','/manifest.json'])expect((await request.get(target)).status()).toBe(404);
});
