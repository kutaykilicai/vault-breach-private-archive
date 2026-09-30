#!/usr/bin/env node
// Sentetik Obsidian vault üreteci. Gerçek beyin (I:\Obsidian_Vault) bulut makinede olmadığı için
// indeksleme, eşleştirme ve içe aktarma bu sahte vault üzerinde doğrulanır.
//
//   node scripts/make-fixture.js <hedef-klasor> [--notes 120]
//
// Üretilenler: YAML frontmatter, [[wikilink]]'ler, satır içi #etiketler, iç içe klasörler,
// Türkçe karakterli metin (ı/İ/ş/ğ/ç/ö/ü), Windows'ta sorunlu dosya adları, hassas içerik örnekleri.

const fs = require('fs');
const path = require('path');

const KONULAR = [
  {
    klasor: 'Projeler',
    ad: 'VAULT-BREACH Mimarisi',
    etiketler: ['proje', 'yazılım'],
    govde:
      'Yerel ajan arayüzü. Node ile yazıldı, harici paket yok. Hafıza Obsidian kasasında duruyor.\n\n' +
      'İlgili: [[Hafıza Tasarımı]], [[Kasa Donanımı]]\n' +
      'Klasör önekli ve küçük harfli bağlantı: [[projeler/hafıza tasarımı]]\n' +
      'Takma ad üzerinden bağlantı: [[bellek tasarımı|belleğe bak]]\n' +
      'Windows’ta geçersiz karakterli hedefe bağlantı: [[Rapor: 2026 Q1]]\n' +
      'Başlığa bağlantı: [[Isınma Sorunu#Fan]]\n' +
      'Gömülü dosya: ![[sema.png]]\n' +
      '%%Bu bir Obsidian yorumu, dışa çıkmamalı.%%\n' +
      '```dataview\nLIST FROM #proje\n```\n' +
      'Blok kimliği testi. ^abc12345',
  },
  { klasor: 'Projeler', ad: 'Hafıza Tasarımı', etiketler: ['proje', 'hafıza'], govde: 'Hafıza aramasının Türkçe çekim eklerini tolere etmesi gerekiyor. Sorgu "hafızamda ne var" olduğunda "hafıza" notları bulunmalı.\n\nBağlantı: [[VAULT-BREACH Mimarisi|mimari]]' },
  { klasor: 'Donanım', ad: 'Kasa Donanımı', etiketler: ['donanım'], govde: 'Ev kasası: Ryzen 7 5700X3D, 32 GB RAM, RX 6700 XT ekran kartı. LM Studio Vulkan motoruyla çalışıyor.\n\nIşık ayarları ve ısınma sorunu ayrı notta: [[Isınma Sorunu]]' },
  { klasor: 'Donanım', ad: 'Isınma Sorunu', etiketler: ['donanım', 'sorun'], govde: 'Yaz aylarında kasa ısınıyor. Işıklar açıkken sıcaklık 78 dereceye çıkıyor. Fan eğrisi düzeltildi.' },
  { klasor: 'Notlar/Günlük', ad: '2026-04-11 Cuma', etiketler: ['günlük'], govde: 'İstanbul’a gittim. Öğleden sonra Şişli’de toplantı vardı. Akşam çığır açan bir fikir geldi: ajan kendi kodunu düzeltebilir.' },
  { klasor: 'Notlar/Günlük', ad: '2026-04-12 Cumartesi', etiketler: ['günlük'], govde: 'Uğraştığım şey: Google Drive üzerindeki kasa çok yavaş taranıyor. Çözüm: değişmeyen notları önbellekte tut.' },
  { klasor: 'Wiki', ad: 'Türkçe Arama Notları', etiketler: ['bilgi', 'dil'], govde: 'Türkçe eklemeli bir dildir. "çiğ", "şığ", "ığdır" gibi kelimeler ASCII katlamada i/s/g/c/o/u’ya iner. Büyük I küçüldüğünde ı olur; bu yüzden ASCII katlama şart.' },
  { klasor: 'Wiki', ad: 'Obsidian Kullanımı', etiketler: ['bilgi', 'obsidian'], govde: 'Klasör adları ve etiketler aramayı etkilemez; arama yalnızca dosya içeriğine bakar. Bu yüzden anahtar kelimeler metnin içinde geçmelidir.\n\nGrafik için [[Türkçe Arama Notları]] bağlantısı gerekir.' },
  { klasor: 'Fikirler', ad: 'Sesli Asistan Fikri', etiketler: ['fikir'], govde: 'Mikrofonla konuşup ajana iş verme. Tarayıcı konuşma tanıma API’si yeterli olabilir. Türkçe desteği test edilmeli.' },
  {
    // Hassas klasörde DEĞİL: aktarılmalı ama içindeki sırlar maskelenmeli.
    klasor: 'Notlar',
    ad: 'Karisik Kurulum Notu',
    etiketler: ['kurulum'],
    govde:
      'LM Studio kurulumu tamamlandı. Sunucu http://localhost:1234 üzerinde.\n' +
      'Deneme anahtarı: sk-or-v1-abc123def456abc123def456abc123def456abc123def456\n' +
      'Bana ulaşmak için ornek.kisi@ornek-alan.com yazabilirsin.\n' +
      'Telefon: 0532 444 55 66\n' +
      'Kalan adımlar: Vulkan motorunu seç, bağlam uzunluğunu 32768 yap.',
  },
  { klasor: 'Fikirler', ad: 'Akşam Rutini', etiketler: ['fikir', 'rutin'], govde: 'Her akşam gelen kutusundaki notları işleyip arşive taşıyan bir betik. İşlenen dosyalar processed klasörüne gider.' },
];

const HASSAS = [
  {
    klasor: 'Is',
    ad: 'Musteri Listesi',
    etiketler: ['iş'],
    govde: 'Müşteri: Örnek Sanayi A.Ş. — yetkili ahmet.yilmaz@ornek-sanayi.com, telefon 0532 111 22 33.\nIBAN TR120006200000000006297561. Sipariş tutarı 48.000 TL.',
  },
  {
    klasor: 'Gizli',
    ad: 'Anahtarlar',
    etiketler: ['gizli'],
    govde: 'OpenRouter: sk-or-v1-0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef\nGemini: AIzaSyD-ExampleExampleExampleExampleExample\nAuthorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjMifQ.abcdefghijklmnop',
  },
  {
    klasor: 'Mail',
    ad: 'Gelen Kutusu Dokumu',
    etiketler: ['mail'],
    govde: 'From: patron@sirket.com\nTo: ben@ornek.com\nSubject: Acil teklif\nReceived: from mail.sirket.com\n\nMerhaba, teklifi bugün göndermeniz gerekiyor.',
  },
];

const ZOR_ADLAR = ['Rapor: 2026 Q1', 'Plan | Taslak', 'Ödeme? (belirsiz)', 'CON', 'Uzun Not ' + 'x'.repeat(90)];

function frontmatter(ad, etiketler, aliases) {
  const satirlar = ['---', `title: ${ad}`, `tags: [${etiketler.join(', ')}]`];
  if (aliases?.length) {
    satirlar.push('aliases:');
    for (const a of aliases) satirlar.push(`  - ${a}`);
  }
  satirlar.push(`created: 2026-04-0${(ad.length % 9) + 1}`, '---');
  return satirlar.join('\n');
}

function yaz(kok, klasor, ad, icerik) {
  const dir = path.join(kok, klasor);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${ad}.md`), icerik, 'utf8');
}

function main() {
  const args = process.argv.slice(2);
  const hedef = args.find((a) => !a.startsWith('--'));
  if (!hedef) {
    console.error('Kullanım: node scripts/make-fixture.js <hedef-klasor> [--notes 120]');
    process.exit(2);
  }
  const istenen = Number((args.find((a) => a.startsWith('--notes')) || '').split(/[= ]/)[1] || args[args.indexOf('--notes') + 1] || 60);
  const kok = path.resolve(hedef);
  fs.rmSync(kok, { recursive: true, force: true });
  fs.mkdirSync(kok, { recursive: true });

  // Obsidian'ın kendi klasörü: indeks bunu atlamalı.
  fs.mkdirSync(path.join(kok, '.obsidian'), { recursive: true });
  fs.writeFileSync(path.join(kok, '.obsidian', 'app.json'), '{}', 'utf8');
  yaz(kok, '.obsidian', 'gorulmemeli', '# Bu not indekslenmemeli\nhafıza gizli anahtar\n');

  let sayi = 0;
  for (const k of KONULAR) {
    const aliases = k.ad === 'Hafıza Tasarımı' ? ['bellek tasarımı', 'memory design'] : [];
    const govde = `${frontmatter(k.ad, k.etiketler, aliases)}\n\n# ${k.ad}\n\n${k.govde}\n\n#${k.etiketler[0]} #vault-beyin\n`;
    yaz(kok, k.klasor, k.ad, govde);
    sayi++;
  }
  for (const h of HASSAS) {
    yaz(kok, h.klasor, h.ad, `${frontmatter(h.ad, h.etiketler)}\n\n# ${h.ad}\n\n${h.govde}\n`);
    sayi++;
  }
  for (const ad of ZOR_ADLAR) {
    yaz(kok, 'Karisik', ad.replace(/[<>:"/\\|?*]/g, '-'), `${frontmatter(ad, ['karışık'])}\n\n# ${ad}\n\nWindows'ta sorunlu dosya adı testi. Özgün ad: ${ad}\n\nKırık bağlantı: [[Var Olmayan Not]]\n`);
    sayi++;
  }
  // Kalanı doldurma notu: hacim ve uzunluk normalizasyonu testi için.
  for (let i = sayi; i < istenen; i++) {
    const ad = `Dolgu Notu ${String(i).padStart(3, '0')}`;
    const uzun = i % 7 === 0 ? `\n\n${'Uzun gövde metni doldurma cümlesi. '.repeat(400)}` : '';
    yaz(
      kok,
      `Arsiv/${2020 + (i % 6)}`,
      ad,
      `${frontmatter(ad, ['arşiv'])}\n\n# ${ad}\n\nGenel doldurma metni, çeşitli kelimeler: proje, donanım, fikir, günlük.${uzun}\n`
    );
  }

  const toplam = fs.readdirSync(kok, { recursive: true }).filter((f) => String(f).endsWith('.md')).length;
  console.log(`Sahte Obsidian vault hazır: ${kok} (${toplam} .md dosyası)`);
}

main();
