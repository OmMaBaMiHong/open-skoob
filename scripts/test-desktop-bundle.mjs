import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve, join } from 'node:path';

// Exercise the signed runtime, not the source runtime used before packaging.
const contents = resolve(process.argv[2], 'Contents');
const resources = join(contents, 'Resources/resources');
const dataDir = await mkdtemp(join(tmpdir(), 'skoob-bundle-test-'));
const child = spawn(join(contents, 'MacOS/node'), [join(resources, 'server.mjs')], {
  env: { ...process.env, SKOOB_DATA_DIR: dataDir, SKOOB_STATIC_DIR: join(resources, 'dist'), PORT: '0' },
  stdio: ['pipe', 'pipe', 'pipe'],
});
let stderr = '';
child.stderr.on('data', chunk => { stderr += chunk; });
const exited = once(child, 'exit');
const timeout = setTimeout(() => child.kill(), 20_000);
try {
  const ready = await Promise.race([
    (async () => {
      let output = '';
      for await (const chunk of child.stdout) {
        output += chunk;
        if (output.includes('\n')) return JSON.parse(output.split('\n')[0]);
      }
      throw new Error('Signed backend closed before readiness: ' + stderr);
    })(),
    exited.then(([code, signal]) => { throw new Error(`Signed backend exited ${code}/${signal}: ${stderr}`); }),
  ]);
  assert.equal(ready.event, 'ready');
  const response = await fetch(`http://127.0.0.1:${ready.port}/create`);
  assert.equal(response.status, 200);
  assert.match(await response.text(), /<!doctype html>/i);
  child.stdin.end('stop\n');
  assert.deepEqual(await exited, [0, null]);
  console.log('Signed desktop backend: HTTP startup and clean exit passed');
} finally {
  clearTimeout(timeout);
  if (child.exitCode === null && child.signalCode === null) { child.kill(); await exited; }
  await rm(dataDir, { recursive: true, force: true });
}
