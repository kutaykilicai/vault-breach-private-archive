// Kendi kodunu değiştirme: öncesinde yedek, sonrasında sözdizimi + modül yükleme kontrolü; bozulursa geri yükleme ve yeniden başlatma.
const { execFile, spawn } = require('child_process');
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const config = require('./config');
const bridge = require('./bridge');

const ROOT = config.ROOT;
const BACKUPS = path.join(ROOT, 'data', 'self-edit-backups');
const SKIP = new Set(['.git', 'data', 'node_modules']);
const SECRET = 'config.json';
const KEEP_BACKUPS = 20;
const SMOKE_MODULES = ['config', 'memory', 'providers', 'router', 'detect', 'bridge', 'tools', 'agent'];

let busy = false;
let pendingRestart = null;

function walk(dir = ROOT, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (dir === ROOT && SKIP.has(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out);
    else if (e.isFile()) out.push(path.relative(ROOT, full));
  }
  return out;
}

const hash = (file) => crypto.createHash('sha1').update(fs.readFileSync(file)).digest('hex');
const slash = (rel) => rel.split(path.sep).join('/');

function exec(cmd, args, timeout = 30000) {
  return new Promise((resolve) => {
    execFile(cmd, args, { cwd: ROOT, timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024 }, (err, stdout, stderr) =>
      resolve({ ok: !err, out: String(stdout || ''), err: String(stderr || err?.message || '') })
    );
  });
}

function readSecret() {
  const p = path.join(ROOT, SECRET);
  return fs.existsSync(p) ? fs.readFileSync(p) : null;
}

async function snapshot(task) {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').replace('.', '-').slice(0, 19);
  const dir = path.join(BACKUPS, stamp);
  if (fs.existsSync(BACKUPS)) {
    const old = fs.readdirSync(BACKUPS).sort().slice(0, -(KEEP_BACKUPS - 1));
    for (const d of old) fs.rmSync(path.join(BACKUPS, d), { recursive: true, force: true });
  }
  const files = new Map();
  for (const rel of walk()) {
    if (rel === SECRET) continue;
    const src = path.join(ROOT, rel);
    files.set(rel, hash(src));
    const dst = path.join(dir, 'files', rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(src, dst);
  }
  const head = (await exec('git', ['rev-parse', 'HEAD'])).out.trim();
  fs.writeFileSync(path.join(dir, 'uncommitted.patch'), (await exec('git', ['diff', 'HEAD'])).out, 'utf8');
  const status = (await exec('git', ['status', '--porcelain'])).out;
  fs.writeFileSync(path.join(dir, 'info.json'), JSON.stringify({ at: new Date().toISOString(), head, status, task }, null, 2), 'utf8');
  return { dir, files, secret: readSecret() };
}

function changes(snap) {
  const now = walk().filter((rel) => rel !== SECRET);
  const changed = [];
  const added = [];
  for (const rel of now) {
    if (!snap.files.has(rel)) added.push(rel);
    else if (hash(path.join(ROOT, rel)) !== snap.files.get(rel)) changed.push(rel);
  }
  const removed = [...snap.files.keys()].filter((rel) => !now.includes(rel));
  const secret = readSecret();
  const secretTouched = Boolean(snap.secret) !== Boolean(secret) || (secret && !secret.equals(snap.secret));
  return { changed, added, removed, secretTouched, all: [...changed, ...added] };
}

async function verify(ch) {
  const errors = [];
  let checked = 0;
  for (const rel of ch.all) {
    const full = path.join(ROOT, rel);
    if (/\.(c|m)?js$/i.test(rel)) {
      checked++;
      const r = await exec(process.execPath, ['--check', full]);
      if (!r.ok) errors.push(`${slash(rel)}: ${r.err.trim().slice(0, 1500)}`);
    } else if (/\.json$/i.test(rel)) {
      checked++;
      try {
        JSON.parse(fs.readFileSync(full, 'utf8').replace(/^\uFEFF/, ''));
      } catch (e) {
        errors.push(`${slash(rel)}: ${e.message}`);
      }
    }
  }
  if (!errors.length) {
    const script = `for (const m of ${JSON.stringify(SMOKE_MODULES)}) require('./server/' + m); process.exit(0);`;
    const r = await exec(process.execPath, ['-e', script], 60000);
    if (!r.ok) errors.push(`modül yükleme testi: ${r.err.trim().slice(0, 1500)}`);
  }
  return { ok: !errors.length, errors, checked };
}

function restore(snap, ch) {
  for (const rel of [...ch.changed, ...ch.removed]) {
    const dst = path.join(ROOT, rel);
    fs.mkdirSync(path.dirname(dst), { recursive: true });
    fs.copyFileSync(path.join(snap.dir, 'files', rel), dst);
  }
  for (const rel of ch.added) fs.rmSync(path.join(ROOT, rel), { force: true });
  if (ch.secretTouched && snap.secret) fs.writeFileSync(path.join(ROOT, SECRET), snap.secret);
}

/**
 * clis: [{ name, run(task) → { code, out, err } }] sırayla denenir; dosyaya dokunmadan hata veren CLI atlanır.
 * Dönen metin araç sonucu olarak kullanıcıya/modele gider.
 */
async function apply(task, clis) {
  if (busy) return 'Hata: Şu an başka bir kendini güncelleme işlemi sürüyor.';
  busy = true;
  try {
    const snap = await snapshot(task);
    const backup = slash(path.relative(ROOT, snap.dir));
    const skipped = [];
    let r, ch, cliName;
    for (const c of clis) {
      cliName = c.name;
      r = await c.run(task);
      ch = changes(snap);
      if (r.code === 0 || ch.all.length || ch.removed.length || ch.secretTouched) break;
      skipped.push(`${c.name} çalışmadı: ${`${r.out}\n${r.err}`.trim().split(/\r?\n/)[0].slice(0, 200)}`);
    }
    if (skipped.length && r.code !== 0 && !ch.all.length && !ch.removed.length && !ch.secretTouched) return `Hata: Hiçbir kodlama CLI'ı çalışmadı.\n${skipped.join('\n')}`;
    const summary =
      (skipped.length ? `(${skipped.join('; ')})\n` : '') +
      (`${r.out}${r.err && r.code !== 0 ? `\n[stderr]\n${r.err}` : ''}`.trim().slice(-6000) || '(CLI çıktı vermedi)');
    const list = [...ch.changed.map((f) => `~ ${slash(f)}`), ...ch.added.map((f) => `+ ${slash(f)}`), ...ch.removed.map((f) => `- ${slash(f)}`)];
    const secretNote = ch.secretTouched ? '\n⚠ config.json değiştirilmişti; eski haline geri yüklendi.' : '';

    if (ch.secretTouched && snap.secret) fs.writeFileSync(path.join(ROOT, SECRET), snap.secret);
    if (!list.length) {
      return `${r.code === 0 ? '' : 'Hata: '}${cliName} hiçbir dosyayı değiştirmedi (çıkış kodu ${r.code}).${secretNote}\n\nCLI çıktısı:\n${summary}`;
    }
    const v = r.code === 0 ? await verify(ch) : { ok: false, errors: [`${cliName} hata koduyla bitti (${r.code})`], checked: 0 };
    if (!v.ok) {
      restore(snap, ch);
      return `Hata: Değişiklik kontrolden geçemedi, tüm dosyalar eski haline geri yüklendi.\n${v.errors.join('\n')}\n\nDenenen değişiklikler:\n${list.join('\n')}${secretNote}\n\nCLI çıktısı:\n${summary}`;
    }

    const restart = ch.all.concat(ch.removed).some((f) => slash(f).startsWith('server/') || f === 'package.json');
    const web = ch.all.some((f) => slash(f).startsWith('web/'));
    if (restart) pendingRestart = { web, at: Date.now() };
    return (
      `✓ Değişiklik uygulandı (${cliName}).\n${list.join('\n')}\n` +
      `Kontroller geçti: ${v.checked} dosya sözdizimi, modül yükleme testi. Yedek: ${backup}${secretNote}\n` +
      (restart ? 'Sunucu bu yanıt bitince otomatik yeniden başlatılacak.\n' : '') +
      (web ? 'Arayüz dosyaları değişti: sayfayı Ctrl+F5 ile yenileyin.\n' : '') +
      `\nCLI özeti:\n${summary}`
    );
  } finally {
    busy = false;
  }
}

function restartPending() {
  return pendingRestart;
}

function restart() {
  if (!pendingRestart || pendingRestart.started) return;
  pendingRestart.started = true;
  bridge.broadcast('restarting', { web: pendingRestart.web });
  const env = { ...process.env };
  delete env.VB_OPEN;
  const node = process.execPath;
  const child =
    process.platform === 'win32'
      ? spawn('cmd.exe', ['/d', '/c', `ping -n 3 127.0.0.1 >nul & start "V.A.U.L.T. // B.R.E.A.C.H." /min "${node}" server\\index.js`], {
          cwd: ROOT, env, detached: true, stdio: 'ignore', windowsHide: true, windowsVerbatimArguments: true,
        })
      : spawn('sh', ['-c', `sleep 2; exec "${node}" server/index.js`], { cwd: ROOT, env, detached: true, stdio: 'ignore' });
  child.unref();
  console.log('  [self-edit] kod değişti, sunucu yeniden başlatılıyor…');
  setTimeout(() => process.exit(0), 400);
}

module.exports = { apply, snapshot, changes, verify, restore, restartPending, restart };
