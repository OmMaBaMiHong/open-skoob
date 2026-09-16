import { test } from 'node:test';
import assert from 'node:assert/strict';
import { forwardCloud } from './cloud.mjs';
import { createApplication } from './app.mjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('only versioned public preview images retain private caching and validators', async t => {
  const store = { get: (kind, id) => id === 'freeAccess' ? { service: 'gaotk' } : {}, secret: () => 'fixture-key' };
  let failed = false;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    const headers = new Headers(init.headers);
    assert.equal(headers.get('authorization'), 'Bearer fixture-key');
    if (String(url).includes('/image')) {
      assert.equal(headers.get('if-none-match'), '"v1"');
      return new Response(null, { status: failed ? 403 : 304, headers: { 'Cache-Control': 'private, max-age=31536000, immutable', ETag: '"v1"', 'Content-Type': 'image/webp' } });
    }
    return Response.json({}, { headers: { 'Cache-Control': 'public, max-age=31536000' } });
  });
  const req = new Request('http://localhost/api/v1/tianmo/brainstorm/cards/bs-a/image?v=cover-1&variant=preview-v1', { headers: { 'If-None-Match': '"v1"' } });
  const cached = await forwardCloud(req, store, {}, true);
  assert.equal(cached.status, 304);
  assert.equal(cached.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  assert.match(cached.headers.get('vary'), /Cookie/);
  assert.equal(cached.headers.get('etag'), '"v1"');
  failed = true;
  assert.equal((await forwardCloud(req, store, {}, true)).headers.get('cache-control'), 'no-store');
  assert.equal((await forwardCloud(new Request('http://localhost/api/v1/tianmo/brainstorm/cards'), store, {}, true)).headers.get('cache-control'), 'no-store');
});

test('application middleware keeps image caching but checks Free rights before a conditional request', async t => {
  const dir = mkdtempSync(join(tmpdir(), 'skoob-image-cache-'));
  const instance = createApplication({ dataDir: dir, cloudEnv: {} });
  t.after(async () => { await instance.close(); rmSync(dir, { recursive: true, force: true }); });
  t.mock.method(globalThis, 'fetch', async url => {
    if (String(url).includes('/open/access')) return Response.json({ ready: true, plan: { id: 'free', enabled: true }, entitlements: ['brainstorm.read'] });
    assert.match(String(url), /\/open\/catalog\/tianmo\/brainstorm\/cards\/bs-a\/image/);
    return new Response('webp', { headers: { 'Content-Type': 'image/webp', 'Cache-Control': 'private, max-age=31536000, immutable', ETag: '"v1"' } });
  });
  const session = await (await instance.app.request('/api/v1/local/session', { method: 'POST', headers: { 'X-Skoob-Local': '1' } })).json();
  const headers = { Authorization: `Bearer ${session.token}`, 'Content-Type': 'application/json' };
  await instance.app.request('/api/v1/local/cloud/key', { method: 'POST', headers, body: JSON.stringify({ apiKey: 'fixture-key' }) });
  const path = '/api/v1/tianmo/brainstorm/cards/bs-a/image?v=cover-1&variant=preview-v1';
  const image = await instance.app.request(path, { headers });
  assert.equal(image.status, 200);
  assert.equal(image.headers.get('cache-control'), 'private, max-age=31536000, immutable');
  await instance.app.request('/api/v1/local/cloud/key', { method: 'DELETE', headers });
  const denied = await instance.app.request(path, { headers: { ...headers, 'If-None-Match': '"v1"' } });
  assert.equal(denied.status, 403);
  assert.match(denied.headers.get('cache-control'), /no-store/);
});
