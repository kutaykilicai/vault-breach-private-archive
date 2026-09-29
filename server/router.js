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

/**
 * Jev benzeri hızlı sınıflandırıcı: model çağırmadan isteği katmana ayırır.
 * Tier 1: kural + anlık cevap. Tier 2: araçsız hızlı sohbet. Tier 3: araçlı ajan.
 */
function classify(text, forced) {
  const t0 = process.hrtime.bigint();
  const done = (tier, reason, answer) => ({
    tier,
    reason,
    answer,
    ms: Number(process.hrtime.bigint() - t0) / 1e6,
  });

  const s = (text || '').trim();
  if (forced && ['1', '2', '3'].includes(String(forced))) {
    const tier = Number(forced);
    if (tier === 1) {
      const rule = TIER1.find((r) => r.test.test(s));
      return rule ? done(1, 'elle: kural', rule.answer()) : done(2, 'elle T1 ama kural yok → T2');
    }
    return done(tier, 'elle seçildi');
  }
  const rule = TIER1.find((r) => r.test.test(s));
  if (rule) return done(1, 'kural eşleşti', rule.answer());
  if (s.startsWith('[SKILL:')) return done(3, 'skill çalıştırma');
  if (ACTION.test(s)) return done(3, 'eylem/araç gerektiriyor');
  if (s.length > 280) return done(3, 'uzun ve karmaşık istek');
  return done(2, 'sohbet / hızlı cevap');
}

classify('ısınma: dosya aç');

module.exports = { classify };
