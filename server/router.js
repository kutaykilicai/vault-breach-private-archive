const crypto = require('crypto');
const config = require('./config');

const ACTION = /(?<!\p{L})(aç|ac|kapat|çalıştır|calistir|başlat|kur|yükle|indir|sil|taşı|kopyala|oluştur|yarat|kaydet|yaz|düzenle|klasör|dosya|komut|terminal|powershell|script|kod|program|uygulama|bilgisayar|sistem|disk|ram|işlem|internet|web|site|ara|araştır|arastir|bul|oku|özetle|rapor|hafıza|not|vault|obsidian|plan|skill|grok|perplexity|gemini|claude|codex|kimi|open|run|install|download|delete|create|write|file|folder|search|research|browse)\w*/iu;

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
  const rule = TIER1.find((r) => r.test.test(s));
  if (forced && ['1', '2', '3'].includes(String(forced))) {
    const tier = Number(forced);
    if (tier === 1) return rule ? done({ tier: 1, reason: 'elle: kural', answer: rule.answer() }) : done({ tier: 2, reason: 'elle T1 ama kural yok → T2' });
    return done({ tier, reason: 'elle seçildi' });
  }
  if (rule) return done({ tier: 1, reason: 'kural eşleşti', answer: rule.answer() });
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

module.exports = { classify, jevUsage };
