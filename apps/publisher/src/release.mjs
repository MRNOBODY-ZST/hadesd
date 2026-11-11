import { createHash, randomUUID } from 'node:crypto';
import { cp, mkdir, readFile, readdir, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { normalizeSiteOrigin } from '../../../packages/contracts/src/site-origin.mjs';

export const SAFE_ID = /^[a-zA-Z0-9][a-zA-Z0-9-]{0,79}$/;
export function validId(id) { if (typeof id !== 'string' || !SAFE_ID.test(id)) throw new Error('Invalid release identifier'); return id; }
export function validRoute(route) {
  if (typeof route !== 'string' || !route.startsWith('/') || /[\\?#\u0000-\u0020]/u.test(route)) throw new Error('Invalid public route');
  let decoded; try { decoded = decodeURIComponent(route); } catch { throw new Error('Invalid route encoding'); }
  if (decoded.split('/').some(p=>p==='..'||p==='.') || decoded.includes('\\') || /[\u0000-\u001f]/u.test(decoded)) throw new Error('Unsafe public route');
  if (!/^\/(?:$|posts(?:\/[^/]+)?$|projects(?:\/[^/]+)?$|research(?:\/[^/]+)?$|tags\/[^/]+$|about$|now$|links$|search$|404$)/u.test(decoded)) throw new Error('Route is outside public namespace');
  return route;
}
export function snapshotRoutes(snapshot) {
  const routes = new Set(['/', '/posts', '/projects', '/research', '/about', '/now', '/links', '/search', '/404']);
  const contentRoutes = new Set();
  for (const content of snapshot.contents) {
    const route = validRoute(content.route);
    if (contentRoutes.has(route)) throw new Error('Duplicate public path');
    contentRoutes.add(route); routes.add(route);
    for (const tag of content.tags) routes.add(validRoute(`/tags/${encodeURIComponent(tag)}`));
  }
  return [...routes];
}
const escapeXml = value => String(value).replace(/[<>&"']/g, c=>({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":'&apos;'}[c]));
const hash = value => createHash('sha256').update(value).digest('base64');
export function secureHtml(html) {
  const hashes = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(m=>! /\bsrc\s*=/i.test(m[1])).map(m=>`'sha256-${hash(m[2])}'`);
  const csp = `default-src 'self'; script-src 'self' ${[...new Set(hashes)].join(' ')}; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'`;
  return html.replace(/<head([^>]*)>/i, `<head$1><meta http-equiv="Content-Security-Policy" content="${csp.replaceAll('"','&quot;')}">`);
}
async function walk(folder) {
  const out=[];
  for (const entry of await readdir(folder, {withFileTypes:true})) {
    if (entry.isSymbolicLink()) throw new Error('Symlink in build artifacts');
    const file=path.join(folder,entry.name);
    if (entry.isDirectory()) out.push(...await walk(file)); else if(entry.isFile()) out.push(file);
  }
  return out;
}
function metadataUrl(html, tag, attribute, value, urlAttribute) {
  for (const match of html.matchAll(new RegExp(`<${tag}\\b[^>]*>`, 'gi'))) {
    const attributes=Object.fromEntries([...match[0].matchAll(/([\w:-]+)\s*=\s*["']([^"']*)["']/g)].map(([,key,text])=>[key.toLowerCase(),text.replaceAll('&amp;','&')]));
    if (attributes[attribute]===value) return attributes[urlAttribute];
  }
}
function validateSeo(html, route, origin) {
  const expected=new URL(route,origin).href;
  for (const [tag,attribute,value,urlAttribute] of [['link','rel','canonical','href'],['meta','property','og:url','content']]) {
    const found=metadataUrl(html,tag,attribute,value,urlAttribute);
    let valid=false;
    try { valid=!!found && new URL(found).href===expected; } catch {}
    if(!valid) throw new Error(`Invalid ${value} metadata for route: ${route}`);
  }
}
async function prepareSite({site, buildClient, snapshot, origin, routes, validateMetadata}) {
  const base = normalizeSiteOrigin(origin);
  const id=validId(snapshot.releaseId);
  await cp(buildClient,site,{recursive:true});
  // React Router emits a SPA fallback, but public documents must have real 404s.
  await rm(path.join(site,'__spa-fallback.html'),{force:true});
  for (const route of routes) {
    const decoded=decodeURIComponent(route);
    const candidate=path.join(site, decoded, 'index.html');
    const alternatives=[candidate,path.join(site, route, 'index.html')];
    let htmlFile;
    for (const filename of alternatives) { try { if((await stat(filename)).isFile()){htmlFile=filename;break;} } catch {} }
    if (!htmlFile) throw new Error(`Missing prerendered route: ${route}`);
    const html=await readFile(htmlFile,'utf8');
    if(!/<html[\s>]/i.test(html)||!/<\/html>/i.test(html)) throw new Error(`Invalid HTML: ${route}`);
    if(validateMetadata) validateSeo(html,route,base);
  }
  const files=await walk(site);
  if(files.length>25000) throw new Error('Build artifact limit exceeded');
  let bytes=0;
  for(const file of files) {
    bytes+=(await stat(file)).size;
    if(bytes>512*1024*1024) throw new Error('Build size limit exceeded');
    if(file.endsWith('.html')) await writeFile(file,secureHtml(await readFile(file,'utf8')));
  }
  const sitemap=routes.filter(r=>r!='/404'&&r!='/search').map(route=>`<url><loc>${escapeXml(base+route)}</loc></url>`).join('');
  await writeFile(path.join(site,'sitemap.xml'),`<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${sitemap}</urlset>`);
  const items=snapshot.contents.filter(c=>c.type==='POST').slice().sort((a,b)=>b.publishedAt.localeCompare(a.publishedAt)).slice(0,50).map(c=>`<item><title>${escapeXml(c.title)}</title><link>${escapeXml(base+c.route)}</link><guid isPermaLink="false">${escapeXml(c.id)}</guid><pubDate>${new Date(c.publishedAt).toUTCString()}</pubDate><description>${escapeXml(c.summary)}</description></item>`).join('');
  await writeFile(path.join(site,'rss.xml'),`<?xml version="1.0" encoding="UTF-8"?><rss version="2.0"><channel><title>${escapeXml(snapshot.site.title)}</title><link>${escapeXml(base)}</link><description>${escapeXml(snapshot.site.tagline)}</description>${items}</channel></rss>`);
  await writeFile(path.join(site,'robots.txt'),`User-agent: *\nAllow: /\nDisallow: /admin/\nDisallow: /api/\nSitemap: ${base}/sitemap.xml\n`);
  await writeFile(path.join(site,'release.json'),JSON.stringify({releaseId:id,createdAt:snapshot.createdAt}));
  return bytes;
}
export async function prepareRelease({root, buildClient, snapshot, origin, journal}) {
  const base=normalizeSiteOrigin(origin);
  const journalOrigin=journal ? normalizeSiteOrigin(journal.origin) : null;
  if(journalOrigin && new URL(journalOrigin).hostname===new URL(base).hostname) throw new Error('Journal and terminal origins must use different hostnames');
  const id=validId(snapshot.releaseId), routes=snapshotRoutes(snapshot);
  const staging=path.join(root,'staging',id);
  // A retry may replace incomplete staging, never a published immutable release.
  await rm(staging,{recursive:true,force:true});
  await mkdir(staging,{recursive:true});
  try {
    const sites={site:{origin:base,assetDirectory:'assets'}};
    let bytes=await prepareSite({site:path.join(staging,'site'),buildClient,snapshot,origin:base,routes,validateMetadata:!!journal});
    if(journal) {
      bytes+=await prepareSite({site:path.join(staging,'journal'),buildClient:journal.buildClient,snapshot,origin:journalOrigin,routes,validateMetadata:true});
      sites.journal={origin:journalOrigin,assetDirectory:'journal-assets'};
    }
    await writeFile(path.join(staging,'snapshot.json'),JSON.stringify(snapshot),{mode:0o600});
    // This completion marker is written only after every frontend is validated.
    await writeFile(path.join(staging,'manifest.json'),JSON.stringify({releaseId:id,createdAt:snapshot.createdAt,routes,artifactBytes:bytes,sites}));
    return {staging,routes,bytes};
  } catch(error) {
    await rm(staging,{recursive:true,force:true});
    throw error;
  }
}
export async function currentRelease(root) {
  try { const manifest=JSON.parse(await readFile(path.join(root,'current','manifest.json'),'utf8'));return validId(manifest.releaseId); }
  catch(error) { if(error.code==='ENOENT')return null;throw error; }
}
export async function activateRelease(root, id) {
  validId(id);
  const releases=path.join(root,'releases'); await mkdir(releases,{recursive:true});
  const target=path.join(releases,id); const staging=path.join(root,'staging',id);
  // Re-running after a completed rename is safe. An immutable release is never overwritten.
  try { await stat(target); } catch(error) {
    if(error.code!=='ENOENT')throw error;
    const prepared=JSON.parse(await readFile(path.join(staging,'manifest.json'),'utf8'));
    if(prepared.releaseId!==id) throw new Error('Manifest identity mismatch');
    await rename(staging,target);
  }
  const manifest=JSON.parse(await readFile(path.join(target,'manifest.json'),'utf8'));
  if(manifest.releaseId!==id) throw new Error('Manifest identity mismatch');
  const canonical=await realpath(target); if(!canonical.startsWith((await realpath(releases))+path.sep))throw new Error('Invalid release target');
  // Keep hashed executable resources for already open browser tabs. Never copy content data.
  for(const [site,directory] of [['site','assets'],...(manifest.sites?.journal ? [['journal','journal-assets']] : [])]) {
    const assets=path.join(target,site,directory);
    try { await cp(assets,path.join(root,directory),{recursive:true,force:false}); } catch(error) { if(error.code!=='ENOENT')throw error; }
  }
  const temporary=path.join(root,`.current-${randomUUID()}`);
  await symlink(path.join('releases',id),temporary,'dir');
  await rename(temporary,path.join(root,'current'));
  return manifest;
}

export async function pruneExpiredReleases(root, ids) {
  let removed=0;
  for(const raw of ids) {
    const id=validId(raw);
    if(await currentRelease(root)===id)continue;
    const target=path.join(root,'releases',id);
    // IDs come from the authenticated backend retention list. Only immutable release directories are eligible.
    const folder=await stat(target).catch(error=>{if(error.code==='ENOENT')return null;throw error;});
    if(!folder)continue;
    if(!folder.isDirectory())throw new Error('Unexpected release artifact');
    const real=await realpath(target);
    if(real!==path.join(await realpath(path.join(root,'releases')),id))throw new Error('Refusing retention through a symlink');
    const manifest=JSON.parse(await readFile(path.join(target,'manifest.json'),'utf8'));
    if(manifest.releaseId!==id)throw new Error('Retention manifest identity mismatch');
    if(await currentRelease(root)===id)continue;
    await rm(target,{recursive:true});removed++;
  }
  return removed;
}
