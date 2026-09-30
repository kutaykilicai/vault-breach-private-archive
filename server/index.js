const http = require('http');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const memory = require('./memory');
const providers = require('./providers');
const agent = require('./agent');
const bridge = require('./bridge');
const { detectAll } = require('./detect');
const { readBody } = require('./body');

const WEB = path.join(config.ROOT, 'web');
const UPLOADS = path.join(config.ROOT, 'data', 'uploads');
const MAX_UPLOAD = 25 * 1024 * 1024;
const HOST = '127.0.0.1';
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};

const pendingApprovals = new Map();

function sendJson(res, code, data) {
  res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(data));
}

function sameOrigin(req) {
  const origin = req.headers.origin;
  if (!origin) return true;
  try {
    const u = new URL(origin);
    return ['127.0.0.1', 'localhost'].includes(u.hostname);
  } catch {
    return false;
  }
}

function serveStatic(req, res, pathname) {
  const rel = pathname === '/' ? 'index.html' : decodeURIComponent(pathname).replace(/^\/+/, '');
  const file = path.resolve(WEB, rel);
  if (!file.startsWith(WEB) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404);
    return res.end('Bulunamadı');
  }
  res.writeHead(200, { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
  fs.createReadStream(file).pipe(res);
}

async function handleChat(req, res) {
  const body = await readBody(req);
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache',
    Connection: 'keep-alive',
  });
  const controller = new AbortController();
  const myApprovals = new Set();
  res.on('close', () => {
    controller.abort();
    for (const id of myApprovals) pendingApprovals.get(id)?.(false);
  });

  const emit = (event, data) => {
    if (!res.writableEnded) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  const requestApproval = (id, tool, args) =>
    new Promise((resolve) => {
      myApprovals.add(id);
      const timer = setTimeout(() => finish(false), 5 * 60 * 1000);
      function finish(ok) {
        clearTimeout(timer);
        pendingApprovals.delete(id);
        myApprovals.delete(id);
        resolve(ok);
      }
      pendingApprovals.set(id, finish);
      emit('approval', { id, tool, args });
    });

  try {
    await agent.run({
      messages: Array.isArray(body.messages) ? body.messages : [],
      mode: body.mode === 'breach' ? 'breach' : 'vault',
      tier: body.tier,
      emit,
      signal: controller.signal,
      requestApproval,
    });
  } catch (e) {
    if (!controller.signal.aborted) emit('error', { message: e.message });
  } finally {
    emit('state', { state: 'idle' });
    res.end();
  }
}

async function route(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const p = url.pathname;

  if (!p.startsWith('/api/')) return serveStatic(req, res, p);
  if (req.method !== 'GET' && !sameOrigin(req)) return sendJson(res, 403, { error: 'Yetkisiz kaynak' });

  if (p === '/api/status' && req.method === 'GET') {
    const det = await detectAll(url.searchParams.has('refresh'));
    return sendJson(res, 200, { ...det, memory: memory.stats(), config: config.masked(), personas: agent.PERSONAS });
  }
  if (p === '/api/config' && req.method === 'GET') return sendJson(res, 200, config.masked());
  if (p === '/api/config' && req.method === 'POST') {
    config.updateFromClient(await readBody(req));
    memory.build(true);
    bridge.broadcast('config_changed', { at: Date.now() });
    return sendJson(res, 200, config.masked());
  }
  if (p === '/api/upload' && req.method === 'POST') {
    const { name, data } = await readBody(req);
    if (!name || typeof data !== 'string') return sendJson(res, 400, { error: 'name ve data gerekli' });
    const buf = Buffer.from(data, 'base64');
    if (buf.length > MAX_UPLOAD) return sendJson(res, 413, { error: `Dosya çok büyük (en fazla ${MAX_UPLOAD / 1024 / 1024} MB)` });
    const safe = path.basename(String(name)).replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').slice(0, 120) || 'dosya';
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    fs.mkdirSync(UPLOADS, { recursive: true });
    const file = path.join(UPLOADS, `${stamp}-${safe}`);
    fs.writeFileSync(file, buf);
    return sendJson(res, 200, { path: file, size: buf.length });
  }
  if (p === '/api/models' && req.method === 'GET') {
    try {
      return sendJson(res, 200, { models: await providers.listModels(url.searchParams.get('provider')) });
    } catch (e) {
      return sendJson(res, 200, { models: [], error: e.message });
    }
  }
  if (p === '/api/graph' && req.method === 'GET') return sendJson(res, 200, memory.graph());
  if (p === '/api/skills' && req.method === 'GET') {
    return sendJson(res, 200, memory.listSkills().map(({ body, ...s }) => s));
  }
  if (p === '/api/skill' && req.method === 'GET') {
    const s = memory.listSkills().find((x) => x.id === url.searchParams.get('id'));
    return s ? sendJson(res, 200, s) : sendJson(res, 404, { error: 'Skill bulunamadı' });
  }
  if (p === '/api/memory/reindex' && req.method === 'POST') {
    memory.build(true);
    return sendJson(res, 200, memory.stats());
  }
  if (p === '/api/chat' && req.method === 'POST') return handleChat(req, res);
  if (p === '/api/chat/reset' && req.method === 'POST') {
    const { mode } = await readBody(req);
    for (const m of mode === 'all' ? ['vault', 'breach'] : [mode]) bridge.resetHeadless(m);
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/events' && req.method === 'GET') return bridge.events(req, res);
  if (p === '/api/bridge/message' && req.method === 'POST') {
    try {
      return sendJson(res, 200, await bridge.inbound(await readBody(req)));
    } catch (e) {
      return sendJson(res, 400, { error: e.message });
    }
  }
  if (p === '/api/bridge/reply' && req.method === 'POST') {
    const { id, text, status } = await readBody(req);
    bridge.setReply(id, { status: status || 'done', text });
    return sendJson(res, 200, { ok: true });
  }
  if (p === '/api/bridge/reply' && req.method === 'GET') return sendJson(res, 200, bridge.getReply(url.searchParams.get('id')));
  if (p === '/api/bridge/outbox' && req.method === 'GET') {
    return sendJson(res, 200, { messages: bridge.takeOutbox(url.searchParams.get('to') || 'grok') });
  }
  if (p === '/api/approve' && req.method === 'POST') {
    const { id, allow } = await readBody(req);
    const fn = pendingApprovals.get(id);
    if (!fn) return sendJson(res, 404, { error: 'Onay bekleyen işlem yok' });
    fn(Boolean(allow));
    return sendJson(res, 200, { ok: true });
  }
  sendJson(res, 404, { error: 'Bilinmeyen uç nokta' });
}

const cfg = config.load();
const server = http.createServer((req, res) => {
  route(req, res).catch((e) => {
    console.error(e);
    if (!res.headersSent) sendJson(res, 500, { error: e.message });
    else res.end();
  });
});

server.listen(cfg.port, HOST, () => {
  const n = memory.stats().notes;
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   V.A.U.L.T.  //  B.R.E.A.C.H.   çevrimiçi ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(`  Arayüz : http://${HOST}:${cfg.port}`);
  console.log(`  Vault  : ${memory.vaultRoot() || '(ayarlanmadı)'}${n ? ` · ${n} not` : ''}`);
  console.log('  Kapatmak için bu pencerede Ctrl+C');
  console.log('');
  if (process.env.VB_OPEN === '1') {
    require('child_process').execFile('cmd.exe', ['/c', 'start', '', `http://${HOST}:${cfg.port}`], { windowsHide: true });
  }
});

server.on('error', (e) => {
  if (e.code === 'EADDRINUSE') {
    console.error(`  Port ${cfg.port} zaten kullanımda: uygulama muhtemelen açık. Tarayıcıda http://${HOST}:${cfg.port} adresine gidin.`);
  } else {
    console.error(e);
  }
  process.exit(1);
});
