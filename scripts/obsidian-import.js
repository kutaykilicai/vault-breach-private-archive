#!/usr/bin/env node
/*
 Obsidian beynini V.A.U.L.T. kasasına aktarır. Harici paket yok, Node 18+ ile çalışır.

 KULLANIM
   Önizleme (hiçbir şey yazmaz):
     node scripts\obsidian-import.js --source "I:\Obsidian_Vault\Claude_Vault" --vault auto --dry-run
   Gerçek aktarım:
     node scripts\obsidian-import.js --source "I:\Obsidian_Vault\Claude_Vault" --vault auto
   Grok'un bıraktığı gelen kutusunu işle (inbox-obsidian/incoming → processed):
     node scripts\obsidian-import.js --incoming --vault auto

 KURALLAR
 - Kaynak taraf SALT OKUNUR. Obsidian'daki hiçbir dosya değiştirilmez, silinmez, taşınmaz.
 - Idempotent: değişmeyen notlar tekrar yazılmaz, hedefteki el değişiklikleri --force olmadan korunur.
 - config.json'dan YALNIZCA vaultPath okunur; başka hiçbir alan okunmaz, yazdırılmaz, kopyalanmaz.
 - Hassas içerik (API anahtarı, e-posta, IBAN, telefon, ham posta başlığı, iş/müşteri klasörleri)
   ya maskelenir ya da dosya tümden atlanır. Ayrıntı için --help.
*/

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const text = require('../server/text');

const APP_ROOT = path.resolve(__dirname, '..');
const MANIFEST = '.import-manifest.json';
const TAG = '#obsidian-aktarim';

// ---------------------------------------------------------------- argümanlar

function parseArgs(argv) {
  const o = {
    source: '',
    vault: '',
    target: 'obsidian',
    dryRun: false,
    force: false,
    incoming: false,
    keepIncoming: false,
    quiet: false,
    limit: 0,
    maxRedactions: 8,
    skipPaths: [],
    excludes: [],
    defaultSkips: true,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--source' || a === '-s') o.source = next();
    else if (a === '--vault' || a === '-v') o.vault = next();
    else if (a === '--target' || a === '-t') o.target = next();
    else if (a === '--dry-run' || a === '-n') o.dryRun = true;
    else if (a === '--force') o.force = true;
    else if (a === '--incoming') o.incoming = true;
    else if (a === '--keep-incoming') o.keepIncoming = true;
    else if (a === '--quiet' || a === '-q') o.quiet = true;
    else if (a === '--limit') o.limit = Number(next()) || 0;
    else if (a === '--max-redactions') o.maxRedactions = Number(next());
    else if (a === '--skip-path') o.skipPaths.push(next());
    else if (a === '--exclude') o.excludes.push(next());
    else if (a === '--no-default-skips') o.defaultSkips = false;
    else if (a === '--help' || a === '-h') o.help = true;
    else if (a.startsWith('-')) throw new Error(`Bilinmeyen seçenek: ${a}`);
  }
  return o;
}

const HELP = `
V.A.U.L.T. Obsidian aktarıcı

  --source, -s <yol>     Obsidian vault klasörü (salt okunur). Örn: I:\\Obsidian_Vault\\Claude_Vault
  --vault, -v <yol>      Hedef kasa. "auto" verilirse config.json > profile\\me.md araması ile bulunur.
  --target, -t <klasör>  Kasa içindeki hedef klasör (varsayılan: obsidian)
  --dry-run, -n          Hiçbir şey yazmaz, ne olacağını raporlar
  --force                Hedefte elle değiştirilmiş notların üzerine de yazar
  --incoming             inbox-obsidian/incoming → inbox-obsidian/processed işler (--source gerekmez)
  --keep-incoming        işlenen dosyayı incoming içinde bırakır (varsayılan: siler)
  --limit <n>            en fazla n not işler (deneme için)
  --exclude <glob>       kaynakta atlanacak yol (tekrarlanabilir). Örn: --exclude "_arsiv/**"
  --skip-path <glob>     hassas kabul edilip tümden atlanacak yol (tekrarlanabilir)
  --no-default-skips     hazır hassas klasör listesini kapatır (önerilmez)
  --max-redactions <n>   bir notta bundan fazla maskeleme gerekiyorsa not tümden atlanır (varsayılan 8)
  --quiet, -q            yalnızca özet yazdırır

Hassas veri: aşağıdaki kalıplar maskelenir → [gizlendi: <tür>]
  API anahtarları (sk-…, AIza…, xai-…, gh*_…), JWT, "Authorization/token/şifre: …" satırları,
  e-posta adresleri, telefon numaraları, IBAN, 11 haneli kimlik numarası, kart numarası,
  40+ karakterlik base64/hex dizgeler, ham posta başlıkları (From:/To:/Subject:/Received:).
Ayrıca şu klasör/dosya adları tümden atlanır: iş, work, müşteri, customer, client, mail, e-posta,
  gizli, secret, private, fatura, invoice, banka, finans, kimlik, anahtar, şifre, token, credential.
`;

// ---------------------------------------------------------------- kasa bulma

/** config.json'dan SADECE vaultPath. Dosyadaki başka hiçbir alan okunmaz/taşınmaz. */
function vaultFromConfig() {
  const p = path.join(APP_ROOT, 'config.json');
  if (!fs.existsSync(p)) return '';
  try {
    const parsed = JSON.parse(fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''));
    const only = typeof parsed.vaultPath === 'string' ? parsed.vaultPath : '';
    return only;
  } catch {
    return '';
  }
}

/** Kasanın imzası profile\me.md. Sürücü harfi makineden makineye değişebildiği için taranır. */
function findVault() {
  const fromConfig = vaultFromConfig();
  const candidates = [];
  if (fromConfig) candidates.push(fromConfig);
  if (process.platform === 'win32') {
    const shells = ["Drive'ım", 'My Drive', 'Drive’ım', 'Benim Drive’ım'];
    for (const letter of 'GHIJKLMNOPQRSTUVWXYZDEF') {
      candidates.push(`${letter}:\\VAULT-Brain`);
      for (const s of shells) candidates.push(`${letter}:\\${s}\\VAULT-Brain`);
    }
  }
  for (const c of candidates) {
    try {
      if (fs.existsSync(path.join(c, 'profile', 'me.md'))) return c;
    } catch {
      /* erişilemeyen sürücüyü atla */
    }
  }
  return fromConfig;
}

// ---------------------------------------------------------------- hassas veri

// [etiket, kalıp, (opsiyonel) doğrulayıcı]. Doğrulayıcı false dönerse eşleşme maskelenmez.
const REDACTIONS = [
  ['api-anahtarı', /\b(?:sk|pk|rk)-(?:or-v1-|proj-|ant-|live-|test-)?[A-Za-z0-9_-]{16,}\b/g],
  ['google-anahtarı', /\bAIza[0-9A-Za-z_-]{20,}\b/g],
  ['xai-anahtarı', /\bxai-[A-Za-z0-9]{16,}\b/g],
  ['github-tokeni', /\b(?:ghp|gho|ghu|ghs|ghr|github_pat)_[A-Za-z0-9_]{16,}\b/g],
  ['jwt', /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{6,}\b/g],
  ['kimlik-satırı', /\b(?:authorization|bearer|api[_-]?key|apikey|access[_-]?token|token|secret|password|passwd|pwd|şifre|sifre|parola)\s*[:=]\s*\S+/gi],
  ['e-posta', /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,24}\b/g],
  ['iban', /\bTR\s?\d{2}(?:[\s-]?\d{4}){5}[\s-]?\d{2}\b/gi],
  ['telefon', /(?:\+90|0090|0)[\s-]?\(?5\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}\b/g],
  ['kart-numarası', /\b(?:\d[ -]?){15,19}\b/g],
  ['kimlik-numarası', /\b[1-9]\d{10}\b/g],
  // Tek karakterin tekrarı (örn. "xxxxxxxx…") sır değil, doldurma metnidir.
  ['uzun-gizli-dizge', /\b(?:[A-Za-z0-9+/]{40,}={0,2}|[0-9a-f]{40,})\b/g, (m) => new Set(m).size > 4],
  ['posta-başlığı', /^[ \t]*(?:From|To|Cc|Bcc|Subject|Received|Return-Path|Message-ID|Reply-To|Kimden|Kime|Konu|Alıcı|Gönderen)[ \t]*:.*$/gim],
];

// Salt okunur ek köklerle aynı liste (server/text.js), tek kaynaktan.
const DEFAULT_SKIP_PATHS = text.SENSITIVE_GLOBS;

function redact(body) {
  let out = body;
  const found = new Map();
  for (const [label, re, valid] of REDACTIONS) {
    out = out.replace(re, (m) => {
      if (valid && !valid(m)) return m;
      // Kod bloğu sınırlarını veya markdown bağlantılarını bozmayan sabit bir yer tutucu.
      found.set(label, (found.get(label) || 0) + 1);
      return `[gizlendi: ${label}]`;
    });
  }
  return { body: out, found, total: [...found.values()].reduce((a, b) => a + b, 0) };
}

// ---------------------------------------------------------------- dosya adları

const WIN_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

function safeName(name) {
  let s = String(name)
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[. ]+$/g, '');
  if (WIN_RESERVED.test(s)) s = `_${s}`;
  if (s.length > 100) s = s.slice(0, 100).trim().replace(/[. ]+$/g, '');
  return s || 'not';
}

function safeRel(rel) {
  const parts = rel.split('/').filter(Boolean);
  const file = safeName(parts.pop().replace(/\.md$/i, ''));
  return [...parts.map(safeName), `${file}.md`].join('/');
}

function walk(root, rel, excludes, out) {
  let entries;
  try {
    entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
  } catch {
    return;
  }
  for (const e of entries) {
    const childRel = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) {
      if (e.name.startsWith('.') || e.name === 'node_modules') continue;
      if (text.matchesAny(`${childRel}/`, excludes)) continue;
      walk(root, childRel, excludes, out);
    } else if (/\.md$/i.test(e.name) && !e.name.startsWith('.')) {
      if (text.matchesAny(childRel, excludes)) continue;
      out.push(childRel);
    }
  }
}

// ---------------------------------------------------------------- dönüştürme

/**
 * Notu kasada durmaya hazır Markdown'a çevirir.
 * - YAML frontmatter tamamen atılır; içindeki bilgi düz metin "Anahtar kelimeler" satırına taşınır,
 *   çünkü uygulamanın araması YAML'ı değil metni okur.
 * - Obsidian'a özgü gürültü (yorumlar, blok kimlikleri, dataview blokları, gömülü dosyalar) temizlenir.
 * - [[bağlantılar]] linkMap ile gerçek dosya adlarına düzeltilir; çözülemeyen bağlantı düz metne iner.
 */
function convert({ raw, sourceRel, linkMap, maxRedactions }) {
  const fileTitle = path.basename(sourceRel, path.extname(sourceRel));
  const note = text.analyzeNote(fileTitle, raw);
  const segments = sourceRel.split('/').slice(0, -1);

  let body = note.body
    // Gövdenin kendi H1'i başlıkla aynıysa çıkarılır; aksi hâlde notta iki başlık olur.
    .replace(/^\s*#\s+(.+?)\s*$/m, (whole, h1) => (text.fold(h1) === text.fold(note.title || fileTitle) ? '' : whole))
    .replace(/%%[\s\S]*?%%/g, '')
    .replace(/^```(?:dataview|dataviewjs|query|tasks)[\s\S]*?```$/gim, '')
    .replace(/(?:^|\s)\^[A-Za-z0-9-]{4,}\s*$/gm, '')
    .replace(/!\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|[^\]]*)?\]\]/g, (_, t) => `(ek: ${t.trim()})`)
    .replace(/\r\n/g, '\n');

  const { body: redacted, found, total } = redact(body);
  if (total > maxRedactions) return { skip: 'hassas-içerik', redactions: found, total };
  body = redacted;

  let repaired = 0;
  let broken = 0;
  body = body.replace(/\[\[([^\]|#^]+)((?:[#^][^\]|]*)?)(?:\|([^\]]*))?\]\]/g, (whole, target, anchor, label) => {
    const base = target.trim().split('/').pop();
    // Windows'ta geçersiz karakter taşıyan hedefler diskte temizlenmiş adla durur: iki biçimi de dene.
    const exact = linkMap.get(text.fold(base)) || linkMap.get(text.fold(safeName(base)));
    if (!exact) {
      broken++;
      // Kırık bağlantı grafikte hayalet düğüm yaratır; düz metne indirilir ama kelime korunur.
      return (label || base).trim();
    }
    if (exact !== base || target.includes('/')) repaired++;
    const shown = (label || '').trim();
    return shown && shown !== exact ? `[[${exact}${anchor}|${shown}]]` : `[[${exact}${anchor}]]`;
  });

  const keywords = [...new Set([...note.tags, ...note.aliases, ...segments])]
    .map((k) => String(k).replace(/[\r\n]+/g, ' ').trim())
    .filter(Boolean);

  const head = [`# ${note.title || fileTitle}`];
  if (keywords.length) head.push('', `> Anahtar kelimeler: ${keywords.join(', ')}`);
  const foot = ['', '---', `Kaynak: \`${sourceRel}\` · Obsidian'dan içe aktarıldı ${new Date().toISOString().slice(0, 10)} · ${TAG}`];
  const content = `${[...head, '', body.trim(), ...foot].join('\n').replace(/\n{4,}/g, '\n\n\n')}\n`;

  return { content, redactions: found, total, repaired, broken };
}

// ---------------------------------------------------------------- manifest

function loadManifest(dir) {
  const p = path.join(dir, MANIFEST);
  try {
    const m = JSON.parse(fs.readFileSync(p, 'utf8'));
    if (m && typeof m.files === 'object') return m;
  } catch {
    /* yok veya bozuk: sıfırdan başla */
  }
  return { version: 1, updatedAt: '', files: {} };
}

function sha1(s) {
  return crypto.createHash('sha1').update(s, 'utf8').digest('hex');
}

// ---------------------------------------------------------------- ana akış

function planTargets(sourceRoot, relPaths, targetDir, skipPaths, manifest) {
  const linkMap = new Map();
  const plan = [];

  // Kasada zaten var olan notlar da bağlantı hedefi olabilir.
  const existing = [];
  walk(targetDir, '', [], existing);
  for (const rel of existing) {
    const base = path.basename(rel, '.md');
    linkMap.set(text.fold(base), base);
  }
  // Önceki çalıştırmada bu kaynağa ayrılmış hedefler kendi çakışmaları sayılmamalı,
  // yoksa her çalıştırma "-2", "-3" ekleyip notu yeniden yazar.
  const claimed = new Map();
  for (const [rel, info] of Object.entries(manifest.files || {})) if (info?.out) claimed.set(text.fold(info.out), rel);
  const taken = new Set(existing.map((rel) => text.fold(rel)).filter((k) => !claimed.has(k)));

  for (const rel of relPaths) {
    if (text.matchesAny(rel, skipPaths)) {
      plan.push({ rel, skip: 'hassas-yol' });
      continue;
    }
    const previous = manifest.files?.[rel]?.out;
    let out = previous && claimed.get(text.fold(previous)) === rel ? previous : safeRel(rel);
    if (!previous) {
      const dir = path.dirname(out);
      const base = path.basename(out, '.md');
      for (let i = 2; taken.has(text.fold(out)); i++) out = `${dir === '.' ? '' : `${dir}/`}${base}-${i}.md`;
    }
    taken.add(text.fold(out));
    linkMap.set(text.fold(path.basename(rel, '.md')), path.basename(out, '.md'));
    plan.push({ rel, out });
  }

  // Aliases de bağlantı hedefi olarak kullanılabilir.
  for (const item of plan) {
    if (item.skip) continue;
    try {
      const { meta } = text.parseFrontmatter(fs.readFileSync(path.join(sourceRoot, item.rel), 'utf8'));
      for (const a of text.metaList(meta, 'aliases', 'alias')) {
        const key = text.fold(a);
        if (!linkMap.has(key)) linkMap.set(key, path.basename(item.out, '.md'));
      }
    } catch {
      /* okunamayan dosya aşağıda 'hata' olarak sayılacak */
    }
  }
  return { plan, linkMap };
}

function run(opts) {
  const sourceRoot = path.resolve(opts.source);
  const vaultRoot = path.resolve(opts.vault);
  const targetDir = path.join(vaultRoot, ...opts.target.split(/[\\/]/).filter(Boolean));

  if (!fs.existsSync(sourceRoot)) throw new Error(`Kaynak klasör bulunamadı: ${sourceRoot}`);
  if (!fs.existsSync(vaultRoot)) throw new Error(`Kasa klasörü bulunamadı: ${vaultRoot}`);
  if (path.resolve(sourceRoot) === path.resolve(targetDir)) throw new Error('Kaynak ile hedef aynı klasör olamaz.');
  if (targetDir.startsWith(sourceRoot + path.sep)) throw new Error('Hedef klasör kaynağın içinde olamaz.');
  if (sourceRoot === APP_ROOT || sourceRoot.startsWith(APP_ROOT + path.sep)) throw new Error('Uygulama klasörü kaynak olarak kullanılamaz.');

  const skipPaths = [...(opts.defaultSkips ? DEFAULT_SKIP_PATHS : []), ...opts.skipPaths];
  const relPaths = [];
  walk(sourceRoot, '', opts.excludes, relPaths);
  relPaths.sort();
  const selected = opts.limit > 0 ? relPaths.slice(0, opts.limit) : relPaths;

  if (!opts.dryRun) fs.mkdirSync(targetDir, { recursive: true });
  const manifest = loadManifest(targetDir);
  const { plan, linkMap } = planTargets(sourceRoot, selected, targetDir, skipPaths, manifest);

  const sum = {
    taranan: relPaths.length,
    islenen: selected.length,
    yeni: 0,
    guncellenen: 0,
    degismeyen: 0,
    atlanan: 0,
    hata: 0,
    maskeleme: 0,
    duzeltilenBaglanti: 0,
    kirikBaglanti: 0,
  };
  const skipReasons = new Map();
  const redactionKinds = new Map();
  const problems = [];
  const nextFiles = {};

  for (const item of plan) {
    const note = (label) => {
      sum.atlanan++;
      skipReasons.set(label, (skipReasons.get(label) || 0) + 1);
      nextFiles[item.rel] = { skipped: label };
    };
    if (item.skip) {
      note(item.skip);
      continue;
    }
    let raw;
    try {
      raw = fs.readFileSync(path.join(sourceRoot, item.rel), 'utf8').replace(/^\uFEFF/, '');
    } catch (e) {
      sum.hata++;
      problems.push(`${item.rel}: okunamadı (${e.code || e.message})`);
      continue;
    }

    const hash = sha1(raw);
    const prev = manifest.files[item.rel];
    const outPath = path.join(targetDir, ...item.out.split('/'));
    const outExists = fs.existsSync(outPath);
    const current = outExists ? fs.readFileSync(outPath, 'utf8') : '';

    if (prev && prev.hash === hash && prev.out === item.out && outExists && !opts.force) {
      if (prev.outHash && sha1(current) !== prev.outHash) {
        sum.atlanan++;
        skipReasons.set('hedef-elle-değişmiş', (skipReasons.get('hedef-elle-değişmiş') || 0) + 1);
        nextFiles[item.rel] = prev;
        continue;
      }
      sum.degismeyen++;
      nextFiles[item.rel] = prev;
      continue;
    }
    if (outExists && prev?.outHash && sha1(current) !== prev.outHash && !opts.force) {
      sum.atlanan++;
      skipReasons.set('hedef-elle-değişmiş', (skipReasons.get('hedef-elle-değişmiş') || 0) + 1);
      nextFiles[item.rel] = prev;
      continue;
    }

    let res;
    try {
      res = convert({ raw, sourceRel: item.rel, linkMap, maxRedactions: opts.maxRedactions });
    } catch (e) {
      sum.hata++;
      problems.push(`${item.rel}: dönüştürülemedi (${e.message})`);
      continue;
    }
    for (const [k, n] of res.redactions || []) redactionKinds.set(k, (redactionKinds.get(k) || 0) + n);
    if (res.skip) {
      note(res.skip);
      continue;
    }

    sum.maskeleme += res.total;
    sum.duzeltilenBaglanti += res.repaired;
    sum.kirikBaglanti += res.broken;

    // Aktarım tarihi her çalıştırmada değiştiği için karşılaştırma tarih satırı hariç yapılır.
    const bare = (s) => s.replace(/^Kaynak: .*$/gm, '').trim();
    if (outExists && bare(current) === bare(res.content)) {
      sum.degismeyen++;
      nextFiles[item.rel] = { hash, out: item.out, outHash: sha1(current) };
      continue;
    }

    if (!opts.dryRun) {
      try {
        fs.mkdirSync(path.dirname(outPath), { recursive: true });
        fs.writeFileSync(outPath, res.content, 'utf8');
      } catch (e) {
        sum.hata++;
        problems.push(`${item.rel}: yazılamadı (${e.code || e.message})`);
        continue;
      }
    }
    if (outExists) sum.guncellenen++;
    else sum.yeni++;
    nextFiles[item.rel] = { hash, out: item.out, outHash: sha1(res.content) };
  }

  if (!opts.dryRun) {
    manifest.files = nextFiles;
    manifest.updatedAt = new Date().toISOString();
    fs.writeFileSync(path.join(targetDir, MANIFEST), JSON.stringify(manifest, null, 2), 'utf8');
  }

  return { sum, skipReasons, redactionKinds, problems, sourceRoot, vaultRoot, targetDir };
}

/** Grok'un betiğinin bıraktığı incoming klasörünü işler: normalize et, processed'a yaz, gelen kopyayı kaldır. */
function runIncoming(opts) {
  const vaultRoot = path.resolve(opts.vault);
  const incoming = path.join(vaultRoot, 'inbox-obsidian', 'incoming');
  const processed = path.join(vaultRoot, 'inbox-obsidian', 'processed');
  if (!fs.existsSync(incoming)) {
    return { empty: true, incoming, processed };
  }
  const rels = [];
  walk(incoming, '', opts.excludes, rels);
  rels.sort();

  const month = new Date().toISOString().slice(0, 7);
  const monthDir = path.join(processed, month);
  const taken = new Set();
  const existing = [];
  walk(processed, '', [], existing);
  const linkMap = new Map();
  for (const rel of existing) {
    const base = path.basename(rel, '.md');
    linkMap.set(text.fold(base), base);
    taken.add(text.fold(`${month}/${path.basename(rel)}`));
  }
  for (const rel of rels) linkMap.set(text.fold(path.basename(rel, '.md')), safeName(path.basename(rel, '.md')));

  const sum = { taranan: rels.length, islenen: 0, atlanan: 0, hata: 0, maskeleme: 0, kaldirilan: 0 };
  const skipReasons = new Map();
  const redactionKinds = new Map();
  const problems = [];

  for (const rel of rels) {
    const src = path.join(incoming, rel);
    let raw;
    try {
      raw = fs.readFileSync(src, 'utf8').replace(/^\uFEFF/, '');
    } catch (e) {
      sum.hata++;
      problems.push(`${rel}: okunamadı (${e.code || e.message})`);
      continue;
    }
    if (text.matchesAny(rel, opts.defaultSkips ? [...DEFAULT_SKIP_PATHS, ...opts.skipPaths] : opts.skipPaths)) {
      sum.atlanan++;
      skipReasons.set('hassas-yol', (skipReasons.get('hassas-yol') || 0) + 1);
      continue;
    }
    let res;
    try {
      res = convert({ raw, sourceRel: `inbox-obsidian/incoming/${rel}`, linkMap, maxRedactions: opts.maxRedactions });
    } catch (e) {
      sum.hata++;
      problems.push(`${rel}: dönüştürülemedi (${e.message})`);
      continue;
    }
    for (const [k, n] of res.redactions || []) redactionKinds.set(k, (redactionKinds.get(k) || 0) + n);
    if (res.skip) {
      sum.atlanan++;
      skipReasons.set(res.skip, (skipReasons.get(res.skip) || 0) + 1);
      continue;
    }

    let name = `${safeName(path.basename(rel, '.md'))}.md`;
    for (let i = 2; taken.has(text.fold(`${month}/${name}`)); i++) name = `${safeName(path.basename(rel, '.md'))}-${i}.md`;
    taken.add(text.fold(`${month}/${name}`));

    if (!opts.dryRun) {
      try {
        fs.mkdirSync(monthDir, { recursive: true });
        fs.writeFileSync(path.join(monthDir, name), res.content, 'utf8');
        if (!opts.keepIncoming) {
          fs.rmSync(src);
          sum.kaldirilan++;
        }
      } catch (e) {
        sum.hata++;
        problems.push(`${rel}: yazılamadı (${e.code || e.message})`);
        continue;
      }
    } else if (!opts.keepIncoming) sum.kaldirilan++;
    sum.islenen++;
    sum.maskeleme += res.total;
  }

  // Boşalan alt klasörleri temizle (incoming'in kendisi kalır).
  if (!opts.dryRun && !opts.keepIncoming) pruneEmpty(incoming, incoming);
  return { sum, skipReasons, redactionKinds, problems, incoming, processed: monthDir };
}

function pruneEmpty(dir, keep) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) pruneEmpty(path.join(dir, e.name), keep);
  }
  if (dir !== keep && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir);
}

// ---------------------------------------------------------------- çıktı

function table(title, map) {
  if (!map.size) return '';
  const rows = [...map.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `    ${k}: ${v}`);
  return `\n  ${title}\n${rows.join('\n')}`;
}

function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`HATA: ${e.message}`);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }

  if (!opts.vault || opts.vault === 'auto') {
    opts.vault = findVault();
    if (!opts.vault) {
      console.error('HATA: Kasa bulunamadı. --vault "G:\\Drive\'ım\\VAULT-Brain" gibi açıkça verin.');
      process.exit(2);
    }
  }
  if (!opts.incoming && !opts.source) {
    console.error('HATA: --source gerekli (ya da --incoming kullanın). Yardım: --help');
    process.exit(2);
  }

  const mark = opts.dryRun ? 'ÖNİZLEME (hiçbir şey yazılmadı)' : 'AKTARIM';
  let r;
  try {
    r = opts.incoming ? runIncoming(opts) : run(opts);
  } catch (e) {
    console.error(`HATA: ${e.message}`);
    process.exit(1);
  }

  if (r.empty) {
    console.log(`\n${mark} · gelen kutusu yok: ${r.incoming}\nGrok'un sync betiği henüz çalışmamış olabilir.\n`);
    return;
  }

  const lines = [`\n=== ${mark} ===`];
  if (opts.incoming) {
    lines.push(`  gelen kutusu : ${r.incoming}`, `  hedef        : ${r.processed}`);
  } else {
    lines.push(`  kaynak (salt okunur) : ${r.sourceRoot}`, `  kasa                 : ${r.vaultRoot}`, `  hedef klasör         : ${r.targetDir}`);
  }
  const s = r.sum;
  lines.push('');
  lines.push(`  taranan      : ${s.taranan}`);
  if (opts.incoming) {
    lines.push(`  işlenen      : ${s.islenen}`, `  atlanan      : ${s.atlanan}`, `  hata         : ${s.hata}`);
    lines.push(`  gelen kutusundan kaldırılan: ${s.kaldirilan}`);
  } else {
    lines.push(
      `  yeni         : ${s.yeni}`,
      `  güncellenen  : ${s.guncellenen}`,
      `  değişmeyen   : ${s.degismeyen}`,
      `  atlanan      : ${s.atlanan}`,
      `  hata         : ${s.hata}`,
      `  düzeltilen bağlantı : ${s.duzeltilenBaglanti}`,
      `  kırık bağlantı      : ${s.kirikBaglanti} (düz metne indirildi)`
    );
  }
  lines.push(`  maskeleme    : ${s.maskeleme}`);
  lines.push(table('atlama nedenleri:', r.skipReasons));
  lines.push(table('maskelenen türler:', r.redactionKinds));
  if (r.problems.length && !opts.quiet) {
    lines.push(`\n  sorunlar (${r.problems.length}):`);
    for (const p of r.problems.slice(0, 20)) lines.push(`    ${p}`);
    if (r.problems.length > 20) lines.push(`    …ve ${r.problems.length - 20} tane daha`);
  }
  if (opts.dryRun) lines.push('\n  Bu bir önizlemedir. Gerçekten aktarmak için --dry-run seçeneğini kaldırın.');
  else if (!opts.incoming) lines.push('\n  Uygulamada Hafıza panelindeki ↻ düğmesine basarak yeniden tarama yapın.');
  console.log(`${lines.filter(Boolean).join('\n')}\n`);
  process.exitCode = s.hata > 0 ? 1 : 0;
}

if (require.main === module) main();

module.exports = { convert, redact, safeName, safeRel, findVault, DEFAULT_SKIP_PATHS, run, runIncoming, parseArgs };
