const { execFile, spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');
const config = require('./config');
const memory = require('./memory');
const providers = require('./providers');
const { which } = require('./detect');
const bridge = require('./bridge');

const isWin = process.platform === 'win32';
const MAX_OUT = 12000;

function clip(s, n = MAX_OUT) {
  s = String(s ?? '');
  return s.length > n ? `${s.slice(0, n)}\n…[${s.length - n} karakter kesildi]` : s;
}

function expandPath(p) {
  if (!p) return os.homedir();
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  return path.resolve(p);
}

function runProcess(cmd, args, { cwd, timeout = 120000, shell = false } = {}) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd, shell, windowsHide: true, env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      child.kill();
      err += `\n[zaman aşımı: ${timeout / 1000} sn]`;
    }, timeout);
    child.stdout.on('data', (d) => (out += d.toString('utf8')));
    child.stderr.on('data', (d) => (err += d.toString('utf8')));
    child.on('error', (e) => {
      clearTimeout(timer);
      resolve({ code: -1, out, err: err + e.message });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({ code, out, err });
    });
  });
}

function fmtProc(r) {
  return clip(`çıkış kodu: ${r.code}\n${r.out}${r.err ? `\n[stderr]\n${r.err}` : ''}`.trim());
}

function htmlToText(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|li|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n\n')
    .trim();
}

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126 Safari/537.36';

async function webSearch(query) {
  const res = await fetch('https://html.duckduckgo.com/html/', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
    body: new URLSearchParams({ q: query }).toString(),
    signal: AbortSignal.timeout(15000),
  });
  const html = await res.text();
  const results = [];
  const re = /<a[^>]*class="result__a"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/g;
  let m;
  while ((m = re.exec(html)) && results.length < 8) {
    let url = m[1];
    const u = /uddg=([^&]+)/.exec(url);
    if (u) url = decodeURIComponent(u[1]);
    results.push({ title: htmlToText(m[2]), url, snippet: htmlToText(m[3] || '') });
  }
  if (!results.length) return 'Sonuç bulunamadı (arama motoru yanıt vermemiş olabilir).';
  return results.map((r, i) => `${i + 1}. ${r.title}\n   ${r.url}\n   ${r.snippet}`).join('\n');
}

function cliArgSafe(s) {
  return String(s).replace(/"/g, "'").replace(/%/g, ' yüzde ').replace(/\r?\n/g, ' ');
}

const TOOLS = [
  {
    name: 'memory_search',
    risk: 'safe',
    description:
      'Obsidian hafızasında (kasa + salt okunur ek kökler) arama yapar. Kullanıcı hakkında bilgi, geçmiş projeler, ' +
      'notlar için önce bunu kullan. Bulamazsan eş anlamlı ya da daha genel bir kelimeyle bir kez daha dene.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: async ({ query }) => {
      const hits = memory.search(query, 8);
      if (!hits.length) return 'Hafızada eşleşme yok.';
      return hits
        .map((h) => `- ${h.path}${h.writable === false ? ' (salt okunur)' : ''} (skor ${h.score})\n  ${h.snippet}`)
        .join('\n');
    },
  },
  {
    name: 'memory_read',
    risk: 'safe',
    description:
      'Vault içinden bir notu tam olarak okur. path vault köküne göre göreli yol, not başlığı ya da ' +
      'salt okunur ek kök için "kökAdı:göreli/yol.md" biçimidir (örn: obsidian:Projeler/plan.md).',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async ({ path: p }) => clip(memory.read(p), 20000),
  },
  {
    name: 'memory_write',
    risk: 'safe',
    description: 'Vault içine not yazar veya mevcut nota ekler. Öğrendiğin kalıcı bilgileri, raporları ve özetleri buraya kaydet. Obsidian [[wikilink]] kullan.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Örn: inbox/fikir.md, wiki/konu.md, projects/x.md' },
        content: { type: 'string' },
        append: { type: 'boolean', description: 'true ise notun sonuna ekler' },
      },
      required: ['path', 'content'],
    },
    run: async ({ path: p, content, append }) => `Kaydedildi: ${memory.write(p, content, append)}`,
  },
  {
    name: 'run_command',
    risk: 'risky',
    description: isWin
      ? 'Bilgisayarda PowerShell komutu çalıştırır ve çıktısını döndürür.'
      : 'Bilgisayarda bash komutu çalıştırır ve çıktısını döndürür.',
    parameters: {
      type: 'object',
      properties: { command: { type: 'string' }, cwd: { type: 'string', description: 'Çalışma klasörü (opsiyonel)' } },
      required: ['command'],
    },
    run: async ({ command, cwd }) => {
      const dir = expandPath(cwd);
      const r = isWin
        ? await runProcess('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', `[Console]::OutputEncoding=[Text.Encoding]::UTF8; ${command}`], { cwd: dir })
        : await runProcess('bash', ['-lc', command], { cwd: dir });
      return fmtProc(r);
    },
  },
  {
    name: 'read_file',
    risk: 'safe',
    description: 'Bilgisayardaki bir metin dosyasını okur.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async ({ path: p }) => clip(fs.readFileSync(expandPath(p), 'utf8'), 20000),
  },
  {
    name: 'write_file',
    risk: 'risky',
    description: 'Bilgisayarda dosya oluşturur veya üzerine yazar.',
    parameters: { type: 'object', properties: { path: { type: 'string' }, content: { type: 'string' } }, required: ['path', 'content'] },
    run: async ({ path: p, content }) => {
      const full = expandPath(p);
      fs.mkdirSync(path.dirname(full), { recursive: true });
      fs.writeFileSync(full, content, 'utf8');
      return `Yazıldı: ${full} (${Buffer.byteLength(content)} bayt)`;
    },
  },
  {
    name: 'list_dir',
    risk: 'safe',
    description: 'Klasör içeriğini listeler.',
    parameters: { type: 'object', properties: { path: { type: 'string' } }, required: ['path'] },
    run: async ({ path: p }) => {
      const full = expandPath(p);
      const items = fs.readdirSync(full, { withFileTypes: true }).slice(0, 300);
      return `${full}\n` + items.map((e) => `${e.isDirectory() ? '[D]' : '   '} ${e.name}`).join('\n');
    },
  },
  {
    name: 'open_target',
    risk: 'risky',
    description: 'Bir programı, dosyayı, klasörü veya web adresini varsayılan uygulamayla açar (örn: "notepad", "https://x.com", "C:\\\\Users").',
    parameters: { type: 'object', properties: { target: { type: 'string' } }, required: ['target'] },
    run: async ({ target }) => {
      // cmd, tırnak dışındaki & | < > karakterlerini komut ayırıcı sayar; hedef her zaman tırnak içinde gitmeli.
      if (isWin) execFile('cmd.exe', ['/d', '/c', `start "" "${String(target).replace(/"/g, '')}"`], { windowsHide: true, windowsVerbatimArguments: true });
      else execFile(process.platform === 'darwin' ? 'open' : 'xdg-open', [target]);
      return `Açılıyor: ${target}`;
    },
  },
  {
    name: 'web_search',
    risk: 'safe',
    description: 'İnternette arama yapar (DuckDuckGo). Güncel bilgi için kullan, sonra fetch_url ile sayfaları oku.',
    parameters: { type: 'object', properties: { query: { type: 'string' } }, required: ['query'] },
    run: async ({ query }) => webSearch(query),
  },
  {
    name: 'fetch_url',
    risk: 'safe',
    description: 'Bir web sayfasını indirir ve düz metin olarak döndürür.',
    parameters: { type: 'object', properties: { url: { type: 'string' } }, required: ['url'] },
    run: async ({ url }) => {
      const res = await fetch(url, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(20000) });
      const type = res.headers.get('content-type') || '';
      const body = await res.text();
      return clip(`HTTP ${res.status} · ${url}\n\n${type.includes('html') ? htmlToText(body) : body}`, 15000);
    },
  },
  {
    name: 'system_info',
    risk: 'safe',
    description: 'Bilgisayarın durumunu verir: işlemci, RAM, diskler, en çok kaynak kullanan işlemler.',
    parameters: { type: 'object', properties: {} },
    run: async () => {
      const base = `Host: ${os.hostname()}\nOS: ${os.type()} ${os.release()}\nCPU: ${os.cpus()[0]?.model} (${os.cpus().length} çekirdek)\nRAM: ${(os.freemem() / 1024 ** 3).toFixed(1)} / ${(os.totalmem() / 1024 ** 3).toFixed(1)} GB boş\nÇalışma süresi: ${(os.uptime() / 3600).toFixed(1)} saat`;
      if (!isWin) return base;
      const r = await runProcess('powershell.exe', [
        '-NoProfile', '-Command',
        "[Console]::OutputEncoding=[Text.Encoding]::UTF8; Get-PSDrive -PSProvider FileSystem | ForEach-Object { '{0}: {1:N1} GB boş' -f $_.Name, ($_.Free/1GB) }; '--- En çok RAM kullanan işlemler ---'; Get-Process | Sort-Object WorkingSet64 -Descending | Select-Object -First 8 | ForEach-Object { '{0} {1:N0} MB' -f $_.ProcessName, ($_.WorkingSet64/1MB) }",
      ], { timeout: 20000 });
      return `${base}\n${r.out}`;
    },
  },
  {
    name: 'ask_model',
    risk: 'safe',
    description: 'Başka bir yapay zekâya danışır (anthropic = Claude, xai = Grok, perplexity = güncel web araştırması, gemini, kimi, nvidia, openrouter, local). Dikkat: veriler o servisin sunucusuna gider.',
    parameters: {
      type: 'object',
      properties: {
        provider: { type: 'string', enum: ['anthropic', 'xai', 'perplexity', 'gemini', 'kimi', 'nvidia', 'openrouter', 'local'] },
        prompt: { type: 'string' },
        model: { type: 'string', description: 'Opsiyonel model adı' },
      },
      required: ['provider', 'prompt'],
    },
    run: async ({ provider, prompt, model }, ctx) => {
      if (!providers.isReady(provider)) return `${provider} için API anahtarı ayarlanmamış.`;
      const answer = await providers.complete({ provider, model, messages: [{ role: 'user', content: prompt }], signal: ctx.signal });
      return clip(answer, 15000);
    },
  },
  {
    name: 'message_grok',
    risk: 'safe',
    description: "Kullanıcının Grok Bot'una mesaj bırakır (Grok Bot giden kutusunu kontrol ettiğinde alır). Grok Bot'tan gelen bir mesaja cevap verirken KULLANMA; o cevap zaten otomatik iletilir.",
    parameters: { type: 'object', properties: { text: { type: 'string' } }, required: ['text'] },
    run: async ({ text }, ctx) => {
      const m = bridge.queueOutgoing('grok', text, ctx.mode || 'breach');
      return `Grok Bot'a mesaj kuyruğa alındı (id ${m.id}).`;
    },
  },
  {
    name: 'delegate_cli',
    risk: 'risky',
    description: 'Görevi bilgisayarda kurulu bir AI CLI aracına devreder (claude, gemini, codex, kimi, grok, opencode). Büyük kodlama işleri için kullan.',
    parameters: {
      type: 'object',
      properties: {
        cli: { type: 'string' },
        prompt: { type: 'string' },
        cwd: { type: 'string', description: 'Çalışma klasörü (opsiyonel)' },
      },
      required: ['cli', 'prompt'],
    },
    run: async ({ cli, prompt, cwd }) => {
      const c = config.get().clis[cli];
      if (!c) return `Tanımsız CLI: ${cli}. Tanımlı olanlar: ${Object.keys(config.get().clis).join(', ')}`;
      const found = await which(c.cmd);
      if (!found) return `${c.cmd} bu bilgisayarda bulunamadı.`;
      const args = c.args.map((a) => a.replace('{prompt}', isWin ? `"${cliArgSafe(prompt)}"` : prompt));
      const r = await runProcess(c.cmd, args, { cwd: expandPath(cwd), timeout: 10 * 60 * 1000, shell: isWin });
      return fmtProc(r);
    },
  },
];

const byName = new Map(TOOLS.map((t) => [t.name, t]));

function schemas() {
  return TOOLS.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
}

module.exports = { TOOLS, byName, schemas };
