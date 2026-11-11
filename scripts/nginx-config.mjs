import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTrustedProxies } from './trusted-proxies.mjs';

// Build-time rendering keeps nginx's runtime filesystem read-only. The normal
// image retains its development config; only standalone builds supply an origin.
function renderServer(source, siteOrigin, trustedProxyCidrs = '') {
  let origin;
  try { origin = new URL(siteOrigin); } catch { throw new Error('Invalid standalone site origin'); }
  if (!['http:', 'https:'].includes(origin.protocol) || !/^[A-Za-z0-9._:[\]-]+$/.test(origin.host) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Standalone site origin must be HTTP(S), without credentials, a path, query or fragment');
  }
  // Preserve the browser's outer HTTPS URL for relative redirects and keep CDN
  // transformations from invalidating the publisher's script-hash CSP.
  source=source.replace('server {','server {\n    absolute_redirect off;')
    .replace('valid_referers none server_names localhost 127.0.0.1;', `valid_referers none ${origin.hostname};`)
    .replace('no-cache, must-revalidate','no-cache, must-revalidate, no-transform')
    .replace('Cache-Control "no-store"','Cache-Control "no-store, no-transform"');
  const trustedProxies = parseTrustedProxies(trustedProxyCidrs);
  if (trustedProxies.length) {
    const directives = [...trustedProxies.map(cidr => `    set_real_ip_from ${cidr};`), '    real_ip_header X-Forwarded-For;', '    real_ip_recursive on;'].join('\n');
    source = source.replace('server {', `server {\n${directives}`);
  }
  const headers = {
    Host: origin.host,
    Forwarded: '""',
    'X-Forwarded-Host': origin.host,
    'X-Forwarded-Proto': origin.protocol.slice(0, -1),
    'X-Forwarded-Port': origin.port || (origin.protocol === 'https:' ? '443' : '80'),
    'X-Forwarded-For': '$remote_addr',
    'X-Forwarded-Prefix': '""',
    'X-Forwarded-Ssl': '""',
  };
  const original = /        proxy_set_header Host \$http_host;\n        proxy_set_header X-Forwarded-Proto \$scheme;\n        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;/;
  if (!original.test(source)) throw new Error('Nginx proxy configuration changed; review the standalone forwarding rules');
  return source.replace(original, Object.entries(headers).map(([name, value]) => `        proxy_set_header ${name} ${value};`).join('\n'));
}

export function renderNginxConfig(source, siteOrigin, trustedProxyCidrs = '', journalSiteOrigin = '') {
  if (!siteOrigin) {
    if(journalSiteOrigin) throw new Error('A primary site origin is required for journal virtual hosting');
    return source;
  }
  const terminal=renderServer(source,siteOrigin,trustedProxyCidrs);
  if(!journalSiteOrigin?.trim()) return terminal;
  let journal=renderServer(source,journalSiteOrigin,trustedProxyCidrs);
  const primaryHost=new URL(siteOrigin).hostname, journalHost=new URL(journalSiteOrigin).hostname;
  if(primaryHost===journalHost) throw new Error('The two frontend origins must use different hostnames');
  journal=journal.replace('root /srv/published/current/site;','root /srv/published/current/journal;')
    .replace('location /assets/ {\n        root /srv/published;\n        try_files $uri =404;', 'location /journal-assets/ {\n        alias /srv/published/journal-assets/;');
  const reject=`server {
    listen 8080 default_server;
    server_name _;
    location = /health { access_log off; return 200; }
    location / { return 421; }
}\n`;
  return reject+terminal.replace('server_name _;',`server_name ${primaryHost};`)+journal.replace('server_name _;',`server_name ${journalHost};`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = await readFile('infra/nginx/default.conf', 'utf8');
  await writeFile('/tmp/default.conf', renderNginxConfig(source, process.env.STANDALONE_SITE_ORIGIN, process.env.TRUSTED_PROXY_CIDRS, process.env.JOURNAL_SITE_ORIGIN));
}
