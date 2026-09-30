# Hafıza: nasıl çalışır, neyi düzelttik, kasada ne yapman gerekiyor

Bu dosya hafıza sisteminin gerçek davranışını anlatır (koddan doğrulanmış), Obsidian beyninin
nasıl aranabilir hâle geldiğini ve kendi bilgisayarında atman gereken adımları listeler.

## 1. Sistem gerçekte nasıl çalışıyor

| Konu | Davranış | Kod |
|---|---|---|
| Canlı hafıza yolu | `config.json` içindeki `vaultPath` | `server/memory.js` → `roots()` |
| Çekirdek not | `memory.coreNotes` listesindeki her notun ilk `memory.coreChars` karakteri **her** mesaja eklenir | `coreContext()` |
| Soru başına not | `memory.maxHits` (varsayılan 5) | `search()` |
| Not başına metin | `memory.snippetChars` (varsayılan **400**, 700 değil) | `snippet()` |
| Yeni notlar | `memory.writeFolder` (varsayılan `inbox`). Klasörsüz verilen ad buraya düşer | `write()` |
| Sohbet kayıtları | `memory.logFolder` → `inbox/sohbet-kayitlari/YYYY-MM-DD.md` | `logExchange()` |
| Grafik | `[[bağlantı]]` hedefi bir not adı veya takma adıyla eşleşirse çizilir | `graph()` |

Aramaya **giren** şeyler (düzeltmeden sonra): dosya adı, frontmatter `title`/`aliases`,
etiketler, klasör adları, `[[bağlantı]]` hedeflerinin metni ve not gövdesi.
Aramaya **girmeyen** şeyler: YAML'ın geri kalanı, URL'ler, `%%Obsidian yorumları%%`,
`^blok-kimlikleri`, dataview blokları.

## 2. Arama neden bu kadar sık boş dönüyordu

1. **Türkçe büyük/küçük harf tuzağı.** Eski kod `toLocaleLowerCase('tr')` kullanıyordu.
   Türkçe'de `I` → `ı`, `İ` → `i`. Klavyede ASCII yazan bir soru (`hafiza`, `Istanbul`, `isik`)
   notta geçen `hafıza`, `İstanbul`, `ışık` ile **hiçbir zaman** eşleşmiyordu. Artık iki taraf da
   ASCII'ye katlanıyor: `ı ş ğ ç ö ü â î û` → `i s g c o u a i u`.
2. **Çekim eki yoktu.** Türkçe eklemeli bir dil. `projelerimi` sorgusu `proje` notunu bulmuyordu.
   Artık kaba bir kök ayırıcı var; kök de eşleşmezse sözlükte ortak ön eke bakılıyor.
3. **Uzunluk normalizasyonu yoktu.** Puan ham geçiş sayısıydı, o yüzden sohbet kayıtları gibi
   uzun ve kelime tekrarlı dosyalar kısa ve isabetli notların önüne geçiyordu. Artık BM25F
   (alan ağırlıklı, uzunluğa göre normalize) ve alan başına terim tavanı var.
4. **Metin kirliydi.** YAML frontmatter, `[[hedef|etiket]]` sözdizimi ve URL'ler indeksin içindeydi;
   `created:`, `tags:` gibi kelimeler gürültü yapıyordu. Artık ayrıştırılıp alanlara dağıtılıyor.
5. **Klasör/etiket/bağlantı aramaya girmiyordu.** Artık giriyor (ağırlıkları gövdeden yüksek).
6. **562 notluk Obsidian beyni hiç indekslenmiyordu.** Panelde `notlar: 24` görünmesinin sebebi bu.

## 3. Obsidian beyni nasıl aranabilir hâle geldi — ve neden böyle

İki yol vardı. **İkisi de yapıldı, ama önerilen birincisi:**

### A) Salt okunur ek kök (önerilen, varsayılan yol)

`memory.extraRoots` ile Obsidian klasörü, kasanın yanında **salt okunur** indekslenir.
Dosya kopyalanmaz, taşınmaz, değiştirilmez.

- **Drive'a tek bayt gitmez.** 562 dosyayı Google Drive'a kopyalamak senkron yükü, çakışma ve
  her yeniden taramada ağ üzerinden okuma demekti. Obsidian yerel diskte (`I:`), okuması hızlı.
- **Çift kayıt yok.** Obsidian'da bir notu düzelttiğinde arama da güncellenir; senkron derdi yok.
- **Canlı kasa bozulmaz.** 24 notluk kurulu beyin aynı kalır, `profile/me.md` ve `coreNotes` dokunulmaz.
- **Yazma yolu korunur.** `memory_write` hâlâ yalnızca kasaya (Drive'a) yazar; ek köke yazma
  denemesi hata döner. B.R.E.A.C.H.'in Drive'a yazma davranışı değişmedi.
- **Güvenlik:** ek köklerde `iş`, `müşteri`, `mail`, `gizli`, `fatura`, `banka`, `anahtar` gibi
  klasörler varsayılan olarak indekslenmez. Yoksa bir soru bu içeriği bulut modele taşırdı.
  Bilinçli olarak açmak istersen o kök için `includeSensitive: true`.

Anahtar kelimelerin metnin içinde olması şartı burada indeksleme anında karşılanıyor: dosya adı,
takma adlar, etiketler, klasör adları ve bağlantı hedefleri aranabilir metne ekleniyor.

### B) Kasaya içe aktarma (seçtiğin notlar için)

Kalıcı olarak Drive beynine girmesini istediğin notlar için `scripts/obsidian-import.js`.
Aktarılan notta anahtar kelimeler **dosyanın içine** yazılır (`> Anahtar kelimeler: …`), böylece
indeksleyici ne yaparsa yapsın kelimeler metinde durur. Bunu her şey için değil, gerçekten
Drive'da durması gerekenler için kullan — örneğin `--exclude` ile arşivi dışarıda bırakıp
sadece wiki ve proje notlarını aktar.

## 4. Kasada atacağın adımlar

### 4.1 Obsidian'ı aramaya bağla (ayar değişikliği)

Elle `config.json` düzenlemeyeceksin. Ya Ayarlar ⚙ › Hafıza › **Ek hafıza kökleri** kutusuna
`I:\Obsidian_Vault\Claude_Vault` yazıp kaydet, ya da şu isteği gönder:

```powershell
$body = @'
{
  "memory": {
    "extraRoots": [
      { "id": "obsidian", "label": "Obsidian beyni", "path": "I:\\Obsidian_Vault\\Claude_Vault" }
    ],
    "maxHits": 8,
    "snippetChars": 700
  }
}
'@
Invoke-RestMethod -Uri http://127.0.0.1:7777/api/config -Method Post -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body))
```

`POST /api/config` derin birleştirme yapar: göndermediğin alanlar (API anahtarları dahil) korunur.
Dikkat: `extraRoots` bir dizi, diziler **birleştirilmez, değiştirilir** — hepsini birlikte gönder.

Sonra sağ paneldeki ↻ düğmesine bas. `notlar:` sayısı 24'ten ~580'e çıkmalı ve altta
`vault: 24 · obsidian: 5xx` ayrımı görünmeli.

### 4.2 İçe aktarma (istersen)

Çift tıkla: **`hafiza-aktar.bat`** — önce önizleme gösterir, onay ister, sonra aktarır.

Elle:

```powershell
cd C:\...\vault-breach
# 1. Önizleme: hiçbir şey yazmaz
node scripts\obsidian-import.js --source "I:\Obsidian_Vault\Claude_Vault" --vault auto --dry-run
# 2. Özet doğruysa gerçek aktarım
node scripts\obsidian-import.js --source "I:\Obsidian_Vault\Claude_Vault" --vault auto
# Arşivi dışarıda bırakarak:
node scripts\obsidian-import.js --source "I:\Obsidian_Vault\Claude_Vault" --vault auto --exclude "Arsiv/**"
```

`--vault auto` kasayı `config.json`'daki `vaultPath` ve `profile\me.md` imzasından bulur
(sürücü harfi değişse de çalışır). `config.json`'dan **yalnızca** `vaultPath` okunur.

Tekrar çalıştırmak güvenli: değişmeyen notlar atlanır, kasada elle düzelttiğin notların üzerine
`--force` olmadan yazılmaz. Tüm seçenekler: `node scripts\obsidian-import.js --help`.

### 4.3 Grok'un bıraktığı gelen kutusu

`VAULT-Brain\scripts\sync-obsidian-inbox.ps1` notları `inbox-obsidian\incoming\` içine kopyalıyor
ama işleyen taraf hiç yazılmamıştı. Artık var:

```powershell
node scripts\obsidian-import.js --incoming --vault auto --dry-run
node scripts\obsidian-import.js --incoming --vault auto
```

`incoming\` içindeki her not normalize edilir, maskelenir ve
`inbox-obsidian\processed\<yıl-ay>\` altına yazılır; işlenen kopya `incoming\` içinden kaldırılır
(`--keep-incoming` ile kalır). Akşam rutini olarak Görev Zamanlayıcı'ya bu komutu koyabilirsin.

## 5. Sınırlar ve önerim

Yüzlerce not aranabilir olduğunda gerçek sınırlayıcı `maxHits` ve `snippetChars`. İkisi de artık
ayardan değiştirilebiliyor, kodda sabit sayı yok.

| Motor | maxHits | snippetChars | Neden |
|---|---|---|---|
| Bulut (OpenRouter, Gemini, Kimi) | **8** | **700** | Bağlam bol; 8 × 700 ≈ 5,6 bin karakter, çekirdek notla birlikte rahat sığar |
| Yerel LM Studio (9B, 16–32k bağlam) | 5 | 500 | Küçük modelde uzun bağlam cevabı bozar |
| Arama kalitesini ölçerken | 12 | 400 | Doğru notun listede olup olmadığını görmek için |

`profile/me.md` ~2,7 bin karakter olduğu için `coreChars: 4000` ayarı onu tam gönderiyor; not
büyürse bu sayıyı da yükselt.

Sohbet kayıtları aramayı boğarsa (uzun ve kelime tekrarlı dosyalar), silmeden aramadan çıkarabilirsin:
Ayarlar › Hafıza › **Aramadan çıkar** → `inbox/sohbet-kayitlari/**`.

## 6. Hassas veri

İçe aktarıcı ve ek kök indeksleyicisi aynı listeyi (`server/text.js` → `SENSITIVE_GLOBS`) kullanır.

- **Tümden atlanan klasör/dosya adları:** iş, work, müşteri, customer, client, cari, mail, e-posta,
  gizli, secret, private, fatura, invoice, banka, finans, muhasebe, kimlik, anahtar, şifre, parola,
  token, credential, iban.
- **Aktarımda maskelenen kalıplar** (`[gizlendi: <tür>]` ile değiştirilir): API anahtarları
  (`sk-…`, `sk-or-v1-…`, `AIza…`, `xai-…`, `gh*_…`), JWT, `Authorization/token/şifre: …` satırları,
  e-posta adresleri, telefon numaraları, IBAN, 11 haneli kimlik numarası, kart numarası,
  40+ karakterlik base64/hex dizgeler, ham posta başlıkları (`From:`, `To:`, `Subject:`, `Received:`).
- Bir notta eşikten (`--max-redactions`, varsayılan 8) fazla maskeleme gerekiyorsa not hiç aktarılmaz.
- `config.json` hiçbir zaman kopyalanmaz; yalnızca `vaultPath` alanı okunur.

## 7. Testler

```powershell
npm test
```

`node --test` ile çalışır, harici paket gerektirmez. Testler `scripts\make-fixture.js` ile sentetik
bir Obsidian vault üretir (YAML frontmatter, `[[wikilink]]`, etiket, iç içe klasör, Türkçe
karakterler, Windows'ta sorunlu dosya adları, hassas içerik örnekleri) ve indeksleme, Türkçe
eşleştirme, içe aktarma, bağlantı onarımı ile maskelemeyi bu vault üzerinde doğrular.
