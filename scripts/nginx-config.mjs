import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseTrustedProxies } from './trusted-proxies.mjs';

// Build-time rendering keeps nginx's runtime filesystem read-only. The normal
// image retains its development config; only standalone builds supply an origin.
export function renderNginxConfig(source, siteOrigin, trustedProxyCidrs = '') {
  if (!siteOrigin) return source;
  let origin;
  try { origin = new URL(siteOrigin); } catch { throw new Error('Invalid standalone site origin'); }
  if (!['http:', 'https:'].includes(origin.protocol) || !/^[A-Za-z0-9._:[\]-]+$/.test(origin.host) || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) {
    throw new Error('Standalone site origin must be HTTP(S), without credentials, a path, query or fragment');
  }
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

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const source = await readFile('infra/nginx/default.conf', 'utf8');
  await writeFile('/tmp/default.conf', renderNginxConfig(source, process.env.STANDALONE_SITE_ORIGIN, process.env.TRUSTED_PROXY_CIDRS));
}
