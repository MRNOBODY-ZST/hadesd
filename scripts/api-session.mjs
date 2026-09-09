import { readFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
export class Session {
 constructor(origin=process.env.API_ORIGIN||'http://127.0.0.1:28080'){this.origin=origin;this.cookies=new Map();this.csrf=null;}
 async request(endpoint,{method='GET',body,raw=false,headers={}}={}){
  const h={...headers,Cookie:[...this.cookies].map(([k,v])=>`${k}=${v}`).join('; ')};
  if(method!=='GET'&&this.csrf)h[this.csrf.headerName]=this.csrf.token;
  let payload=body;
  if(body&&!(body instanceof FormData)&&!(body instanceof URLSearchParams)){h['Content-Type']='application/json';payload=JSON.stringify(body);}
  const response=await fetch(new URL('/api/v1'+endpoint,this.origin),{method,headers:h,body:payload,redirect:'manual',signal:AbortSignal.timeout(30000)});
  for(const cookie of response.headers.getSetCookie()){const [entry]=cookie.split(';');const split=entry.indexOf('=');this.cookies.set(entry.slice(0,split),entry.slice(split+1));}
  if(raw)return response;
  if(!response.ok){const problem=await response.json().catch(()=>({code:'HTTP_ERROR'}));throw new Error(`${method} ${endpoint}: ${response.status} ${problem.code??problem.title}`);}
  if(response.status===204)return null;const text=await response.text();return text?JSON.parse(text):null;
 }
 async refreshCsrf(){this.csrf=await this.request('/auth/csrf');return this.csrf;}
 async login(){await this.refreshCsrf();const password=(await readFile(process.env.ADMIN_BOOTSTRAP_PASSWORD_FILE,'utf8')).trim();await this.request('/auth/login',{method:'POST',body:new URLSearchParams({username:process.env.ADMIN_BOOTSTRAP_USERNAME||'hades',password})});await this.refreshCsrf();return this.request('/auth/me');}
 async publish(body){const job=await this.request('/admin/publish-jobs',{method:'POST',body});return this.waitJob(job.id);}
 async waitJob(id){for(let i=0;i<180;i++){const job=await this.request(`/admin/publish-jobs/${id}`);if(job.status==='SUCCEEDED')return job;if(job.status==='FAILED')throw new Error(`Publish failed: ${job.error}`);await delay(1000);}throw new Error('Publish did not complete within 180 seconds. Is the Worker running?');}
}
