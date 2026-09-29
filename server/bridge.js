// Dış ajan köprüsü (Grok Bot vb.): gelen mesajlar arayüze düşer, cevaplar komut çıktısı olarak geri döner.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');

const DATA = path.join(config.ROOT, 'data');
const OUTBOX_PATH = path.join(DATA, 'outbox.json');

const clients = new Set();
const waiters = new Map();
const replies = new Map();
const headlessHistory = { vault: [], breach: [] };

function loadOutbox() {
  try {
    return JSON.parse(fs.readFileSync(OUTBOX_PATH, 'utf8'));
  } catch {
    return [];
  }
}

function saveOutbox(list) {
  fs.mkdirSync(DATA, { recursive: true });
  fs.writeFileSync(OUTBOX_PATH, JSON.stringify(list, null, 2), 'utf8');
}

function broadcast(event, data) {
  for (const res of clients) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
}

function events(req, res) {
  res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
  res.write('event: hello\ndata: {}\n\n');
  clients.add(res);
  const ping = setInterval(() => res.write(': ping\n\n'), 25000);
  req.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

function queueOutgoing(to, text, from) {
  const list = loadOutbox();
  const msg = { id: crypto.randomUUID().slice(0, 8), to, from, text, at: new Date().toISOString() };
  list.push(msg);
  saveOutbox(list.slice(-100));
  broadcast('bridge_out', msg);
  return msg;
}

function takeOutbox(to) {
  const list = loadOutbox();
  const mine = list.filter((m) => !to || m.to === to);
  if (mine.length) saveOutbox(list.filter((m) => !mine.includes(m)));
  return mine;
}

function setReply(id, data) {
  replies.set(id, { ...data, at: Date.now() });
  waiters.get(id)?.();
  for (const [k, v] of replies) if (Date.now() - v.at > 60 * 60 * 1000) replies.delete(k);
}

async function runHeadless(id, from, text, mode) {
  const agent = require('./agent');
  const hist = headlessHistory[mode];
  hist.push({ role: 'user', content: text });
  let out = '';
  let error = null;
  try {
    await agent.run({
      messages: hist.slice(-30),
      mode,
      emit: (ev, d) => {
        if (ev === 'delta') out += d.content;
        if (ev === 'done') hist.push(...d.messages);
      },
      signal: new AbortController().signal,
      requestApproval: async () => false,
    });
  } catch (e) {
    error = e.message;
  }
  setReply(id, { status: error ? 'error' : 'done', text: error ? `Hata: ${error}` : out.replace(/<think>[\s\S]*?<\/think>/g, '').trim(), headless: true });
}

async function inbound({ text, from = 'grok', mode = 'breach', wait = true, timeoutSec = 300 }) {
  if (!text || !String(text).trim()) throw new Error('Mesaj boş');
  mode = mode === 'vault' ? 'vault' : 'breach';
  const id = crypto.randomUUID().slice(0, 8);
  const label = from === 'grok' ? 'Grok Bot' : from;
  const content = `[${label}'tan mesaj — cevabın ona otomatik iletilecek]\n${String(text).trim()}`;
  replies.set(id, { status: 'pending', at: Date.now() });

  const ui = [...clients].pop();
  if (ui) ui.write(`event: bridge_in\ndata: ${JSON.stringify({ id, from, label, text: String(text).trim(), content, mode })}\n\n`);
  else runHeadless(id, from, content, mode);

  if (!wait) return { id, status: 'pending' };
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, Math.min(timeoutSec, 900) * 1000);
    waiters.set(id, () => {
      clearTimeout(timer);
      resolve();
    });
  });
  waiters.delete(id);
  return { id, ...replies.get(id), outbox: takeOutbox(from) };
}

function getReply(id) {
  return replies.get(id) || { status: 'unknown' };
}

module.exports = { events, broadcast, inbound, setReply, getReply, queueOutgoing, takeOutbox };
