const crypto = require('crypto');
const config = require('./config');

const ACTION = /(?<!\p{L})(aç|ac|gir|git|kapat|çalıştır|calistir|başlat|kur|yükle|indir|sil|taşı|kopyala|oluştur|yarat|kaydet|yaz|düzenle|klasör|dosya|komut|terminal|powershell|script|kod|program|uygulama|bilgisayar|sistem|disk|ram|işlem|internet|web|site|ara|araştır|arastir|bul|oku|özetle|rapor|hafıza|not|vault|obsidian|plan|skill|grok|perplexity|gemini|claude|codex|kimi|open|run|install|download|delete|create|write|file|folder|search|research|browse)\w*/iu;

const TIER1 = [
  {
    test: /^(saat\s*(kaç|kac)|şu\s*an\s*saat)/iu,
    answer: () => `Saat ${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}.`,
  },
  {
    test: /^(bugün\s*(günlerden\s*ne|ne\s*günü|tarih)|tarih\s*ne|bugünün\s*tarihi)/iu,
    answer: () => `Bugün ${new Date().toLocaleDateString('tr-TR', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}.`,
  },
];

// Onaysız anında açılan sabit beyaz liste. Listede olmayan hedefler normal ajan yolundan (onaylı) geçer.
const SITES = [
  { label: 'YouTube', url: 'https://www.youtube.com', names: ['youtube', 'yt', 'yutub', 'yutup'], search: 'https://www.youtube.com/results?search_query=' },
  { label: 'Google', url: 'https://www.google.com', names: ['google', 'gugıl'], search: 'https://www.google.com/search?q=' },
  { label: 'Gmail', url: 'https://mail.google.com', names: ['gmail', 'mail', 'e-posta', 'eposta'] },
  { label: 'Google Drive', url: 'https://drive.google.com', names: ['drive', 'google drive'] },
  { label: 'Google Haritalar', url: 'https://www.google.com/maps', names: ['haritalar', 'harita', 'google maps', 'maps', 'google haritalar'], search: 'https://www.google.com/maps/search/' },
  { label: 'Google Çeviri', url: 'https://translate.google.com', names: ['çeviri', 'google çeviri', 'translate', 'google translate'] },
  { label: 'GitHub', url: 'https://github.com', names: ['github', 'git hub'], search: 'https://github.com/search?q=' },
  { label: 'ChatGPT', url: 'https://chatgpt.com', names: ['chatgpt', 'chat gpt', 'gpt'] },
  { label: 'Claude', url: 'https://claude.ai', names: ['claude', 'claude.ai'] },
  { label: 'Gemini', url: 'https://gemini.google.com', names: ['gemini'] },
  { label: 'X', url: 'https://x.com', names: ['twitter', 'x'], search: 'https://x.com/search?q=' },
  { label: 'Instagram', url: 'https://www.instagram.com', names: ['instagram', 'insta'] },
  { label: 'Facebook', url: 'https://www.facebook.com', names: ['facebook', 'fb'] },
  { label: 'WhatsApp Web', url: 'https://web.whatsapp.com', names: ['whatsapp', 'whatsapp web', 'wp', 'watsap'] },
  { label: 'Spotify', url: 'https://open.spotify.com', names: ['spotify'], search: 'https://open.spotify.com/search/' },
  { label: 'Netflix', url: 'https://www.netflix.com', names: ['netflix'] },
  { label: 'Vikipedi', url: 'https://tr.wikipedia.org', names: ['wikipedia', 'vikipedi', 'wiki'], search: 'https://tr.wikipedia.org/w/index.php?search=' },
  { label: 'Reddit', url: 'https://www.reddit.com', names: ['reddit'], search: 'https://www.reddit.com/search/?q=' },
  { label: 'LinkedIn', url: 'https://www.linkedin.com', names: ['linkedin'] },
  { label: 'Twitch', url: 'https://www.twitch.tv', names: ['twitch'] },
  { label: 'Discord', url: 'https://discord.com/app', names: ['discord'] },
  { label: 'Outlook', url: 'https://outlook.live.com', names: ['outlook', 'hotmail'] },
];

const APPS = [
  { label: 'Not Defteri', target: 'notepad', names: ['not defteri', 'notepad', 'notdefteri'] },
  { label: 'Hesap Makinesi', target: 'calc', names: ['hesap makinesi', 'hesap makinası', 'calculator', 'calc'] },
  { label: 'Dosya Gezgini', target: 'explorer', names: ['dosya gezgini', 'gezgin', 'explorer', 'bilgisayarım', 'klasörler'] },
  { label: 'Ayarlar', target: 'ms-settings:', names: ['ayarlar', 'windows ayarları', 'bilgisayar ayarları', 'settings'] },
  { label: 'Komut İstemi', target: 'cmd', names: ['cmd', 'komut istemi', 'komut satırı'] },
  { label: 'PowerShell', target: 'powershell', names: ['powershell', 'terminal', 'konsol'] },
  { label: 'Paint', target: 'mspaint', names: ['paint', 'mspaint'] },
  { label: 'Görev Yöneticisi', target: 'taskmgr', names: ['görev yöneticisi', 'task manager', 'taskmgr'] },
  { label: 'Denetim Masası', target: 'control', names: ['denetim masası', 'control panel'] },
  { label: 'Ekran Alıntısı Aracı', target: 'snippingtool', names: ['ekran alıntısı', 'ekran alıntısı aracı', 'snipping tool'] },
];

const QUICK = new Map();
for (const s of SITES) for (const n of s.names) QUICK.set(n, { ...s, target: s.url });
for (const a of APPS) for (const n of a.names) QUICK.set(n, a);

const SUFFIXES = ['nı', 'ni', 'nu', 'nü', 'na', 'ne', 'ya', 'ye', 'yı', 'yi', 'yu', 'yü', 'a', 'e', 'ı', 'i', 'u', 'ü'];
const OPEN_VERB = /\s+(?:gir|git|aç|ac|açsana|acsana|açın|açar\s*m[ıi]s[ıi]n|açabilir\s*m[ıi]s[ıi]n|başlat|baslat|çalıştır|calistir|getir)$/u;
const SEARCH_VERB = /\s+(?:ara|arat|aratsana|bul|aç|ac|oynat|çal|cal)$/u;
const FILLER = /^(?:lütfen|lutfen|hemen|şimdi|simdi|bana|bir|benim\s+için)\s+|\s+(?:lütfen|lutfen|hemen|bakalım|bakayım|şimdi)$/u;
const KIND_WORD = /\s+(?:sitesine|sitesini|sitesi|sayfasına|sayfasını|sayfası|uygulamasına|uygulamasını|uygulaması|programına|programını|programı|adresine|adresini)$/u;
const DOMAIN = /^(?:https?:\/\/)?(?:www\.)?((?:[a-z0-9-]+\.)+[a-z]{2,})(\/\S*)?$/;

function lookupName(w) {
  w = w.trim();
  if (QUICK.has(w)) return QUICK.get(w);
  const apo = w.split(/['’`]/)[0].trim();
  if (apo !== w && QUICK.has(apo)) return QUICK.get(apo);
  const sp = /^(.+?)\s+(?:y?[aeıiuü]|n[aeıiuü])$/u.exec(w);
  if (sp && QUICK.has(sp[1])) return QUICK.get(sp[1]);
  for (const suf of SUFFIXES) {
    if (w.length > suf.length + 1 && w.endsWith(suf) && QUICK.has(w.slice(0, -suf.length))) return QUICK.get(w.slice(0, -suf.length));
  }
  return null;
}

function lookupDomain(w) {
  const m = DOMAIN.exec(w.split(/['’`]/)[0].trim());
  if (!m) return null;
  const host = m[1];
  const site = SITES.find((s) => {
    const h = new URL(s.url).hostname.replace(/^www\./, '');
    return host === h || host.endsWith(`.${h}`);
  });
  if (!site) return null;
  const path = m[2] && !/["\s]/.test(m[2]) ? m[2] : '';
  return { label: site.label, target: `https://${host}${path}` };
}

/** "youtube'a gir", "hesap makinesi aç", "youtube'da lofi ara" → { label, target } | null */
function quickOpen(text) {
  let s = text.toLocaleLowerCase('tr-TR').replace(/[.!?…]+$/u, '').replace(/\s+/g, ' ').trim();
  for (let i = 0; i < 3; i++) s = s.replace(FILLER, '');
  if (!s || s.length > 120 || /[\n,;]|\s(?:ve|sonra|ardından)\s/u.test(s)) return null;

  if (SEARCH_VERB.test(s)) {
    const body = s.replace(SEARCH_VERB, '');
    for (const site of SITES.filter((x) => x.search)) {
      for (const n of site.names) {
        const m = new RegExp(`^${n.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s?['’\`]?\\s?(?:n?da|n?de|ta|te)\\s+(.+)$`, 'u').exec(body);
        if (m && m[1].trim()) {
          const q = m[1].trim().replace(/^["“](.*)["”]$/u, '$1');
          return { label: `${site.label} araması: ${q}`, target: site.search + encodeURIComponent(q), done: `${site.label} araması açıldı: "${q}".` };
        }
      }
    }
  }

  let obj = null;
  if (OPEN_VERB.test(s)) obj = s.replace(OPEN_VERB, '');
  else {
    const en = /^(?:open|launch|start)\s+(.+)$/.exec(s);
    if (en) obj = en[1];
  }
  if (!obj) return null;
  obj = obj.replace(KIND_WORD, '').trim();
  const hit = lookupName(obj) || lookupDomain(obj);
  return hit ? { label: hit.label, target: hit.target, done: `${hit.label} açıldı.` } : null;
}

const EDIT_VERB = '(?:g[uü]ncelle|geli[sş]tir|d[uü]zenle|de[gğ]i[sş]tir)';
const SELF_EDIT = [
  { re: /^\/(?:kendin|self)\s+(.+)$/su },
  { re: new RegExp(`^kendini\\s+${EDIT_VERB}(?:\\s*[:,\\-–]\\s*|\\s+)(.+)$`, 'su') },
  { re: new RegExp(`^(?:kendi\\s+)?kodunu\\s+${EDIT_VERB}(?:\\s*[:,\\-–]\\s*|\\s+)(.+)$`, 'su') },
  { re: /^kendine\s+.+\s(?:ekle|eklesene|ekleyin|ekler\s+misin|ekleyebilir\s+misin|ekleyiver)[.!?\s]*$/su, whole: true },
];

/** "kendine X ekle", "kendini güncelle: X", "kodunu değiştir X", "/kendin X" → görev metni | null */
function selfEditTask(text) {
  const s = text.trim().replace(/^(?:lütfen|lutfen)[,\s]+/iu, '');
  const lower = s.toLocaleLowerCase('tr-TR');
  const src = lower.length === s.length ? s : lower;
  for (const { re, whole } of SELF_EDIT) {
    const m = re.exec(lower);
    if (!m) continue;
    const task = whole ? src : src.slice(m.index + m[0].length - m[1].length);
    if (task.trim()) return task.trim();
  }
  return null;
}

const JEV_QUESTION = {
  instructions:
    'A personal AI assistant running on the user\'s own PC received this request. Which handling tier does it need?',
  type: 'choice',
  criteria: {
    T2: 'Plain conversation, opinion, explanation, translation, brainstorming or a knowledge question the model can answer directly without tools.',
    T3: 'Needs tools or actions: controlling the computer, files, folders, commands, opening apps or sites, web search or current/live information, reading or writing the user\'s personal notes/memory, or a multi-step task.',
  },
};

let lastCredits = null;

function heuristic(s) {
  if (s.startsWith('[SKILL:')) return { tier: 3, reason: 'skill çalıştırma' };
  if (ACTION.test(s)) return { tier: 3, reason: 'eylem/araç gerektiriyor' };
  if (s.length > 280) return { tier: 3, reason: 'uzun ve karmaşık istek' };
  return { tier: 2, reason: 'sohbet / hızlı cevap' };
}

function jevUsable(mode) {
  const j = config.get().jev;
  return Boolean(j?.enabled && j.apiKey && (mode !== 'breach' || j.useInBreach));
}

async function askJev(text) {
  const j = config.get().jev;
  const res = await fetch(`${j.baseUrl.replace(/\/$/, '')}/decisions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${j.apiKey}`,
      'Content-Type': 'application/json',
      'Idempotency-Key': crypto.randomUUID(),
    },
    body: JSON.stringify({ state: text.slice(0, 2000), questions: { tier: JEV_QUESTION } }),
    signal: AbortSignal.timeout(j.timeoutMs || 4000),
  });
  if (!res.ok) throw new Error(`Jev HTTP ${res.status}`);
  const data = await res.json();
  const ans = data.answers?.tier;
  if (!ans?.choice) throw new Error('Jev geçerli karar döndürmedi');
  if (typeof data.usage?.credits_remaining === 'number') lastCredits = data.usage.credits_remaining;
  return { tier: ans.choice === 'T3' ? 3 : 2, confidence: ans.confidence ?? ans.probabilities?.[ans.choice] ?? null };
}

async function jevUsage() {
  const j = config.get().jev;
  if (!j?.apiKey) return null;
  try {
    const res = await fetch(`${j.baseUrl.replace(/\/$/, '')}/usage`, {
      headers: { Authorization: `Bearer ${j.apiKey}` },
      signal: AbortSignal.timeout(4000),
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const data = await res.json();
    const credits = data.credits_remaining ?? data.usage?.credits_remaining ?? data.balance ?? data.credits ?? null;
    if (typeof credits === 'number') lastCredits = credits;
    return { credits: lastCredits };
  } catch (e) {
    return { credits: lastCredits, error: e.message };
  }
}

/**
 * Tier 1: kural + anlık cevap (yerel). Tier 2: araçsız hızlı sohbet. Tier 3: araçlı ajan.
 * Jev ayarlıysa T2/T3 kararını Jev verir; hata veya zaman aşımında yerel sezgiye düşer.
 */
async function classify(text, forced, mode) {
  const t0 = process.hrtime.bigint();
  const done = (r) => ({ source: 'yerel', ...r, ms: Number(process.hrtime.bigint() - t0) / 1e6, credits: lastCredits });

  const s = (text || '').trim();
  const selfTask = selfEditTask(s);
  if (selfTask) return done({ tier: 1, source: 'kural', reason: 'kendini güncelleme komutu', action: { tool: 'self_update', args: { task: selfTask } } });
  const rule = TIER1.find((r) => r.test.test(s));
  const quick = rule ? null : quickOpen(s);
  const quickRoute = (reason) =>
    done({ tier: 1, source: 'kural', reason: `${reason}: ${quick.label}`, answer: quick.done, action: { tool: 'open_target', args: { target: quick.target } } });
  if (forced && ['1', '2', '3'].includes(String(forced))) {
    const tier = Number(forced);
    if (tier === 1) {
      if (rule) return done({ tier: 1, reason: 'elle: kural', answer: rule.answer() });
      if (quick) return quickRoute('elle: hızlı eylem');
      return done({ tier: 2, reason: 'elle T1 ama kural yok → T2' });
    }
    return done({ tier, reason: 'elle seçildi' });
  }
  if (rule) return done({ tier: 1, reason: 'kural eşleşti', answer: rule.answer() });
  if (quick) return quickRoute('hızlı eylem');
  if (s.startsWith('[SKILL:')) return done({ tier: 3, reason: 'skill çalıştırma' });

  if (jevUsable(mode)) {
    try {
      const j = await askJev(s);
      const pct = j.confidence == null ? '' : ` · %${Math.round(j.confidence * 100)}`;
      return done({ tier: j.tier, source: 'jev', reason: `jev kararı${pct}` });
    } catch (e) {
      return done({ ...heuristic(s), reason: `yedek (${e.name === 'TimeoutError' ? 'jev zaman aşımı' : e.message})` });
    }
  }
  return done(heuristic(s));
}

heuristic('ısınma: dosya aç');
TIER1.forEach((r) => r.test.test('ısınma'));
quickOpen("youtube'da ısınma ara");

module.exports = { classify, jevUsage, quickOpen, selfEditTask };
