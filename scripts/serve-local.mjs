import http from 'node:http';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'..');
const published=path.resolve(process.env.RELEASE_ROOT||path.join(root,'.local/published'));
const admin=path.join(root,'apps/admin/dist');
const api=new URL(process.env.API_ORIGIN||'http://127.0.0.1:28080');
const mime={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.xml':'application/xml; charset=utf-8','.txt':'text/plain; charset=utf-8','.data':'text/x-script; charset=utf-8','.woff2':'font/woff2','.woff':'font/woff','.ttf':'font/ttf','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'};
const server=http.createServer(async(req,res)=>{
  // Node normalizes upstream headers to lowercase; use the same keys to avoid duplicate policies.
  const headers={'x-content-type-options':'nosniff','referrer-policy':'strict-origin-when-cross-origin','x-frame-options':'DENY','content-security-policy':"frame-ancestors 'none'",'cache-control':'no-store'};
  let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400,headers).end('Invalid URL');return;}
  if(pathname.includes('\\')||pathname.split('/').some(p=>p==='..'||p.startsWith('.'))||/[\u0000-\u001f]/u.test(pathname)){res.writeHead(400,headers).end('Invalid path');return;}
  if(pathname.startsWith('/api/')){
    if(pathname.startsWith('/api/v1/internal')){res.writeHead(403,headers).end('Internal API');return;}
    const proxy=http.request(new URL(req.url,api),{method:req.method,headers:{...req.headers,host:api.host}},upstream=>{res.writeHead(upstream.statusCode,{...headers,...upstream.headers});upstream.pipe(res);});
    proxy.on('error',()=>{if(!res.headersSent)res.writeHead(503,{...headers,'Content-Type':'application/problem+json'});res.end(JSON.stringify({status:503,code:'API_UNAVAILABLE',title:'后端暂不可用',detail:'静态正文仍可阅读；请稍后重试动态操作。'}));});req.pipe(proxy);return;
  }
  if(!['GET','HEAD'].includes(req.method)){res.writeHead(405,headers).end();return;}
  if(pathname==='/admin'){res.writeHead(308,{...headers,Location:'/admin/'}).end();return;}
  const isAdmin=pathname.startsWith('/admin/');
  let file=path.join(isAdmin?admin:path.join(published,'current/site'),isAdmin?pathname.slice(7):pathname);
  let code=200;
  async function existing(candidate){try{return(await stat(candidate)).isFile();}catch{return false;}}
  if(pathname.startsWith('/assets/')&&!await existing(file))file=path.join(published,pathname);
  if(!await existing(file)){
    if(await existing(path.join(file,'index.html')))file=path.join(file,'index.html');
    else if(isAdmin&&!path.extname(pathname))file=path.join(admin,'index.html');
    else {code=404;file=path.join(published,'current/site/404/index.html');}
  }
  if(!await existing(file)){res.writeHead(code===404?404:503,{...headers,'Content-Type':'text/html; charset=utf-8'}).end('<!doctype html><html lang="zh-CN"><meta charset="utf-8"><title>HADESD · 等待首次发布</title><body style="background:#11130f;color:#e7e4d8;font:18px system-ui;padding:10vw"><h1>HADESD</h1><p>a personal daemon.</p><p>尚未生成公开版本。请在管理后台初始化空站点或发布文章。</p><a href="/admin/" style="color:#e8b86d">打开管理后台 →</a></body></html>');return;}
  if(isAdmin)headers['content-security-policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'";
  if(pathname.includes('/assets/'))headers['cache-control']='public, max-age=31536000, immutable';
  res.writeHead(code,{...headers,'Content-Type':mime[path.extname(file)]||'application/octet-stream'});
  if(req.method==='HEAD')res.end();else createReadStream(file).on('error',()=>res.destroy()).pipe(res);
});
server.listen(Number(process.env.LOCAL_PORT)||18088,'127.0.0.1',()=>console.log(`HADESD local: http://127.0.0.1:${server.address().port} | /admin/`));
