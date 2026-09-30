// node --test test/
// Sentetik Obsidian vault üzerinde indeksleme ve Türkçe eşleştirme doğrulaması.
const assert = require('node:assert/strict');
const { test, before, after } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-memory-'));
const FIXTURE = path.join(TMP, 'obsidian');
const VAULT = path.join(TMP, 'vault');
process.env.VB_CONFIG_PATH = path.join(TMP, 'config.json');

const ROOT = path.resolve(__dirname, '..');
let config;
let memory;

before(() => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-fixture.js'), FIXTURE, '--notes', '70'], { stdio: 'pipe' });
  fs.mkdirSync(path.join(VAULT, 'profile'), { recursive: true });
  fs.writeFileSync(
    path.join(VAULT, 'profile', 'me.md'),
    '# Ben\n\nAdım Kutay. Ev kasam Ryzen 7 5700X3D. Türkçe konuşuyorum.\n',
    'utf8'
  );
  fs.mkdirSync(path.join(VAULT, 'inbox', 'sohbet-kayitlari'), { recursive: true });
  fs.writeFileSync(
    path.join(VAULT, 'inbox', 'sohbet-kayitlari', '2026-04-12.md'),
    `# Sohbet kaydı\n\n${'hafıza donanım proje fikir günlük ısınma İstanbul '.repeat(500)}`,
    'utf8'
  );
  config = require(path.join(ROOT, 'server', 'config.js'));
  memory = require(path.join(ROOT, 'server', 'memory.js'));
});

after(() => fs.rmSync(TMP, { recursive: true, force: true }));

function setup(extra = {}) {
  config.save({
    vaultPath: VAULT,
    memory: {
      coreNotes: ['profile/me.md'],
      maxHits: 5,
      snippetChars: 400,
      coreChars: 4000,
      minTokenChars: 3,
      reindexStaleMs: 60000,
      extraRoots: [{ id: 'obsidian', label: 'Obsidian beyni', path: FIXTURE }],
      excludeGlobs: [],
      ...extra,
    },
  });
  memory.build(true);
}

const titles = (q, k) => memory.search(q, k).map((h) => h.title);

test('.obsidian klasörü atlanır, iki kök birlikte indekslenir', () => {
  setup();
  const s = memory.stats();
  const obsidian = s.roots.find((r) => r.id === 'obsidian');
  const vault = s.roots.find((r) => r.id === 'vault');
  assert.equal(obsidian.notes, 70, 'sahte vault 70 not (gizli .obsidian notu hariç)');
  assert.equal(vault.notes, 2);
  assert.equal(s.notes, 72);
  assert.ok(!memory.search('gizli anahtar', 10).some((h) => h.path.includes('.obsidian')));
});

test('ASCII yazım Türkçe notu bulur (I/ı, İ/i katlaması)', () => {
  setup();
  // Eski davranış: "hafiza" → tr-locale küçük harf "hafiza", notta "hafıza" → eşleşme yok.
  assert.ok(titles('hafiza').includes('Hafıza Tasarımı'), 'hafiza');
  assert.ok(titles('HAFIZA').includes('Hafıza Tasarımı'), 'HAFIZA');
  assert.ok(titles('hafıza').includes('Hafıza Tasarımı'), 'hafıza');
  assert.ok(titles('Istanbul').includes('2026-04-11 Cuma'), 'ASCII Istanbul → İstanbul');
  assert.ok(titles('istanbul').includes('2026-04-11 Cuma'), 'istanbul');
  assert.ok(titles('isinma sorunu').includes('Isınma Sorunu'), 'isinma → Isınma');
  assert.ok(titles('sisli toplanti').includes('2026-04-11 Cuma'), 'sisli → Şişli');
});

test('çekim ekleri kökte buluşur', () => {
  setup();
  assert.ok(titles('hafızamda ne yazıyor').includes('Hafıza Tasarımı'), 'hafızamda');
  assert.ok(titles('hafızasını anlat').includes('Hafıza Tasarımı'), 'hafızasını');
  assert.ok(titles('donanımlarım neler').some((t) => t === 'Kasa Donanımı' || t === 'Isınma Sorunu'), 'donanımlarım');
  assert.ok(titles('projelerimi listele').includes('VAULT-BREACH Mimarisi'), 'projelerimi');
});

test('klasör adı, etiket ve bağlantı hedefi aranabilir metnin parçası', () => {
  setup();
  assert.ok(titles('günlük', 10).some((t) => t.startsWith('2026-04-')), 'klasör/etiket: günlük');
  assert.ok(titles('wiki obsidian', 10).includes('Obsidian Kullanımı'), 'klasör: Wiki');
  assert.ok(titles('arşiv', 10).some((t) => t.startsWith('Dolgu')), 'klasör: Arsiv');
});

test('frontmatter aliases başlık gibi ağırlıklanır', () => {
  setup();
  assert.equal(titles('bellek tasarımı')[0], 'Hafıza Tasarımı');
  assert.ok(titles('memory design').includes('Hafıza Tasarımı'));
});

test('uzun notlar ham kelime sayısıyla öne geçmiyor', () => {
  setup();
  const hits = memory.search('ısınma sorunu fan eğrisi', 5);
  assert.equal(hits[0].title, 'Isınma Sorunu');
  // Sohbet kaydı her anahtar kelimeyi 500 kez içeriyor; uzunluk normalizasyonu olmadan birinci olurdu.
  const log = hits.findIndex((h) => h.path.includes('sohbet-kayitlari'));
  assert.ok(log === -1 || log > 0, `sohbet kaydı sırası: ${log}`);
});

test('durak kelimeler tek başına sonuç üretmez', () => {
  setup();
  assert.equal(memory.search('bu şu ve ile için').length, 0);
});

test('excludeGlobs kasadaki yolları aramadan çıkarır', () => {
  setup({ excludeGlobs: ['inbox/sohbet-kayitlari/**'] });
  assert.equal(memory.stats().roots.find((r) => r.id === 'vault').notes, 1);
  assert.ok(!memory.search('hafıza donanım', 20).some((h) => h.path.includes('sohbet-kayitlari')));
});

test('maxHits ve snippetChars yapılandırılabilir', () => {
  const uzunSorgu = 'uzun gövde metni doldurma cümlesi';
  setup({ maxHits: 12, snippetChars: 400 });
  const az = memory.search('proje donanım fikir günlük');
  assert.ok(az.length > 5 && az.length <= 12, `hit sayısı ${az.length}`);
  const kisaSnippet = memory.search(uzunSorgu, 1)[0].snippet.length;

  setup({ maxHits: 3, snippetChars: 1200 });
  assert.equal(memory.search('proje donanım fikir günlük').length, 3);
  const uzunSnippet = memory.search(uzunSorgu, 1)[0].snippet.length;
  assert.ok(kisaSnippet < 460, `400 ayarında snippet ${kisaSnippet}`);
  assert.ok(uzunSnippet > 1000, `1200 ayarında snippet ${uzunSnippet}`);
});

test('ek kök salt okunur: okunur, yazılamaz', () => {
  setup();
  const hit = memory.search('hafiza').find((h) => h.root === 'obsidian');
  assert.ok(hit, 'ek kökten bir sonuç');
  assert.equal(hit.writable, false);
  assert.match(hit.path, /^obsidian:/);
  assert.match(memory.read(hit.path), /Hafıza|hafıza/);
  assert.match(memory.read('obsidian:Wiki/Obsidian Kullanımı.md'), /Klasör adları/);
  assert.throws(() => memory.write('obsidian:Wiki/deneme.md', 'x'), /salt okunur/);
});

test('kasaya yazma klasörsüz adları writeFolder altına koyar', () => {
  setup({ writeFolder: 'inbox' });
  assert.equal(memory.write('fikir-testi', 'içerik'), 'inbox/fikir-testi.md');
  assert.equal(memory.write('wiki/konu-testi.md', 'içerik'), 'wiki/konu-testi.md');
  assert.ok(fs.existsSync(path.join(VAULT, 'inbox', 'fikir-testi.md')));
  assert.throws(() => memory.write('../kacak.md', 'x'), /Kök dışına/);
});

test('çekirdek not coreChars kadar kırpılır', () => {
  setup({ coreNotes: ['profile/me.md'], coreChars: 200 });
  const core = memory.coreContext();
  assert.ok(core.includes('profile/me.md'));
  assert.ok(core.split('\n').slice(1).join('\n').length <= 200);
  assert.equal(memory.stats().limits.coreChars, 200);
});

test('grafik iki kökü birleştirir ve bağlantıları çözer', () => {
  setup();
  const g = memory.graph();
  assert.equal(g.total, memory.stats().notes);
  assert.ok(g.nodes.length === g.total);
  assert.ok(g.links.length > 0, 'wikilink bağlantıları çözüldü');
  assert.ok(g.nodes.some((n) => n.root === 'obsidian'));
  const ids = new Set(g.nodes.map((n) => n.id));
  assert.ok(ids.has('profile/me.md'), 'kasa notları ref olarak göreli yol');
});

test('yeniden indeksleme değişen notu yakalar', () => {
  setup();
  assert.equal(memory.search('kuantum dolanıklığı').length, 0);
  fs.writeFileSync(path.join(VAULT, 'wiki', 'yeni.md'), '# Yeni\n\nKuantum dolanıklığı üzerine notlar.\n', 'utf8');
  memory.build(true);
  assert.ok(memory.search('kuantum dolanıklığı').length > 0);
});
