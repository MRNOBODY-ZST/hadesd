import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { renderNginxConfig } from './nginx-config.mjs';

const source = await readFile(new URL('../infra/nginx/default.conf', import.meta.url), 'utf8');

test('standalone HTTPS proxy uses the configured origin and removes client-controlled forwarding', () => {
  const output = renderNginxConfig(source, 'https://blog.example.test:8443');
  const headers = Object.fromEntries([...output.matchAll(/proxy_set_header\s+(\S+)\s+([^;]+);/g)].map(match => [match[1], match[2]]));
  assert.equal(headers.Host, 'blog.example.test:8443');
  assert.equal(headers['X-Forwarded-Host'], 'blog.example.test:8443');
  assert.equal(headers['X-Forwarded-Proto'], 'https');
  assert.equal(headers['X-Forwarded-Port'], '8443');
  assert.equal(headers.Forwarded, '""');
  assert.equal(headers['X-Forwarded-For'], '$remote_addr');
  assert.equal(headers['X-Forwarded-Prefix'], '""');
  assert.equal(headers['X-Forwarded-Ssl'], '""');
});

test('default image configuration is unchanged when standalone origin is absent', () => {
  assert.equal(renderNginxConfig(source), source);
});

test('standalone HTTP configuration uses port 80 and rejects malformed origins', () => {
  assert.match(renderNginxConfig(source, 'http://blog.example.test'), /proxy_set_header X-Forwarded-Port 80;/);
  for (const origin of ['ftp://example.test', 'https://example.test/blog', 'https://user:secret@example.test', 'https://example.test/?x=y', 'https://foo;bar', 'https://foo$bar', "https://foo'bar"]) {
    assert.throws(() => renderNginxConfig(source, origin), /origin/i);
  }
});


test('only explicit trusted proxies can supply the original client address', () => {
  const untrusted = renderNginxConfig(source, 'https://blog.example.test');
  assert.doesNotMatch(untrusted, /set_real_ip_from/);
  const trusted = renderNginxConfig(source, 'https://blog.example.test', '172.20.0.0/16,::1/128');
  assert.match(trusted, /set_real_ip_from 172\.20\.0\.0\/16;/);
  assert.match(trusted, /set_real_ip_from ::1\/128;/);
  assert.match(trusted, /real_ip_header X-Forwarded-For;/);
  assert.match(trusted, /real_ip_recursive on;/);
  for (const value of ['172.20.0.0/99', '127.0.0.1;return 200', 'localhost', '::1/-1', '127.0.0.1,,::1']) {
    assert.throws(() => renderNginxConfig(source, 'https://blog.example.test', value), /proxy/i);
  }
});

test('two named frontends keep fixed origins and independent asset roots', () => {
  const output=renderNginxConfig(source,'https://hadesd.sh','127.0.0.1','https://itshades.dev');
  const servers=output.split(/(?=server \{)/).filter(block=>block.trim());
  assert.equal(servers.length,3);
  assert.match(servers[0],/listen 8080 default_server/);
  assert.match(servers[0],/return 421/);
  const terminal=servers.find(block=>block.includes('server_name hadesd.sh;'));
  const journal=servers.find(block=>block.includes('server_name itshades.dev;'));
  assert.ok(terminal);assert.ok(journal);
  assert.match(terminal,/root \/srv\/published\/current\/site;/);
  assert.match(journal,/root \/srv\/published\/current\/journal;/);
  assert.match(journal,/location \/journal-assets\//);
  assert.match(journal,/alias \/srv\/published\/journal-assets\//);
  assert.match(terminal,/proxy_set_header Host hadesd.sh;/);
  assert.match(journal,/proxy_set_header Host itshades.dev;/);
  assert.doesNotMatch(output,/proxy_set_header Host \$http_host/);
  assert.match(journal,/absolute_redirect off;/);
  assert.match(terminal,/no-transform/);
  assert.equal((output.match(/set_real_ip_from 127\.0\.0\.1;/g)||[]).length,2);
});

test('journal virtual hosting needs two distinct safe hostnames', () => {
  for(const [primary,journal] of [[undefined,'https://itshades.dev'],['https://same.test','https://same.test:8443'],['https://hadesd.sh','https://bad;host']]) {
    assert.throws(()=>renderNginxConfig(source,primary,'',journal),/origin|host/i);
  }
});
