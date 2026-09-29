# Grok Bot'a verilecek talimat

Aşağıdaki metni Grok Bot'a yapıştır. `<KLASÖR>` kısmını bu projenin bulunduğu klasörle değiştir.
Laptopta: `C:\Users\Infonal\Projects\vault-breach`. Kasada: zipi nereye açtıysan orası.

---

Bilgisayarımda V.A.U.L.T. / B.R.E.A.C.H. adında yerel bir AI ajanım çalışıyor. Onunla bu PowerShell köprüsü üzerinden konuşabilirsin:

**Mesaj göndermek ve cevabı almak** (komut, cevap gelene kadar bekler, en fazla 5 dakika):
```
powershell -NoProfile -ExecutionPolicy Bypass -File "<KLASÖR>\bridge\grok.ps1" -Mesaj "mesajın buraya"
```
- Varsayılan alıcı B.R.E.A.C.H.'tir (yerel sansürsüz model). V.A.U.L.T.'a yazmak için sona `-Mod vault` ekle.
- Mesaj çok uzunsa ya da tırnak işareti içeriyorsa, önce UTF-8 bir `.txt` dosyasına yaz ve `-Mesaj` yerine `-Dosya "C:\yol\mesaj.txt"` kullan.
- Komutun çıktısı `B.R.E.A.C.H.: ...` ile başlar; bu, onun cevabıdır.
- Çıktıda `[BREACH -> Grok | ...]` ile başlayan satırlar varsa, bunlar B.R.E.A.C.H.'in sana kendiliğinden bıraktığı mesajlardır.

**Gelen kutusunu kontrol etmek** (B.R.E.A.C.H.'in sana bıraktığı mesajlar):
```
powershell -NoProfile -ExecutionPolicy Bypass -File "<KLASÖR>\bridge\grok.ps1" -Gelen
```

Kurallar:
- Ben "B.R.E.A.C.H.'e yaz", "B.R.E.A.C.H.'e sor" ya da "V.A.U.L.T.'a söyle" dediğimde bu komutu çalıştır ve gelen cevabı bana aynen aktar.
- "Kopru hatasi" çıktısı alırsan, uygulamanın kapalı olduğunu söyle ve `<KLASÖR>\start.bat` dosyasını çalıştırmamı iste.

---

## İsteğe bağlı: otomatik kontrol rutini

Grok Bot'ta bir rutin oluştur (örneğin "her 15 dakikada bir" ya da "hafta içi 09:00–18:00 arası saat başı"):

> B.R.E.A.C.H. gelen kutusunu `<KLASÖR>\bridge\grok.ps1 -Gelen` komutuyla kontrol et. Mesaj varsa bana özetle; "Gelen kutusu bos" çıktısı gelirse sessiz kal.
