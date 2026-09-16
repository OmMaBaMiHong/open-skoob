import { test } from 'node:test';
import assert from 'node:assert/strict';
import { complete, listModels } from './models.mjs';

const store = { get: (_kind, id, fallback) => id === 'models' ? { service: 'gaotk', defaultModel: 'vendor/small:free', services: [] } : fallback, secret: () => 'fixture-official-key' };
test('official Free models run on the local host without relaying prompts or credentials', async t => {
  let enabled = true, limited = false; const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push({ url: String(url), ...init });
    if (String(url).endsWith('/open/catalog/models')) {
      assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-official-key');
      assert.equal(init.body, undefined);
      return enabled ? Response.json({ data: [{ id: 'vendor/small:free' }, { id: 'vendor/paid' }, { id: 'vendor/trick:free' }] }) : Response.json({ error: { code: 'FREE_ENTITLEMENT_REQUIRED', message: 'disabled' } }, { status: 403 });
    }
    assert.equal(new Headers(init.headers).has('authorization'), false);
    assert.ok(String(url).startsWith('https://api.kilo.ai/api/openrouter/'));
    if (String(url).endsWith('/models')) return Response.json({ data: [
      { id: 'vendor/small:free', name: 'Small', pricing: { prompt: '0', completion: '0' } },
      { id: 'vendor/trick:free', pricing: { prompt: '0', completion: '0.01' } },
      { id: 'unapproved:free', pricing: { prompt: '0', completion: '0' } },
    ] });
    assert.equal(JSON.parse(init.body).model, 'vendor/small:free');
    return limited ? new Response('limited', { status: 429 }) : Response.json({ choices: [{ message: { content: 'local answer' } }] });
  });
  const models = await listModels(store, 'gaotk');
  assert.deepEqual(models.map(m => m.id), ['vendor/small:free', 'vendor/paid']);
  assert.match(models[0].name, /本机直连/);
  assert.equal(await complete(store, {}, [{ role: 'user', content: 'private prompt' }]), 'local answer');
  assert.ok(calls.filter(c => c.body).every(c => c.url === 'https://api.kilo.ai/api/openrouter/chat/completions'));
  assert.ok(calls.filter(c => !c.url.includes('api.kilo.ai')).every(c => !c.body));
  await assert.rejects(complete(store, { model: 'vendor/trick:free' }, []), { code: 'MODEL_NOT_AUTHORIZED' });
  limited = true;
  await assert.rejects(complete(store, {}, []), { code: 'LOCAL_FREE_RATE_LIMITED' });
  const generated = calls.filter(c => c.body).length;
  enabled = false;
  await assert.rejects(complete(store, {}, []), { code: 'FREE_ENTITLEMENT_REQUIRED' });
  assert.equal(calls.filter(c => c.body).length, generated);
});

test('paid models and explicitly configured third-party services keep their own routes', async t => {
  const calls = [];
  t.mock.method(globalThis, 'fetch', async (url, init = {}) => {
    calls.push(String(url));
    if (String(url).endsWith('/open/catalog/models')) return Response.json({ data: [{ id: 'vendor/paid' }] });
    assert.equal(String(url), 'https://lai.gaotk.com/v1/chat/completions');
    assert.equal(new Headers(init.headers).get('authorization'), 'Bearer fixture-official-key');
    return Response.json({ choices: [{ message: { content: 'paid' } }] });
  });
  assert.equal(await complete(store, { model: 'vendor/paid' }, []), 'paid');
  assert.equal(calls.length, 2);
});
