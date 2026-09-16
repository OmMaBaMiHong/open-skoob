import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { resolve } from 'node:path';
import { createApplication } from './app.mjs';

const port = Number(process.env.PORT || 9002);
const host = process.env.HOST || '127.0.0.1';
const application = createApplication({ dataDir: resolve(process.env.SKOOB_DATA_DIR || './data'), password: process.env.SKOOB_LOCAL_PASSWORD, origins: (process.env.SKOOB_ALLOWED_ORIGINS || '').split(',').filter(Boolean) });
application.app.get('*', serveStatic({ root: './dist' }));
application.app.get('*', async (c, next) => { if (c.req.path.startsWith('/api/')) return next(); return serveStatic({ path: './dist/index.html' })(c, next); });
const server = serve({ fetch: application.app.fetch, port, hostname: host }, () => {
  console.log(`Open-Skoob 本地工作室：http://${host}:${port}`);
  if (application.firstRunPassword) console.log(`首次启动的本地访问密码：${application.firstRunPassword}\n请妥善保存，或设置 SKOOB_LOCAL_PASSWORD 后重启。`);
});
let stopping = false;
async function stop() { if (stopping) return; stopping = true; server.close(); server.closeAllConnections(); await application.close(); process.exit(0); }
process.on('SIGINT', stop); process.on('SIGTERM', stop);
