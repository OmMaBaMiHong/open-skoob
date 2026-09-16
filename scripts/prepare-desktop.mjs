import { build } from 'esbuild';
import { createHash } from 'node:crypto';
import { cp, mkdir, readFile, writeFile, chmod } from 'node:fs/promises';
import { execFileSync } from 'node:child_process';
import { resolve, join } from 'node:path';
import { unzipSync } from 'fflate';

const version = '24.21.0';
const targets = {
  'aarch64-apple-darwin': ['darwin-arm64', 'bed7eea5325e1108f32ce5228ddd6a5f0f08a499ee42aa7442aea583702f6057'],
  'x86_64-apple-darwin': ['darwin-x64', '1462cb3b3046b815cf8ea436d3da450ec1a9f11dac7e5a46b0ada5305d7e8097'],
  'x86_64-pc-windows-msvc': ['win-x64', '158f7685b44de51f6c0df1d153526cbcd3e1bc739a8dfc607721cef75de9e541'],
};
const target = process.env.SKOOB_DESKTOP_TARGET || (process.platform === 'win32' ? 'x86_64-pc-windows-msvc' : process.arch === 'arm64' ? 'aarch64-apple-darwin' : 'x86_64-apple-darwin');
if (!targets[target]) throw new Error('Unsupported desktop target: ' + target);
const [platform, digest] = targets[target];
const windows = platform.startsWith('win-');
const name = `node-v${version}-${platform}`;
const archive = `${name}.${windows ? 'zip' : 'tar.gz'}`;
const cache = resolve('.desktop-cache'); await mkdir(cache, { recursive: true });
let bytes;
try { bytes = await readFile(join(cache, archive)); } catch {
  const response = await fetch(`https://nodejs.org/dist/v${version}/${archive}`, { signal: AbortSignal.timeout(120000) });
  if (!response.ok) throw new Error('Node runtime download failed: ' + response.status);
  bytes = Buffer.from(await response.arrayBuffer());
}
if (createHash('sha256').update(bytes).digest('hex') !== digest) throw new Error('Node runtime checksum mismatch');
await writeFile(join(cache, archive), bytes);
const resources = resolve('src-tauri/resources'); const binaries = resolve('src-tauri/binaries');
await mkdir(resources, { recursive: true }); await mkdir(binaries, { recursive: true });
const binary = join(binaries, `node-${target}${windows ? '.exe' : ''}`);
if (windows) {
  const files = unzipSync(bytes);
  await writeFile(binary, files[`${name}/node.exe`]);
  await writeFile(join(resources, 'NODE-LICENSE'), files[`${name}/LICENSE`]);
} else {
  execFileSync('tar', ['-xzf', join(cache, archive), '-C', cache, `${name}/bin/node`, `${name}/LICENSE`]);
  await cp(join(cache, name, 'bin/node'), binary); await chmod(binary, 0o755);
  await cp(join(cache, name, 'LICENSE'), join(resources, 'NODE-LICENSE'));
}
await build({ entryPoints: ['server/desktop.mjs'], outfile: join(resources, 'server.mjs'), bundle: true, platform: 'node', target: 'node24', format: 'esm', sourcemap: false });
await cp('dist', join(resources, 'dist'), { recursive: true });
for (const file of ['LICENSE', 'COMMERCIAL-LICENSE.md']) await cp(file, join(resources, file));
console.log(`Prepared public desktop runtime ${target}, Node ${version}; no private workspace bundled`);
