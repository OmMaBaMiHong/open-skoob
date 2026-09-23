import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('desktop service owns a loopback listener, reports readiness and exits with its parent', { timeout: 10000 }, async t => {
  const directory = mkdtempSync(join(tmpdir(), 'skoob-desktop-'));
  const child = spawn(process.execPath, ['server/desktop.mjs'], { env: { ...process.env, SKOOB_DATA_DIR: directory, PORT: '0' }, stdio: ['pipe', 'pipe', 'pipe'] });
  t.after(() => { child.kill(); rmSync(directory, { recursive: true, force: true }); });
  const [chunk] = await once(child.stdout, 'data');
  const ready = JSON.parse(chunk.toString());
  assert.equal(ready.event, 'ready'); assert.ok(ready.port > 0);
  const base = `http://127.0.0.1:${ready.port}`;
  assert.equal((await fetch(base + '/api/health')).status, 200);
  assert.equal((await fetch(base + '/api/v1/tianmo/brainstorm/cards')).status, 401);
  const exit = once(child, 'exit'); child.stdin.end();
  const [code] = await exit; assert.equal(code, 0);
  await assert.rejects(fetch(base + '/api/health'));
});
