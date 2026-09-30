const MAX_BODY = 40 * 1024 * 1024;

/**
 * İstek gövdesini JSON olarak okur.
 * Parçalar tek tek çözülmez: iki TCP parçasına bölünen çok baytlı bir UTF-8 karakteri
 * (Türkçe harfler, anahtar maskesindeki •) aksi halde U+FFFD'ye dönüşüp veriyi bozar.
 */
function readBody(req, max = MAX_BODY) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > max) return reject(new Error('İstek çok büyük'));
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8');
        resolve(text ? JSON.parse(text) : {});
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

module.exports = { readBody, MAX_BODY };
