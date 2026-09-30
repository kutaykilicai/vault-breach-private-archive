const test = require('node:test');
const assert = require('node:assert');
const http = require('node:http');
const { Readable } = require('node:stream');

const { readBody } = require('../server/body');

const MASK = '••••••••';
const PAYLOAD = {
  vaultPath: "G:\\Drive'ım\\VAULT-Brain",
  memory: { coreNotes: ['_beyin/kimlik.md', 'çğıöşü ÇĞİÖŞÜ'] },
  providers: { kimi: { apiKey: MASK }, gemini: { apiKey: MASK } },
};

/** Gövdeyi her olası bayt sınırından ikiye bölerek okur. */
function splitAt(buf, i) {
  return Readable.from([buf.subarray(0, i), buf.subarray(i)]);
}

test('gövde her bayt sınırından bölünse de UTF-8 bozulmaz', async () => {
  const buf = Buffer.from(JSON.stringify(PAYLOAD), 'utf8');
  for (let i = 1; i < buf.length; i++) {
    const got = await readBody(splitAt(buf, i));
    assert.deepStrictEqual(got, PAYLOAD, `${i}. bayttan bölününce gövde bozuldu`);
  }
});

test('bölünmüş maske hâlâ maske olarak tanınır', async () => {
  const buf = Buffer.from(JSON.stringify({ providers: { kimi: { apiKey: MASK } } }), 'utf8');
  for (let i = 1; i < buf.length; i++) {
    const got = await readBody(splitAt(buf, i));
    assert.strictEqual(got.providers.kimi.apiKey, MASK);
  }
});

test('boş gövde boş nesne olur', async () => {
  assert.deepStrictEqual(await readBody(Readable.from([])), {});
});

test('sınırı aşan gövde reddedilir', async () => {
  const big = Readable.from([Buffer.alloc(64), Buffer.alloc(64)]);
  await assert.rejects(() => readBody(big, 100), /çok büyük/);
});

test('geçersiz JSON hata verir', async () => {
  await assert.rejects(() => readBody(Readable.from([Buffer.from('{bozuk')])));
});

test('gerçek HTTP isteğinde Türkçe metin ve maske korunur', async () => {
  const server = http.createServer(async (req, res) => {
    const body = await readBody(req).catch((e) => ({ error: e.message }));
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(body));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const r = await fetch(`http://127.0.0.1:${server.address().port}/api/config`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(PAYLOAD),
    });
    assert.deepStrictEqual(await r.json(), PAYLOAD);
  } finally {
    server.close();
  }
});
