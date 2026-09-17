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
