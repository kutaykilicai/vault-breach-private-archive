const fs = require('fs');
const path = require('path');
const config = require('./config');
const text = require('./text');

const SKIP_DIRS = new Set(['.obsidian', '.trash', '.git', '.smart-env', 'node_modules', '.stfolder', '.sync']);
const MAX_FILES = 20000;

// BM25F: k1 terim doygunluğu, b uzunluk cezası. b>0 olmadan uzun sohbet kayıtları
// her sorguda kısa notların önüne geçiyordu.
const K1 = 1.2;
const B = 0.7;
const FIELD_WEIGHTS = { title: 3, meta: 1.6, body: 1 };
// Kök biçimiyle yakalanan eşleşme, kelimenin aynen geçtiği eşleşmeden biraz daha zayıf sayılır.
const STEM_FACTOR = 0.85;
const PREFIX_FACTOR = 0.55;
const PREFIX_MIN = 5;
// Aynı kelimenin bir alanda 12'den fazla geçmesi ek bilgi taşımıyor. Bu tavan olmadan
// sohbet kayıtları gibi kelime tekrarlı dosyalar tek kelimelik sorgularda hep birinci çıkıyor.
const MAX_TF_PER_FIELD = 12;

let index = emptyIndex();
let noteCache = new Map(); // abs → { mtime, size, note }

function emptyIndex() {
  return { roots: [], notes: [], byRef: new Map(), dict: new Map(), avgdl: 1, builtAt: 0, tookMs: 0, signature: '' };
}

function mem() {
  return config.get().memory || {};
}

function num(value, fallback, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(Math.max(Math.round(n), min), max);
}

function limits() {
  const m = mem();
  return {
    maxHits: num(m.maxHits, 5, 1, 50),
    snippetChars: num(m.snippetChars, 400, 120, 4000),
    coreChars: num(m.coreChars, 4000, 200, 40000),
    minTokenChars: num(m.minTokenChars, 3, 2, 6),
    maxNoteBytes: num(m.maxNoteBytes, 262144, 4096, 20 * 1024 * 1024),
    staleMs: num(m.reindexStaleMs, 60000, 2000, 24 * 3600 * 1000),
  };
}

/** Yapılandırmadaki salt-okunur ek kökler. Geçersiz kayıtlar sessizce atlanır. */
function extraRoots() {
  const out = [];
  const seen = new Set(['vault']);
  for (const raw of mem().extraRoots || []) {
    const src = typeof raw === 'string' ? { path: raw } : raw || {};
    if (!src.path || typeof src.path !== 'string') continue;
    let id = String(src.id || path.basename(src.path.replace(/[\\/]+$/, '')) || 'ek');
    id = text.fold(id).replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 24) || 'ek';
    let unique = id;
    for (let i = 2; seen.has(unique); i++) unique = `${id}-${i}`;
    seen.add(unique);
    // Ek kökler ham Obsidian klasörleri: iş/müşteri/mail/gizli yolları varsayılan olarak
    // aramaya girmez, yoksa bir soru bu içeriği bulut modele taşır. includeSensitive: true
    // ile bilinçli olarak kapatılabilir.
    const own = Array.isArray(src.exclude) ? src.exclude : [];
    out.push({
      id: unique,
      label: String(src.label || src.path),
      configured: src.path,
      path: fs.existsSync(src.path) ? path.resolve(src.path) : '',
      writable: false,
      sensitiveFiltered: src.includeSensitive !== true,
      exclude: src.includeSensitive === true ? own : [...text.SENSITIVE_GLOBS, ...own],
    });
  }
  return out;
}

function roots() {
  const configured = config.get().vaultPath || '';
  const vault = {
    id: 'vault',
    label: 'Kasa (Drive)',
    configured,
    path: configured && fs.existsSync(configured) ? path.resolve(configured) : '',
    writable: true,
    exclude: Array.isArray(mem().excludeGlobs) ? mem().excludeGlobs : [],
  };
  return [vault, ...extraRoots()];
}

function vaultRoot() {
  return roots()[0].path;
}

function rootById(id) {
  return index.roots.find((r) => r.id === id) || roots().find((r) => r.id === id) || null;
}

function walk(dir, rootPath, exclude, out) {
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
    const rel = path.relative(rootPath, full).split(path.sep).join('/');
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || SKIP_DIRS.has(e.name)) continue;
      if (text.matchesAny(`${rel}/`, exclude) || text.matchesAny(rel, exclude)) continue;
      walk(full, rootPath, exclude, out);
    } else if (e.name.toLowerCase().endsWith('.md') && !e.name.startsWith('.')) {
      if (text.matchesAny(rel, exclude)) continue;
      out.push({ abs: full, rel });
    }
  }
}

/** Alan bazlı terim sayımı. Hem kelimenin aynen hâli hem kaba kökü indekslenir. */
function addField(terms, value, weight, minChars) {
  const tokens = text.tokenize(value, minChars);
  const counts = new Map();
  for (const token of tokens) {
    counts.set(token, (counts.get(token) || 0) + 1);
    const root = text.stem(token);
    if (root !== token) counts.set(root, (counts.get(root) || 0) + 1);
  }
  for (const [term, n] of counts) {
    terms.set(term, (terms.get(term) || 0) + Math.min(n, MAX_TF_PER_FIELD) * weight);
  }
  return tokens.length * weight;
}

function buildNote(root, file, stat, lim) {
  let raw;
  try {
    raw = fs.readFileSync(file.abs, 'utf8');
  } catch {
    return null;
  }
  if (raw.length > lim.maxNoteBytes) raw = raw.slice(0, lim.maxNoteBytes);
  const fileTitle = path.basename(file.rel, '.md');
  const note = text.analyzeNote(fileTitle, raw);
  const segments = file.rel.split('/').slice(0, -1);

  const terms = new Map();
  let dl = 0;
  // Klasör adları, etiketler ve [[bağlantı]] hedefleri normalde aramaya girmiyordu.
  // Artık aranabilir metnin bir parçası — kelimeleri metnin kendisi taşımalı.
  dl += addField(terms, [fileTitle, note.title, ...note.aliases].join(' '), FIELD_WEIGHTS.title, lim.minTokenChars);
  dl += addField(
    terms,
    [...segments, ...note.tags, ...note.links.map((l) => l.target.split('/').pop())].join(' '),
    FIELD_WEIGHTS.meta,
    lim.minTokenChars
  );
  dl += addField(terms, note.plain, FIELD_WEIGHTS.body, lim.minTokenChars);

  return {
    ref: root.id === 'vault' ? file.rel : `${root.id}:${file.rel}`,
    rootId: root.id,
    rel: file.rel,
    abs: file.abs,
    title: note.title || fileTitle,
    fileTitle,
    key: text.fold(fileTitle),
    aliasKeys: note.aliases.map((a) => text.fold(a)),
    folder: root.id === 'vault' ? segments[0] || '' : `${root.id}/${segments[0] || ''}`,
    tags: note.tags,
    links: [...new Set(note.links.map((l) => text.fold(l.target.split('/').pop())).filter(Boolean))],
    plain: note.plain,
    plainFold: text.fold(note.plain),
    terms,
    dl: dl || 1,
    mtime: stat.mtimeMs,
    size: stat.size,
  };
}

function build(force = false) {
  const lim = limits();
  const activeRoots = roots();
  const signature = JSON.stringify(activeRoots.map((r) => [r.id, r.path, r.exclude])) + `|${lim.minTokenChars}|${lim.maxNoteBytes}`;
  if (!force && signature === index.signature && Date.now() - index.builtAt < lim.staleMs) return index;

  const t0 = Date.now();
  if (signature !== index.signature) noteCache = new Map();
  const nextCache = new Map();
  const notes = [];

  for (const root of activeRoots) {
    root.notes = 0;
    if (!root.path) continue;
    const files = [];
    walk(root.path, root.path, root.exclude, files);
    for (const file of files) {
      let stat;
      try {
        stat = fs.statSync(file.abs);
      } catch {
        continue;
      }
      // Drive üzerindeki vault'u her taramada baştan okumak pahalı; değişmeyen notlar yeniden kullanılır.
      const cached = noteCache.get(file.abs);
      const note = cached && cached.mtime === stat.mtimeMs && cached.size === stat.size ? cached.note : buildNote(root, file, stat, lim);
      if (!note) continue;
      nextCache.set(file.abs, { mtime: stat.mtimeMs, size: stat.size, note });
      notes.push(note);
      root.notes++;
    }
  }

  const dict = new Map();
  const byRef = new Map();
  notes.forEach((note, i) => {
    byRef.set(note.ref, note);
    for (const [term, tf] of note.terms) {
      let entry = dict.get(term);
      if (!entry) dict.set(term, (entry = { df: 0, posting: [] }));
      entry.df++;
      entry.posting.push([i, tf]);
    }
  });

  noteCache = nextCache;
  index = {
    roots: activeRoots,
    notes,
    byRef,
    dict,
    avgdl: notes.length ? notes.reduce((s, n) => s + n.dl, 0) / notes.length : 1,
    builtAt: Date.now(),
    tookMs: Date.now() - t0,
    signature,
  };
  return index;
}

function snippet(note, terms, len) {
  let pos = -1;
  for (const t of terms) {
    pos = note.plainFold.indexOf(t.raw);
    if (pos >= 0) break;
  }
  if (pos < 0) {
    for (const t of terms) {
      pos = note.plainFold.indexOf(t.stem);
      if (pos >= 0) break;
    }
  }
  const start = Math.max(0, pos - Math.floor(len / 4));
  const body = note.plain.slice(start, start + len).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + body + (start + len < note.plain.length ? '…' : '');
}

/** Sorgu kökü indekste yoksa sözlükte ortak ön eke bakarak kurtarma denemesi. */
function prefixCandidates(dict, term) {
  const probe = term.stem.slice(0, PREFIX_MIN);
  if (probe.length < PREFIX_MIN) return [];
  const out = [];
  for (const [key, entry] of dict) {
    if (key.length < PREFIX_MIN) continue;
    if (key.startsWith(probe) || term.stem.startsWith(key.slice(0, PREFIX_MIN))) out.push(entry);
    if (out.length >= 40) break;
  }
  return out;
}

function search(query, k) {
  const lim = limits();
  const { notes, dict, avgdl } = build();
  const limit = num(k, lim.maxHits, 1, 100);
  const terms = text.queryTerms(query, lim.minTokenChars);
  if (!terms.length || !notes.length) return [];

  const N = notes.length;
  const scores = new Float64Array(N);
  const idfOf = (df) => Math.log(1 + (N - df + 0.5) / (df + 0.5));

  for (const term of terms) {
    // Aynı not için "aynen geçiyor" ve "kökü geçiyor" katkıları toplanmaz; en iyisi alınır.
    const best = new Map();
    const consider = (entry, factor) => {
      if (!entry || !entry.df) return;
      const idf = idfOf(entry.df);
      for (const [i, tf] of entry.posting) {
        const value = factor * idf * ((tf * (K1 + 1)) / (tf + K1 * (1 - B + (B * notes[i].dl) / avgdl)));
        if (value > (best.get(i) || 0)) best.set(i, value);
      }
    };
    consider(dict.get(term.raw), 1);
    if (term.stem !== term.raw) consider(dict.get(term.stem), STEM_FACTOR);
    if (!best.size) for (const entry of prefixCandidates(dict, term)) consider(entry, PREFIX_FACTOR);
    for (const [i, value] of best) scores[i] += value;
  }

  const scored = [];
  for (let i = 0; i < N; i++) if (scores[i] > 0) scored.push({ note: notes[i], score: scores[i] });
  scored.sort((a, b) => b.score - a.score || b.note.mtime - a.note.mtime);

  return scored.slice(0, limit).map(({ note, score }) => ({
    path: note.ref,
    ref: note.ref,
    root: note.rootId,
    writable: note.rootId === 'vault',
    title: note.title,
    tags: note.tags.slice(0, 8),
    score: Math.round(score * 100) / 100,
    snippet: snippet(note, terms, lim.snippetChars),
  }));
}

function safeJoin(rootPath, rel) {
  const full = path.resolve(rootPath, rel);
  if (full !== rootPath && !full.startsWith(rootPath + path.sep)) throw new Error('Kök dışına erişim engellendi.');
  return full;
}

function safeVaultPath(rel) {
  const root = vaultRoot();
  if (!root) throw new Error('Obsidian vault yolu ayarlanmamış (Ayarlar > Vault yolu).');
  return safeJoin(root, rel);
}

/** `inbox/not.md` kasayı, `obsidian:Konu/not.md` ek bir kökü gösterir. */
function resolveRef(ref) {
  const s = String(ref || '').trim().replace(/\\/g, '/');
  const m = /^([A-Za-z0-9-]{1,24}):\/?(.+)$/.exec(s);
  if (m) {
    const root = rootById(text.fold(m[1]));
    if (root && root.id !== 'vault') return { root, rel: m[2].replace(/^\/+/, '') };
  }
  return { root: roots()[0], rel: s.replace(/^\/+/, '') };
}

function read(rel) {
  const target = resolveRef(rel);
  const withExt = target.rel.endsWith('.md') ? target.rel : `${target.rel}.md`;
  if (target.root.path) {
    const full = safeJoin(target.root.path, withExt);
    if (fs.existsSync(full)) return fs.readFileSync(full, 'utf8');
  }
  const wanted = text.fold(path.basename(target.rel, '.md'));
  const { notes } = build();
  const hit =
    notes.find((n) => n.rootId === target.root.id && n.key === wanted) ||
    notes.find((n) => n.key === wanted) ||
    notes.find((n) => n.aliasKeys.includes(wanted));
  if (!hit) throw new Error(`Not bulunamadı: ${rel}`);
  return fs.readFileSync(hit.abs, 'utf8');
}

function write(rel, content, append = false) {
  const target = resolveRef(rel);
  if (target.root.id !== 'vault') throw new Error(`"${target.root.id}" kökü salt okunurdur; oraya yazılamaz. Kasaya yaz.`);
  // Klasörsüz verilen not adları yapılandırmadaki writeFolder'a (varsayılan inbox/) düşer.
  const folder = String(mem().writeFolder || '').replace(/^[\\/]+|[\\/]+$/g, '');
  const scoped = !target.rel.includes('/') && folder ? `${folder}/${target.rel}` : target.rel;
  const p = scoped.endsWith('.md') ? scoped : `${scoped}.md`;
  const full = safeVaultPath(p);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  if (append && fs.existsSync(full)) fs.appendFileSync(full, `\n${content}`, 'utf8');
  else fs.writeFileSync(full, content, 'utf8');
  index.builtAt = 0;
  return p;
}

function coreContext() {
  const { coreChars } = limits();
  const out = [];
  for (const rel of mem().coreNotes || []) {
    try {
      out.push(`### ${rel}\n${read(rel).slice(0, coreChars)}`);
    } catch {
      /* not eksikse atla */
    }
  }
  return out.join('\n\n');
}

function logExchange(mode, userText, assistantText) {
  const m = mem();
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
  const byKey = new Map();
  for (const n of notes) {
    for (const key of [n.key, ...n.aliasKeys]) {
      if (!key) continue;
      const slot = byKey.get(key);
      // Aynı isim birden fazla kökte varsa kasadaki kazanır: grafik canlı beyni gösterir.
      if (!slot || (slot.rootId !== 'vault' && n.rootId === 'vault')) byKey.set(key, n);
    }
  }
  const degree = new Map();
  const links = [];
  for (const n of notes) {
    for (const l of n.links) {
      const target = byKey.get(l);
      if (!target || target.ref === n.ref) continue;
      links.push([n.ref, target.ref]);
      degree.set(n.ref, (degree.get(n.ref) || 0) + 1);
      degree.set(target.ref, (degree.get(target.ref) || 0) + 1);
    }
  }
  let chosen = notes;
  if (notes.length > maxNodes) {
    chosen = [...notes].sort((a, b) => (degree.get(b.ref) || 0) - (degree.get(a.ref) || 0)).slice(0, maxNodes);
  }
  const ids = new Map(chosen.map((n, i) => [n.ref, i]));
  return {
    demo: !notes.length,
    total: notes.length,
    nodes: chosen.map((n) => ({ id: n.ref, title: n.title, folder: n.folder, root: n.rootId, degree: degree.get(n.ref) || 0 })),
    links: links.filter(([a, b]) => ids.has(a) && ids.has(b)).map(([a, b]) => [ids.get(a), ids.get(b)]),
  };
}

function stats() {
  const { roots: active, notes, tookMs, builtAt } = build();
  const configured = config.get().vaultPath || '';
  const root = active[0]?.path || '';
  return {
    root,
    configured,
    missing: Boolean(configured && !root),
    notes: notes.length,
    folders: [...new Set(notes.map((n) => n.folder).filter(Boolean))].slice(0, 20),
    limits: limits(),
    tookMs,
    builtAt,
    roots: active.map((r) => ({
      id: r.id,
      label: r.label,
      configured: r.configured,
      path: r.path,
      writable: r.writable,
      sensitiveFiltered: Boolean(r.sensitiveFiltered),
      missing: Boolean(r.configured && !r.path),
      notes: r.notes || 0,
    })),
  };
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
      const { meta, body } = text.parseFrontmatter(raw);
      const str = (v) => (Array.isArray(v) ? v.join(', ') : typeof v === 'string' ? v : '');
      const id = str(meta.name) || e.name.replace(/\.md$/, '');
      skills.set(id, {
        id,
        title: str(meta.title) || id,
        description: str(meta.description),
        icon: str(meta.icon) || '◆',
        body,
      });
    }
  }
  return [...skills.values()];
}

module.exports = { build, search, read, write, coreContext, logExchange, graph, stats, listSkills, vaultRoot, roots, resolveRef };
