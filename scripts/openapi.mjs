import { writeFile } from 'node:fs/promises';
const str={type:'string'};const id={type:'string',format:'uuid'};const date={type:'string',format:'date-time'};
const ref=name=>({$ref:`#/components/schemas/${name}`});
const object=(properties,required=Object.keys(properties))=>({type:'object',properties,required});
const arr=items=>({type:'array',items});
const rev={title:{type:'string',minLength:1,maxLength:200},slug:{type:'string',maxLength:100,pattern:'^[a-z0-9]+(?:-[a-z0-9]+)*$'},summary:{type:'string',maxLength:1000},markdown:{type:'string',maxLength:2000000},tags:{type:'array',maxItems:30,items:{type:'string',maxLength:40}},language:str,coverMediaId:{type:['string','null']}};
const required=Object.keys(rev).filter(k=>k!=='coverMediaId');
const types={type:'string',enum:['POST','PROJECT','RESEARCH','PAGE']};
const schemas={
 RevisionInput:object(rev,required),
 Revision:object({...rev,id,contentId:id,createdAt:date},['id','contentId','createdAt',...required]),
 Content:object({id,type:types,version:{type:'integer',minimum:1},createdAt:date,latestRevision:ref('Revision')}),
 CreateContent:object({...rev,type:types},['type',...required]),
 SaveRevision:object({...rev,version:{type:'integer',minimum:1}},['version',...required]),
 PublicContent:object({...rev,id,type:types,revisionId:id,route:str,publishedAt:date,updatedAt:date},['id','type','revisionId','route','publishedAt','updatedAt',...required]),
 SiteSettings:object({title:str,tagline:str,introduction:str,homeText:str,navigation:arr(object({label:str,href:str})),links:arr(object({label:str,url:{type:'string',format:'uri'},description:str},['label','url'])),heroTitle:{type:['string','null'],maxLength:120}},['title','tagline','introduction','homeText','navigation','links']),
 ReleaseInfo:object({state:{type:'string',enum:['EMPTY','ACTIVE']},releaseId:{type:['string','null']},createdAt:{type:['string','null']}},['state','releaseId']),
 ReleaseSnapshot:object({releaseId:id,createdAt:date,site:ref('SiteSettings'),contents:arr(ref('PublicContent'))}),
 PublishRequest:object({operation:{type:'string',enum:['PUBLISH','WITHDRAW','ROLLBACK','INITIALIZE','SETTINGS']},contentId:id,revisionId:id,releaseId:id},['operation']),
 PublishJob:object({id,releaseId:id,operation:str,status:{type:'string',enum:['QUEUED','BUILDING','READY','DEPLOYING','SUCCEEDED','FAILED']},createdAt:date,attempts:{type:'integer'},error:{type:['string','null']},leaseToken:{type:['string','null']}},['id','releaseId','operation','status','createdAt','attempts']),
 Release:object({id,createdAt:date,status:str}),
 Media:object({id,filename:str,mime:{type:'string',enum:['image/png','image/jpeg','image/webp','application/pdf']},size:{type:'integer'},createdAt:date}),
 Problem:object({type:str,title:str,status:{type:'integer'},detail:str,code:str,requestId:str}),
 Csrf:object({token:str,headerName:str}),
 LeaseRequest:object({leaseToken:str}),
 StatusRequest:object({leaseToken:str,status:schemasPlaceholder(),error:str},['leaseToken','status'])
};
function schemasPlaceholder(){return {type:'string',enum:['READY','DEPLOYING','SUCCEEDED','FAILED']};}
for(const name of ['Content','Revision','PublicContent','Release','Media'])schemas[name+'Page']=object({items:arr(ref(name)),page:{type:'integer'},size:{type:'integer'},total:{type:'integer'}});
const paths={};
function add(method,url,response,body,code=200){
 const internal=url.startsWith('/internal/'),auth=url.startsWith('/admin/')||url==='/auth/me'||url==='/auth/logout';
 const parameters=[...url.matchAll(/\{([^}]+)\}/g)].map(m=>({name:m[1],in:'path',required:true,schema:id}));
 if(method==='get'&&typeof response==='string'&&response.endsWith('Page'))parameters.push({name:'page',in:'query',schema:{type:'integer',minimum:0,default:0}},{name:'size',in:'query',schema:{type:'integer',minimum:1,maximum:100,default:20}});
 if(url.startsWith('/public/')&&!url.includes('/media/')&&!url.endsWith('/release'))parameters.push({name:'releaseId',in:'query',schema:str,description:'A stale value returns 409 RELEASE_CHANGED, never historical withdrawn content.'});
 if(url==='/public/search')parameters.push({name:'q',in:'query',required:true,schema:{type:'string',maxLength:200}});
 if(url==='/public/contents')parameters.push({name:'type',in:'query',schema:types},{name:'tag',in:'query',schema:str});
 const operation={operationId:method+url.replace(/[^a-z0-9]/gi,'_'),tags:[url.split('/')[1]],security:internal?[{WorkerToken:[]}]:auth?[{Session:[]}]:[],parameters,responses:{[code]:{description:'Success',...(response?{content:{'application/json':{schema:typeof response==='string'?ref(response):response}}}:{})},default:{description:'Problem Details with stable code and requestId',content:{'application/problem+json':{schema:ref('Problem')}}}}};
 if(body)operation.requestBody={required:true,content:{'application/json':{schema:ref(body)}}};
 if(method!=='get'&&!internal)operation.parameters.push({name:'X-CSRF-TOKEN',in:'header',required:true,schema:str,description:'Use the actual headerName returned by GET /auth/csrf. Refresh after login/logout.'});
 (paths[url]??={})[method]=operation;
}
add('get','/auth/csrf','Csrf');add('get','/auth/me',object({username:str}));add('post','/auth/login',null);paths['/auth/login'].post.requestBody={required:true,content:{'application/x-www-form-urlencoded':{schema:object({username:str,password:{type:'string',format:'password'}})}}};add('post','/auth/logout',null,null,204);
add('get','/admin/contents','ContentPage');add('post','/admin/contents','Content','CreateContent',201);add('get','/admin/contents/{id}','Content');add('get','/admin/contents/{id}/revisions','RevisionPage');add('post','/admin/contents/{id}/revisions','Content','SaveRevision');add('get','/admin/contents/{id}/revisions/{revisionId}','Revision');
add('get','/admin/settings','SiteSettings');add('put','/admin/settings','SiteSettings','SiteSettings');add('get','/admin/media','MediaPage');add('post','/admin/media','Media',null,201);paths['/admin/media'].post.requestBody={required:true,content:{'multipart/form-data':{schema:object({file:{type:'string',format:'binary'}})}}};add('get','/admin/media/{id}/content',null);add('delete','/admin/media/{id}',null,null,204);
add('post','/admin/publish-jobs','PublishJob','PublishRequest',202);add('get','/admin/publish-jobs/{id}','PublishJob');add('get','/admin/releases','ReleasePage');add('post','/admin/releases/{id}/rollback-jobs','PublishJob',null,202);
add('get','/public/release','ReleaseInfo');add('get','/public/site','SiteSettings');add('get','/public/contents','PublicContentPage');add('get','/public/contents/{id}','PublicContent');add('get','/public/tags',arr(str));add('get','/public/search','PublicContentPage');add('get','/public/media/{id}',null);
add('get','/internal/retention',object({expiredReleaseIds:arr(id)}));add('get','/internal/snapshot/{releaseId}','ReleaseSnapshot');add('post','/internal/jobs/claim','PublishJob');paths['/internal/jobs/claim'].post.responses['204']={description:'No claimable task'};add('post','/internal/jobs/{id}/heartbeat',null,'LeaseRequest',204);add('post','/internal/jobs/{id}/status','PublishJob','StatusRequest');
await writeFile(new URL('../docs/openapi.json',import.meta.url),JSON.stringify({openapi:'3.1.0',info:{title:'HADESD Reactive API',version:'1.0.0',description:'Session + CSRF protected single-author CMS. Internal Worker API is not publicly proxied.'},servers:[{url:'/api/v1'}],paths,components:{schemas,securitySchemes:{Session:{type:'apiKey',in:'cookie',name:'HADESD_SESSION'},WorkerToken:{type:'apiKey',in:'header',name:'X-Worker-Token'}}}},null,2)+'\n');
