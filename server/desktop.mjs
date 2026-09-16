import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { createApplication } from './app.mjs';

// The desktop parent owns this process. Never expose it on the LAN.
if (!process.env.SKOOB_DATA_DIR) throw new Error('Desktop data directory is required');
const application = createApplication({ dataDir: resolve(process.env.SKOOB_DATA_DIR), cloudEnv: {} });
const root = resolve(process.env.SKOOB_STATIC_DIR || './dist');
application.app.get('*', serveStatic({ root }));
application.app.get('*', (c, next) => c.req.path.startsWith('/api/') ? next() : serveStatic({ path: root + '/index.html' })(c, next));
const server = serve({ fetch: application.app.fetch, hostname: '127.0.0.1', port: Number(process.env.PORT || 0) }, info => {
  process.stdout.write(JSON.stringify({ event: 'ready', port: info.port }) + '\n');
});
let stopping = false;
async function stop() {
  if (stopping) return; stopping = true;
  server.close(); server.closeAllConnections(); await application.close(); process.exit(0);
}
process.stdin.setEncoding('utf8');
let input = '';
process.stdin.on('data', chunk => { input += chunk; if (input.includes('\n') && input.trim() === 'stop') void stop(); });
process.stdin.on('end', () => void stop());
process.on('SIGINT', () => void stop()); process.on('SIGTERM', () => void stop());
