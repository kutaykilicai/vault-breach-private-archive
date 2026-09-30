// node --test test/obsidian-import.test.js
// İçe aktarıcının davranışı: salt okunur kaynak, idempotans, maskeleme, bağlantı onarımı,
// gelen kutusu işleme ve aktarılan notların gerçekten aranabilir olması.
const assert = require('node:assert/strict');
const { test, before, after, beforeEach } = require('node:test');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..');
const IMPORTER = path.join(ROOT, 'scripts', 'obsidian-import.js');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'vb-import-'));
const SOURCE = path.join(TMP, 'obsidian');

let importer;

before(() => {
  execFileSync(process.execPath, [path.join(ROOT, 'scripts', 'make-fixture.js'), SOURCE, '--notes', '70'], { stdio: 'pipe' });
  importer = require(IMPORTER);
});
after(() => fs.rmSync(TMP, { recursive: true, force: true }));

let seq = 0;
let vault;
beforeEach(() => {
  vault = path.join(TMP, `vault-${++seq}`);
  fs.mkdirSync(path.join(vault, 'profile'), { recursive: true });
  fs.writeFileSync(path.join(vault, 'profile', 'me.md'), '# Ben\n\nAdım Kutay.\n', 'utf8');
});

function cli(...args) {
  const out = execFileSync(process.execPath, [IMPORTER, ...args], { encoding: 'utf8' });
  const num = (label) => {
    const m = new RegExp(`${label}\\s*:\\s*(\\d+)`).exec(out);
    return m ? Number(m[1]) : null;
  };
  return {
    out,
    yeni: num('yeni'),
    guncellenen: num('güncellenen'),
    degismeyen: num('değişmeyen'),
    atlanan: num('atlanan'),
    hata: num('hata'),
    taranan: num('taranan'),
    islenen: num('işlenen'),
    maskeleme: num('maskeleme'),
    kirik: num('kırık bağlantı'),
  };
}

function tree(dir) {
  const out = new Map();
  const walk = (rel) => {
    for (const e of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
      const child = rel ? `${rel}/${e.name}` : e.name;
      if (e.isDirectory()) walk(child);
      else out.set(child, crypto.createHash('sha1').update(fs.readFileSync(path.join(dir, child))).digest('hex'));
    }
  };
  walk('');
  return out;
}

test('--dry-run hiçbir şey yazmaz ve kaynağa dokunmaz', () => {
  const before = tree(SOURCE);
  const r = cli('--source', SOURCE, '--vault', vault, '--dry-run');
  assert.ok(r.yeni > 50, `önizleme ${r.yeni} not planladı`);
  assert.ok(!fs.existsSync(path.join(vault, 'obsidian')), 'hedef klasör oluşmadı');
  assert.deepEqual([...tree(SOURCE)], [...before], 'kaynak bit bit aynı');
});

test('aktarım kaynağı değiştirmez; ikinci ve üçüncü çalıştırma idempotent', () => {
  const before = tree(SOURCE);
  const bir = cli('--source', SOURCE, '--vault', vault);
  assert.ok(bir.yeni > 50);
  assert.equal(bir.hata, 0);
  assert.deepEqual([...tree(SOURCE)], [...before], 'kaynak aktarımdan sonra da aynı');

  // Manifest hariç: içinde her çalıştırmada değişen updatedAt damgası var.
  const notlarOf = (dir) => [...tree(dir)].filter(([rel]) => rel.endsWith('.md'));
  const hedefIlk = notlarOf(path.join(vault, 'obsidian'));
  const iki = cli('--source', SOURCE, '--vault', vault);
  assert.equal(iki.yeni, 0);
  assert.equal(iki.guncellenen, 0);
  assert.equal(iki.degismeyen, bir.yeni);
  const uc = cli('--source', SOURCE, '--vault', vault);
  assert.equal(uc.degismeyen, bir.yeni);
  assert.deepEqual(notlarOf(path.join(vault, 'obsidian')), hedefIlk, 'hedef notlar bit bit aynı');
});

test('hassas klasörler tümden atlanır', () => {
  cli('--source', SOURCE, '--vault', vault);
  const hedef = path.join(vault, 'obsidian');
  for (const klasor of ['Is', 'Gizli', 'Mail']) {
    assert.ok(!fs.existsSync(path.join(hedef, klasor)), `${klasor} aktarılmamalı`);
  }
  const hepsi = [...tree(hedef).keys()].join('\n');
  assert.ok(!/Musteri|Anahtarlar|Gelen Kutusu/.test(hepsi));
});

test('hassas olmayan nottaki sırlar maskelenir, faydalı metin kalır', () => {
  const r = cli('--source', SOURCE, '--vault', vault);
  assert.ok(r.maskeleme >= 3, `maskeleme ${r.maskeleme}`);
  const not = fs.readFileSync(path.join(vault, 'obsidian', 'Notlar', 'Karisik Kurulum Notu.md'), 'utf8');
  assert.ok(!not.includes('sk-or-v1-abc123'), 'API anahtarı sızmadı');
  assert.ok(!not.includes('ornek.kisi@ornek-alan.com'), 'e-posta sızmadı');
  assert.ok(!not.includes('0532 444 55 66'), 'telefon sızmadı');
  assert.match(not, /\[gizlendi: api-anahtarı\]/);
  assert.match(not, /\[gizlendi: e-posta\]/);
  assert.ok(not.includes('Vulkan motorunu seç'), 'faydalı içerik korundu');
});

test('YAML frontmatter atılır, anahtar kelimeler metne taşınır, tek başlık kalır', () => {
  cli('--source', SOURCE, '--vault', vault);
  const not = fs.readFileSync(path.join(vault, 'obsidian', 'Projeler', 'Hafıza Tasarımı.md'), 'utf8');
  assert.ok(!not.startsWith('---'), 'frontmatter kalmadı');
  assert.ok(!/^created:/m.test(not), 'YAML alanları kalmadı');
  assert.match(not, /^# Hafıza Tasarımı$/m);
  assert.equal(not.match(/^# /gm).length, 1, 'tek H1');
  // Klasör/etiket/takma ad aramayı etkilemediği için kelimeler metnin içinde durmalı.
  assert.match(not, /> Anahtar kelimeler:.*bellek tasarımı/);
  assert.match(not, /> Anahtar kelimeler:.*Projeler/);
  assert.match(not, /#obsidian-aktarim/);
});

test('[[bağlantılar]] gerçek dosya adlarına düzeltilir, çözülemeyen düz metne iner', () => {
  cli('--source', SOURCE, '--vault', vault);
  const hedef = path.join(vault, 'obsidian');
  const not = fs.readFileSync(path.join(hedef, 'Projeler', 'VAULT-BREACH Mimarisi.md'), 'utf8');
  // Klasör öneki ve küçük harf düzeltildi.
  assert.ok(!not.includes('[[projeler/hafıza tasarımı]]'));
  assert.ok(not.includes('[[Hafıza Tasarımı]]'));
  // Takma ad üzerinden bağlantı gerçek dosya adına çevrildi, etiket korundu.
  assert.ok(not.includes('[[Hafıza Tasarımı|belleğe bak]]'));
  // Windows'ta geçersiz karakterli hedef, diskteki temizlenmiş ada bağlandı.
  assert.ok(not.includes('[[Rapor- 2026 Q1]]'), not.match(/Rapor.*/)?.[0]);
  // Başlık çapası korundu.
  assert.ok(not.includes('[[Isınma Sorunu#Fan]]'));
  // Gömülü dosya ve Obsidian yorumu temizlendi.
  assert.ok(not.includes('(ek: sema.png)') && !not.includes('![['));
  assert.ok(!not.includes('Obsidian yorumu'), 'yorum dışa çıkmadı');
  assert.ok(!not.includes('dataview'), 'dataview bloğu temizlendi');
  assert.ok(!/\^abc12345/.test(not), 'blok kimliği temizlendi');

  // Her [[bağlantı]] hedefi gerçekten var olan bir dosyaya işaret etmeli (grafik koşulu).
  const dosyalar = new Set([...tree(hedef).keys()].filter((f) => f.endsWith('.md')).map((f) => path.basename(f, '.md')));
  for (const [rel] of tree(hedef)) {
    if (!rel.endsWith('.md')) continue;
    const icerik = fs.readFileSync(path.join(hedef, rel), 'utf8');
    for (const m of icerik.matchAll(/\[\[([^\]|#^]+)/g)) {
      assert.ok(dosyalar.has(m[1].trim()), `${rel} içindeki [[${m[1]}]] hedefi yok`);
    }
  }
});

test('Windows için sorunlu dosya adları güvenli hâle getirilir', () => {
  cli('--source', SOURCE, '--vault', vault);
  const adlar = [...tree(path.join(vault, 'obsidian')).keys()];
  for (const rel of adlar) {
    const base = path.basename(rel);
    assert.ok(!/[<>:"|?*]/.test(base), `geçersiz karakter: ${base}`);
    assert.ok(!/[. ]$/.test(base.replace(/\.md$/, '')), `sonu nokta/boşluk: ${base}`);
    assert.ok(base.length <= 105, `çok uzun: ${base.length}`);
    assert.ok(!/^(con|prn|aux|nul|com\d|lpt\d)\.md$/i.test(base), `rezerve ad: ${base}`);
  }
  assert.ok(adlar.some((a) => a.endsWith('_CON.md')), 'rezerve ad öneklendi');
});

test('hedefteki el değişiklikleri korunur, --force üzerine yazar', () => {
  cli('--source', SOURCE, '--vault', vault);
  const dosya = path.join(vault, 'obsidian', 'Fikirler', 'Akşam Rutini.md');
  fs.appendFileSync(dosya, '\nBunu ben elle ekledim.\n', 'utf8');
  const korumali = cli('--source', SOURCE, '--vault', vault);
  assert.ok(korumali.atlanan >= 4, `atlanan ${korumali.atlanan}`);
  assert.match(korumali.out, /hedef-elle-değişmiş: 1/);
  assert.ok(fs.readFileSync(dosya, 'utf8').includes('Bunu ben elle ekledim.'));

  const zorla = cli('--source', SOURCE, '--vault', vault, '--force');
  assert.ok(zorla.guncellenen >= 1, `güncellenen ${zorla.guncellenen}`);
  assert.ok(!fs.readFileSync(dosya, 'utf8').includes('Bunu ben elle ekledim.'));
});

test('kaynaktaki değişiklik yeniden aktarılır', () => {
  cli('--source', SOURCE, '--vault', vault);
  const kaynakNot = path.join(SOURCE, 'Fikirler', 'Sesli Asistan Fikri.md');
  const orijinal = fs.readFileSync(kaynakNot, 'utf8');
  try {
    fs.writeFileSync(kaynakNot, `${orijinal}\nYeni satır: kulaklık mikrofonu denendi.\n`, 'utf8');
    const r = cli('--source', SOURCE, '--vault', vault);
    assert.equal(r.guncellenen, 1);
    assert.ok(fs.readFileSync(path.join(vault, 'obsidian', 'Fikirler', 'Sesli Asistan Fikri.md'), 'utf8').includes('kulaklık mikrofonu'));
  } finally {
    fs.writeFileSync(kaynakNot, orijinal, 'utf8');
  }
});

test('--exclude ve --limit çalışır', () => {
  const r = cli('--source', SOURCE, '--vault', vault, '--exclude', 'Arsiv/**', '--dry-run');
  assert.ok(r.taranan < 40, `Arsiv hariç ${r.taranan}`);
  const l = cli('--source', SOURCE, '--vault', vault, '--limit', '5', '--dry-run');
  assert.equal(l.yeni + l.atlanan, 5);
});

test('gelen kutusu incoming → processed işlenir ve kopya kaldırılır', () => {
  const incoming = path.join(vault, 'inbox-obsidian', 'incoming');
  fs.mkdirSync(path.join(incoming, 'alt'), { recursive: true });
  fs.writeFileSync(
    path.join(incoming, 'Gelen Not.md'),
    '---\ntags: [gelen]\n---\n\n# Gelen Not\n\nAkşam rutini denemesi. [[Var Olmayan]] bağlantısı var.\n',
    'utf8'
  );
  fs.writeFileSync(path.join(incoming, 'alt', 'Ikinci.md'), '# Ikinci\n\nAnahtar: sk-or-v1-0123456789abcdef0123456789abcdef\n', 'utf8');

  const onizleme = cli('--incoming', '--vault', vault, '--dry-run');
  assert.equal(onizleme.islenen, 2);
  assert.ok(fs.existsSync(path.join(incoming, 'Gelen Not.md')), 'önizleme silmedi');

  const r = cli('--incoming', '--vault', vault);
  assert.equal(r.islenen, 2);
  assert.equal(r.hata, 0);
  const ay = new Date().toISOString().slice(0, 7);
  const processed = path.join(vault, 'inbox-obsidian', 'processed', ay);
  assert.ok(fs.existsSync(path.join(processed, 'Gelen Not.md')));
  const ikinci = fs.readFileSync(path.join(processed, 'Ikinci.md'), 'utf8');
  assert.ok(!ikinci.includes('sk-or-v1-0123'), 'gelen kutusunda da maskeleme var');
  assert.ok(!fs.existsSync(path.join(incoming, 'Gelen Not.md')), 'işlenen kopya kaldırıldı');
  assert.ok(!fs.existsSync(path.join(incoming, 'alt')), 'boşalan alt klasör temizlendi');

  // Tekrar çalıştırmak güvenli: işlenecek şey kalmadı.
  const bos = cli('--incoming', '--vault', vault);
  assert.equal(bos.islenen, 0);
});

test('--keep-incoming kopyayı bırakır', () => {
  const incoming = path.join(vault, 'inbox-obsidian', 'incoming');
  fs.mkdirSync(incoming, { recursive: true });
  fs.writeFileSync(path.join(incoming, 'Kalsin.md'), '# Kalsin\n\nDeneme.\n', 'utf8');
  cli('--incoming', '--vault', vault, '--keep-incoming');
  assert.ok(fs.existsSync(path.join(incoming, 'Kalsin.md')));
});

test('güvenlik kapıları: kaynak = hedef, uygulama klasörü, eksik yol', () => {
  assert.throws(
    () => execFileSync(process.execPath, [IMPORTER, '--source', SOURCE, '--vault', TMP, '--target', 'obsidian'], { stdio: 'pipe' }),
    /Kaynak ile hedef aynı/
  );
  assert.throws(() => execFileSync(process.execPath, [IMPORTER, '--source', ROOT, '--vault', vault], { stdio: 'pipe' }), /Uygulama klasörü/);
  assert.throws(
    () => execFileSync(process.execPath, [IMPORTER, '--source', path.join(TMP, 'yok'), '--vault', vault], { stdio: 'pipe' }),
    /Kaynak klasör bulunamadı/
  );
});

test('aktarılan notlar hafıza aramasında bulunur', () => {
  cli('--source', SOURCE, '--vault', vault);
  // Ayrı süreç: config önbelleği ve VB_CONFIG_PATH bu teste sızmasın.
  const betik = `
    const config = require(${JSON.stringify(path.join(ROOT, 'server', 'config.js'))});
    const memory = require(${JSON.stringify(path.join(ROOT, 'server', 'memory.js'))});
    config.save({ vaultPath: ${JSON.stringify(vault)}, memory: { coreNotes: ['profile/me.md'] } });
    memory.build(true);
    const q = (s) => memory.search(s, 5).map((h) => h.title);
    console.log(JSON.stringify({
      notlar: memory.stats().notes,
      hafiza: q('hafiza'),
      isinma: q('isinma sorunu'),
      kurulum: q('vulkan motoru bağlam uzunluğu'),
      klasor: q('fikirler'),
    }));
  `;
  const res = JSON.parse(
    execFileSync(process.execPath, ['-e', betik], {
      encoding: 'utf8',
      env: { ...process.env, VB_CONFIG_PATH: path.join(vault, '..', `cfg-${seq}.json`) },
    })
  );
  assert.ok(res.notlar >= 60, `kasada ${res.notlar} not indekslendi`);
  assert.ok(res.hafiza.includes('Hafıza Tasarımı'), JSON.stringify(res.hafiza));
  assert.ok(res.isinma.includes('Isınma Sorunu'), JSON.stringify(res.isinma));
  assert.ok(res.kurulum.includes('Karisik Kurulum Notu'), JSON.stringify(res.kurulum));
  assert.ok(res.klasor.some((t) => ['Akşam Rutini', 'Sesli Asistan Fikri'].includes(t)), JSON.stringify(res.klasor));
});
