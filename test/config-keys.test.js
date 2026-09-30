const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

// config.js'i yüklemeden önce izole bir dosyaya yönlendir: gerçek config.json'a dokunulmaz.
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-config-'));
process.env.VB_CONFIG_PATH = path.join(TMP, 'config.json');

const config = require('../server/config');
const providers = require('../server/providers');

const MASK = '••••••••';
// Testte kullanılan sahte anahtarlar; gerçek bir anahtar değildir.
const FAKE = { kimi: 'sk-kimi-TEST', gemini: 'AIza-TEST', jev: 'sk-freejev-TEST' };

function seed() {
  fs.writeFileSync(
    process.env.VB_CONFIG_PATH,
    JSON.stringify({
      vaultPath: "G:\\Drive'ım\\VAULT-Brain",
      modes: { vault: { provider: 'kimi', model: '' }, breach: { provider: 'local', model: '' } },
      fastModel: { provider: 'gemini', model: '' },
      jev: { apiKey: FAKE.jev },
      providers: { kimi: { apiKey: FAKE.kimi }, gemini: { apiKey: FAKE.gemini } },
    }),
    'utf8'
  );
  return config.load();
}

test.after(() => fs.rmSync(TMP, { recursive: true, force: true }));

test('isReady dolu anahtarı hazır, boş anahtarı hazır değil sayar', () => {
  seed();
  assert.strictEqual(providers.isReady('kimi'), true);
  assert.strictEqual(providers.isReady('gemini'), true);
  assert.strictEqual(providers.isReady('openrouter'), false);
  assert.strictEqual(providers.isReady('yok-boyle-bir-sey'), false);
  // LM Studio anahtar istemez.
  assert.strictEqual(providers.isReady('local'), true);
});

test('yalnızca boşluktan oluşan anahtar hazır sayılmaz', () => {
  seed();
  config.updateFromClient({ providers: { xai: { apiKey: '   ' } } });
  assert.strictEqual(providers.isReady('xai'), false);
});

test('maskelenmiş anahtar geri gönderilince gerçek anahtar korunur', () => {
  seed();
  const m = config.masked();
  assert.strictEqual(m.providers.kimi.apiKey, MASK);
  assert.strictEqual(m.providers.kimi.hasKey, true);
  assert.strictEqual(m.providers.openrouter.hasKey, false);

  config.updateFromClient({ providers: { kimi: { apiKey: m.providers.kimi.apiKey } }, jev: { apiKey: m.jev.apiKey } });
  assert.strictEqual(config.get().providers.kimi.apiKey, FAKE.kimi);
  assert.strictEqual(config.get().jev.apiKey, FAKE.jev);
});

test('apiKey hiç gönderilmezse anahtar korunur (derin birleştirme)', () => {
  seed();
  config.updateFromClient({
    modes: { vault: { provider: 'gemini', model: '' } },
    providers: { kimi: { baseUrl: 'https://api.moonshot.ai/v1', defaultModel: 'kimi-k3' } },
    jev: { enabled: false },
  });
  const c = config.get();
  assert.strictEqual(c.providers.kimi.apiKey, FAKE.kimi);
  assert.strictEqual(c.jev.apiKey, FAKE.jev);
  assert.strictEqual(c.modes.vault.provider, 'gemini');
  assert.strictEqual(c.modes.breach.provider, 'local', 'B.R.E.A.C.H. motoru bozulmamalı');
});

test('apiKey açıkça boş gönderilirse anahtar silinir', () => {
  seed();
  config.updateFromClient({ providers: { kimi: { apiKey: '' } } });
  assert.strictEqual(config.get().providers.kimi.apiKey, '');
  assert.strictEqual(providers.isReady('kimi'), false);
});

test('bozulmuş maske gerçek anahtarın üstüne yazmaz diye readBody düzeltildi', () => {
  seed();
  // U+FFFD'ye dönüşmüş maske artık maske sayılmaz; bu yüzden gövdenin hiç bozulmaması gerekir.
  const broken = '\uFFFD'.repeat(24);
  config.updateFromClient({ providers: { kimi: { apiKey: broken } } });
  assert.strictEqual(config.get().providers.kimi.apiKey, broken);
});

test('hazır değil mesajı hangi ayarın seçtiğini ve hazır motorları söyler', () => {
  seed();
  const msg = providers.notReadyMessage('openrouter', 'modes.vault');
  assert.match(msg, /providers\.openrouter\.apiKey/);
  assert.match(msg, /modes\.vault/);
  assert.match(msg, /Kimi \(Moonshot\) \(kimi\)/);
  assert.match(msg, /LM Studio \(Yerel\) \(local\)/);
  // Mesaj hiçbir anahtar değeri sızdırmamalı.
  for (const v of Object.values(FAKE)) assert.ok(!msg.includes(v));
});

test('bilinmeyen sağlayıcı için ayrı mesaj verilir', () => {
  seed();
  assert.match(providers.notReadyMessage('yok', 'modes.vault'), /diye bir sağlayıcı yok/);
});

test('readyProviders yalnızca kullanılabilir motorları döndürür', () => {
  seed();
  assert.deepStrictEqual(providers.readyProviders().sort(), ['gemini', 'kimi', 'local']);
});
