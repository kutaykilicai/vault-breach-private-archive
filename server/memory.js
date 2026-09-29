const fs = require('fs');
const path = require('path');
const config = require('./config');

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', 'node_modules']);
const MAX_FILES = 20000;
const STALE_MS = 60 * 1000;
const STOPWORDS = new Set(
  'bir bu şu ve ile için gibi ama çok daha mi mı mu mü de da ki ne nasıl neden olan olarak ben sen biz siz onlar the and for with that this what how are you can bana beni benim bunu şunu var yok'.split(' ')
);

let index = { root: '', notes: [], builtAt: 0 };

function vaultRoot() {
  const v = config.get().vaultPath;
  return v && fs.existsSync(v) ? path.resolve(v) : '';
}

function lower(s) {
  return s.toLocaleLowerCase('tr');
}

function tokenize(s) {
  return lower(s)
    .split(/[^\p{L}\p{N}_-]+/u)
    .filter((t) => t.length > 2 && !STOPWORDS.has(t));
}

function walk(dir, out) {
  if (out.length >= MAX_FILES) return;
  let entries;
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    if (out.length >= MAX_FILES) return;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (!SKIP_DIRS.has(e.name)) walk(full, out);
    } else if (e.name.toLowerCase().endsWith('.md')) {
      out.push(full);
    }
  }
}

function parseLinks(text) {
  const links = new Set();
  const re = /\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g;
  let m;
  while ((m = re.exec(text))) links.add(lower(path.basename(m[1].trim())));
  return [...links];
}

function build(force = false) {
  const root = vaultRoot();
  if (!force && root === index.root && Date.now() - index.builtAt < STALE_MS) return index;
  const files = [];
  if (root) walk(root, files);
  const notes = [];
  for (const f of files) {
    let text = '';
    try {
      text = fs.readFileSync(f, 'utf8');
    } catch {
      continue;
    }
    const rel = path.relative(root, f).split(path.sep).join('/');
    const title = path.basename(f, '.md');
    notes.push({
      rel,
      title,
      key: lower(title),
      folder: rel.includes('/') ? rel.split('/')[0] : '',
      text,
      lowerText: lower(text),
      links: parseLinks(text),
      mtime: fs.statSync(f).mtimeMs,
    });
  }
  index = { root, notes, builtAt: Date.now() };
  return index;
}

function snippet(note, terms, len = 400) {
  let pos = -1;
  for (const t of terms) {
    pos = note.lowerText.indexOf(t);
    if (pos >= 0) break;
  }
  const start = Math.max(0, pos - 120);
  return (start > 0 ? '…' : '') + note.text.slice(start, start + len).replace(/\s+/g, ' ').trim() + '…';
}

function search(query, k) {
  const { notes } = build();
  const limit = k || config.get().memory.maxHits || 5;
  const terms = [...new Set(tokenize(query))];
  if (!terms.length || !notes.length) return [];
  const df = {};
  for (const t of terms) df[t] = notes.reduce((n, note) => n + (note.lowerText.includes(t) ? 1 : 0), 0);
  const N = notes.length;
  const scored = [];
  for (const note of notes) {
    let score = 0;
    for (const t of terms) {
      if (!df[t]) continue;
      const idf = Math.log(1 + N / df[t]);
      if (note.key.includes(t)) score += 4 * idf;
      let count = 0;
      let i = note.lowerText.indexOf(t);
      while (i >= 0 && count < 10) {
        count++;
        i = note.lowerText.indexOf(t, i + t.length);
      }
      score += Math.log(1 + count) * idf;
    }
    if (score > 0) scored.push({ note, score });
  }
  scored.sort((a, b) => b.score - a.score || b.note.mtime - a.note.mtime);
  return scored.slice(0, limit).map(({ note, score }) => ({
    path: note.rel,
    title: note.title,
    score: Math.round(score * 100) / 100,
    snippet: snippet(note, terms),
  }));
}

function safeVaultPath(rel) {
  const root = vaultRoot();
  if (!root) throw new Error('Obsidian vault yolu ayarlanmamış (Ayarlar > Vault yolu).');
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) throw new Error('Vault dışına erişim engellendi.');
  return full;
}

function read(rel) {
  let p = rel.endsWith('.md') ? rel : `${rel}.md`;
  let full = safeVaultPath(p);
  if (!fs.existsSync(full)) {
    const hit = build().notes.find((n) => n.key === lower(path.basename(rel, '.md')));
    if (!hit) throw new Error(`Not bulunamadı: ${rel}`);
    full = safeVaultPath(hit.rel);
  }
  return fs.readFileSync(full, 'utf8');
}

function write(rel, content, append = false) {
  const p = rel.endsWith('.md') ? rel : `${rel}.md`;
  const full = safeVaultPath(p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (append && fs.existsSync(full)) fs.appendFileSync(full, `\n${content}`, 'utf8');
  else fs.writeFileSync(full, content, 'utf8');
  index.builtAt = 0;
  return p;
}

function coreContext() {
  const out = [];
  for (const rel of config.get().memory.coreNotes || []) {
    try {
      out.push(`### ${rel}\n${read(rel).slice(0, 4000)}`);
    } catch {
      /* not eksikse atla */
    }
  }
  return out.join('\n\n');
}

function logExchange(mode, userText, assistantText) {
  const m = config.get().memory;
  if (!m.logConversations || !vaultRoot() || !assistantText) return;
  const d = new Date();
  const day = d.toISOString().slice(0, 10);
  const time = d.toTimeString().slice(0, 5);
  const agent = mode === 'breach' ? 'B.R.E.A.C.H.' : 'V.A.U.L.T.';
  const entry = `\n## ${time} · ${agent}\n**Ben:** ${userText.trim()}\n\n**${agent}:** ${assistantText.trim()}\n`;
  try {
    const rel = `${m.logFolder}/${day}.md`;
    const full = safeVaultPath(rel);
    if (!fs.existsSync(full)) write(rel, `# Sohbet kaydı ${day}\n#sohbet-kaydı\n`);
    write(rel, entry, true);
  } catch (e) {
    console.error('[memory] sohbet kaydı yazılamadı:', e.message);
  }
}

function graph(maxNodes = 1500) {
  const { notes } = build();
  const byKey = new Map(notes.map((n) => [n.key, n]));
  const degree = new Map();
  const links = [];
  for (const n of notes) {
    for (const l of n.links) {
      if (!byKey.has(l) || l === n.key) continue;
      links.push([n.key, l]);
      degree.set(n.key, (degree.get(n.key) || 0) + 1);
      degree.set(l, (degree.get(l) || 0) + 1);
    }
  }
  let chosen = notes;
  if (notes.length > maxNodes) {
    chosen = [...notes].sort((a, b) => (degree.get(b.key) || 0) - (degree.get(a.key) || 0)).slice(0, maxNodes);
  }
  const ids = new Map(chosen.map((n, i) => [n.key, i]));
  return {
    demo: !notes.length,
    total: notes.length,
    nodes: chosen.map((n) => ({ id: n.rel, title: n.title, folder: n.folder, degree: degree.get(n.key) || 0 })),
    links: links.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => [ids.get(a), ids.get(b)]),
  };
}

function stats() {
  const { root, notes } = build();
  return { root, notes: notes.length, folders: [...new Set(notes.map((n) => n.folder).filter(Boolean))].slice(0, 20) };
}

function listSkills() {
  const dirs = [path.join(config.ROOT, 'skills')];
  const root = vaultRoot();
  if (root) dirs.push(path.join(root, 'skills'));
  const skills = new Map();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = e.isDirectory() ? path.join(dir, e.name, 'SKILL.md') : e.name.endsWith('.md') ? path.join(dir, e.name) : null;
      if (!file || !fs.existsSync(file)) continue;
      const raw = fs.readFileSync(file, 'utf8');
      const fm = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
      const meta = {};
      if (fm) for (const line of fm[1].split(/\r?\n/)) {
        const m = /^(\w+):\s*(.*)$/.exec(line);
        if (m) meta[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
      }
      const id = meta.name || e.name.replace(/\.md$/, '');
      skills.set(id, {
        id,
        title: meta.title || id,
        description: meta.description || '',
        icon: meta.icon || '◆',
        body: fm ? raw.slice(fm[0].length) : raw,
      });
    }
  }
  return [...skills.values()];
}

module.exports = { build, search, read, write, coreContext, logExchange, graph, stats, listSkills, vaultRoot };
