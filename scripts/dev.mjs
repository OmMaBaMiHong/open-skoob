import { spawn } from 'node:child_process';
const backendPort = process.env.SKOOB_DEV_API_PORT || '4579';
const children = [spawn(process.execPath, ['--env-file-if-exists=.env', 'server/index.mjs'], { stdio: 'inherit', env: { ...process.env, PORT: backendPort, HOST: '127.0.0.1' } }), spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env: { ...process.env, SKOOB_DEV_API_PORT: backendPort } })];
let stopped = false;
function stop(code = 0) { if (stopped) return; stopped = true; for (const child of children) child.kill('SIGTERM'); process.exitCode = code; }
for (const child of children) { child.on('error', error => { console.error(error.message); stop(1); }); child.on('exit', code => stop(code || 0)); }
process.on('SIGINT', () => stop()); process.on('SIGTERM', () => stop());
