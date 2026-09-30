// Türkçe duyarlı metin analizi + Obsidian sözdizimi temizliği.
// Hem hafıza indeksi (server/memory.js) hem içe aktarma betikleri (scripts/) bunu kullanır,
// böylece arama ile aktarma aynı normalizasyonu görür.

// Türkçe'de "I" küçük harfi "ı", "İ" küçük harfi "i" olur. Kullanıcı klavyede çoğu zaman
// ASCII yazar ("hafiza", "Istanbul"), notta ise "hafıza"/"İstanbul" geçer. İki taraf da
// ASCII'ye katlanmazsa hiçbir zaman eşleşmezler. Tablo tek karakter → tek karakter olduğu
// için katlanmış metnin uzunluğu korunur; snippet konumları kaymaz.
const FOLD = {
  ı: 'i', ş: 's', ğ: 'g', ç: 'c', ö: 'o', ü: 'u',
  â: 'a', ä: 'a', à: 'a', á: 'a', å: 'a', ã: 'a',
  ê: 'e', ë: 'e', è: 'e', é: 'e',
  î: 'i', ï: 'i', ì: 'i', í: 'i',
  ô: 'o', ò: 'o', ó: 'o', õ: 'o', ø: 'o',
  û: 'u', ù: 'u', ú: 'u',
  ñ: 'n', ý: 'y', ÿ: 'y', ż: 'z', ź: 'z', ć: 'c', ł: 'l', ń: 'n', ś: 's',
  '’': "'", '‘': "'", '“': '"', '”': '"', '–': '-', '—': '-', '\u00a0': ' ',
};

/** Aramada kullanılan kanonik biçim: Türkçe küçük harf + ASCII katlama. Uzunluk korunur. */
function fold(s) {
  let out = '';
  for (const ch of String(s ?? '').toLocaleLowerCase('tr')) out += FOLD[ch] || ch;
  return out;
}

// Katlanmış (ASCII) hâlleriyle yazılmış durak kelimeler.
const STOPWORDS = new Set(
  (
    'bir bu su ve veya ile icin gibi ama fakat ancak cok daha az mi mu de da ki ne nasil neden niye ' +
    'kim kimin hangi nerede nereye nereden kadar sonra once simdi zaman olan olarak olur oldu olacak ' +
    'ben sen biz siz onlar bana beni benim sana seni senin bize bizi bizim size sizi sizin ona onu onun ' +
    'bunu sunu bunlar sunlar var yok degil ise ise ya yani hem her hep biraz tum butun diye kere defa ' +
    'the and for with that this what how are you can was were has have had not but from they them their ' +
    'lutfen tamam evet hayir belki acaba yine hala zaten sadece ayni baska diger'
  ).split(/\s+/)
);

// Türkçe eklemeli bir dil: "hafıza", "hafızamda", "hafızasını" hep aynı kökü taşır.
// Ek atomlarını (katlanmış hâlleriyle) uzundan kısaya, birkaç geçişte soyuyoruz.
// Amaç dilbilimsel doğruluk değil; sorgu ile notun aynı kökte buluşması.
const SUFFIXES = [
  'iyor', 'uyor', 'ecek', 'acak', 'erek', 'arak', 'mesi', 'masi', 'ligi', 'lugi',
  'ler', 'lar', 'den', 'dan', 'ten', 'tan', 'nin', 'nun', 'lik', 'luk', 'siz', 'suz',
  'mek', 'mak', 'mis', 'mus', 'yor', 'ken', 'dir', 'tir', 'das', 'tas', 'imiz', 'umuz',
  'iniz', 'unuz', 'leri', 'lari', 'ci', 'cu', 'ce', 'ca', 'li', 'lu', 'si', 'su',
  'de', 'da', 'te', 'ta', 'in', 'un', 'im', 'um', 'ye', 'ya', 'yi', 'yu', 'la', 'le',
  'ni', 'nu', 'na', 'ne', 'me', 'ma', 'di', 'du', 'ti', 'tu', 'se', 'sa',
  'e', 'a', 'i', 'u', 'm', 'n',
].sort((a, b) => b.length - a.length);

const MIN_STEM = 4;

/** Katlanmış bir kelimenin kaba kökü. Ek soyma kökü 4 harfin altına düşürmez. */
function stem(token) {
  let t = token;
  for (let pass = 0; pass < 3; pass++) {
    const hit = SUFFIXES.find((s) => t.length - s.length >= MIN_STEM && t.endsWith(s));
    if (!hit) break;
    t = t.slice(0, -hit.length);
  }
  return t;
}

/** Metni katlanmış kelimelere böler. Durak kelimeler ve çok kısa parçalar atılır. */
function tokenize(s, minChars = 3) {
  const out = [];
  for (const raw of fold(s).split(/[^\p{L}\p{N}_]+/u)) {
    if (raw.length < minChars || raw.length > 40) continue;
    if (STOPWORDS.has(raw)) continue;
    if (/^\d+$/.test(raw) && raw.length < 4) continue;
    out.push(raw);
  }
  return out;
}

/** Sorgu kelimeleri: tekilleştirilmiş { raw, stem } çiftleri. */
function queryTerms(query, minChars = 3) {
  const seen = new Set();
  const terms = [];
  for (const raw of tokenize(query, minChars)) {
    if (seen.has(raw)) continue;
    seen.add(raw);
    terms.push({ raw, stem: stem(raw) });
  }
  return terms;
}

// ---------- Obsidian / Markdown ----------

const FM_RE = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/;

/**
 * YAML frontmatter'ı ayırır. Tam bir YAML ayrıştırıcı değil: bu vault'larda geçen
 * `anahtar: değer`, `anahtar: [a, b]` ve `- madde` listelerini anlar, gerisini düz metin bırakır.
 */
function parseFrontmatter(raw) {
  const m = FM_RE.exec(raw);
  if (!m) return { meta: {}, body: raw.replace(/^\uFEFF/, ''), frontmatter: '' };
  const meta = {};
  let key = null;
  for (const line of m[1].split(/\r?\n/)) {
    const item = /^\s*-\s+(.*)$/.exec(line);
    if (item && key) {
      const v = unquote(item[1]);
      if (v) (meta[key] = Array.isArray(meta[key]) ? meta[key] : []).push(v);
      continue;
    }
    const kv = /^([A-Za-z0-9_\-. ]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    key = kv[1].trim().toLowerCase();
    const rest = kv[2].trim();
    if (!rest) meta[key] = [];
    else if (/^\[.*\]$/.test(rest)) meta[key] = rest.slice(1, -1).split(',').map(unquote).filter(Boolean);
    else meta[key] = unquote(rest);
  }
  return { meta, body: raw.slice(m[0].length), frontmatter: m[1] };
}

function unquote(s) {
  return String(s).trim().replace(/^["']|["']$/g, '').trim();
}

function metaList(meta, ...keys) {
  const out = [];
  for (const k of keys) {
    const v = meta[k];
    if (!v) continue;
    for (const item of Array.isArray(v) ? v : String(v).split(',')) {
      const t = unquote(item).replace(/^#/, '');
      if (t) out.push(t);
    }
  }
  return [...new Set(out)];
}

const LINK_RE = /!?\[\[([^\]|#^]+)((?:[#^][^\]|]*)?)(?:\|([^\]]*))?\]\]/g;

/** Metindeki [[wikilink]]'leri çıkarır: { target, heading, label, raw }. */
function parseLinks(text) {
  const out = [];
  LINK_RE.lastIndex = 0;
  let m;
  while ((m = LINK_RE.exec(text))) {
    const target = m[1].trim();
    if (!target) continue;
    out.push({ target, heading: (m[2] || '').trim(), label: (m[3] || '').trim(), raw: m[0] });
  }
  return out;
}

/** `#etiket` biçimindeki satır içi etiketler (kod bloğu ve başlıklar hariç). */
function parseInlineTags(body) {
  const out = new Set();
  const clean = body.replace(/```[\s\S]*?```/g, ' ').replace(/`[^`]*`/g, ' ');
  for (const line of clean.split(/\r?\n/)) {
    if (/^\s*#{1,6}\s/.test(line)) continue;
    for (const m of line.matchAll(/(^|[\s(\[])#([\p{L}\p{N}_\-/]{2,60})/gu)) out.add(m[2]);
  }
  return [...out];
}

/**
 * Notu aranabilir/okunabilir düz metne çevirir. Amaç: kelimeleri korumak, sözdizimini atmak.
 * `[[hedef|etiket]]` → "hedef etiket", `#etiket` → "etiket", `[metin](url)` → "metin".
 */
function cleanText(body) {
  return String(body ?? '')
    .replace(/%%[\s\S]*?%%/g, ' ')
    .replace(/```(?:dataview|dataviewjs|query|tasks)[\s\S]*?(?:```|$)/gi, ' ')
    .replace(/(?:^|\s)\^[A-Za-z0-9-]{4,}\s*$/gm, ' ')
    .replace(/```[\s\S]*?(?:```|$)/g, (b) => ` ${b.replace(/```[^\n]*/g, ' ')} `)
    .replace(/!?\[\[([^\]|#^]+)(?:[#^][^\]|]*)?(?:\|([^\]]*))?\]\]/g, (_, t, l) => ` ${t.split('/').pop()} ${l || ''} `)
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, ' $1 ')
    .replace(/<[^>\n]{1,200}>/g, ' ')
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/^\s{0,3}>+\s?/gm, '')
    .replace(/^\s{0,3}#{1,6}\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+\[[ xX]\]\s+/gm, '')
    .replace(/^\s{0,3}[-*+]\s+/gm, '')
    .replace(/^\s{0,3}\|/gm, ' ')
    .replace(/^\s{0,3}(?:-{3,}|\*{3,}|_{3,})\s*$/gm, '')
    .replace(/[*_~`]{1,3}/g, '')
    .replace(/(^|[\s(\[])#([\p{L}\p{N}_\-/]{2,60})/gu, '$1$2')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Bir notu dosya adı + frontmatter + gövdeden alan alan çözümler. */
function analyzeNote(fileName, raw) {
  const { meta, body } = parseFrontmatter(raw);
  const aliases = metaList(meta, 'aliases', 'alias', 'takma');
  const tags = [...new Set([...metaList(meta, 'tags', 'tag', 'etiketler', 'etiket'), ...parseInlineTags(body)])];
  const title = unquote(meta.title || meta.baslik || '') || fileName;
  return { meta, body, title, aliases, tags, links: parseLinks(raw), plain: cleanText(body) };
}

// ---------- basit glob ----------

/** `inbox/**`, `*.excalidraw.md`, `_arsiv/*` gibi kalıplar. `/` ayırıcıdır, eşleşme katlanmış yapılır. */
function globToRe(pattern) {
  let re = '';
  const p = fold(pattern).replace(/\\/g, '/');
  for (let i = 0; i < p.length; i++) {
    const c = p[i];
    if (c === '*') {
      if (p[i + 1] === '*') {
        re += p[i + 2] === '/' ? '(?:.*/)?' : '.*';
        i += p[i + 2] === '/' ? 2 : 1;
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

function matchesAny(relPath, patterns) {
  if (!patterns?.length) return false;
  const p = fold(relPath).replace(/\\/g, '/');
  return patterns.some((pat) => {
    try {
      return globToRe(pat).test(p);
    } catch {
      return false;
    }
  });
}

// Hassas kabul edilen yollar. fold() ı→i, ş→s, ü→u çevirdiği için "İş", "iş", "Is" hepsi
// "is" kalıbına düşer. Hem içe aktarıcı hem de salt okunur ek kökler bu listeyi kullanır:
// ek kökler ham Obsidian klasörleri olduğu için içlerindeki iş/müşteri/mail notları
// aranabilir olmamalı — yoksa bir sorgu bu içeriği bulut modele gönderir.
const SENSITIVE_GLOBS = [
  '**/is/**', '**/isler/**', '**/work/**', '**/isyeri/**',
  '**/musteri*/**', '**/customer*/**', '**/client*/**', '**/cari*/**',
  '**/mail*/**', '**/e-posta*/**', '**/eposta*/**', '**/email*/**', '**/inbox-mail*/**',
  '**/gizli*/**', '**/secret*/**', '**/private*/**', '**/ozel-gizli*/**',
  '**/fatura*/**', '**/invoice*/**', '**/banka*/**', '**/finans*/**', '**/muhasebe*/**',
  '**/kimlik*/**', '**/anahtar*/**', '**/credential*/**', '**/keys/**', '**/vault-keys/**',
  '**/*anahtar*.md', '**/*sifre*.md', '**/*parola*.md', '**/*password*.md', '**/*token*.md',
  '**/*api-key*.md', '**/*apikey*.md', '**/*credential*.md', '**/*musteri*.md', '**/*fatura*.md',
  '**/*iban*.md', '**/*mail-dokum*.md', '**/*gizli*.md',
];

module.exports = {
  fold,
  stem,
  SENSITIVE_GLOBS,
  tokenize,
  queryTerms,
  cleanText,
  parseFrontmatter,
  parseLinks,
  parseInlineTags,
  analyzeNote,
  metaList,
  matchesAny,
  STOPWORDS,
};
