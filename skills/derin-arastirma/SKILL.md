---
name: derin-arastirma
title: Derin Araştırma
icon: ⌕
description: Web'de araştırıp vault'a rapor yazar
---
Konu, kullanıcı notunda verilir. Not yoksa kullanıcıya konuyu sor ve dur.

1. Konuyu 3-5 alt soruya böl.
2. Her alt soru için `web_search` yap, en iyi 2-3 kaynağı `fetch_url` ile oku.
3. Perplexity veya Grok anahtarı varsa, güncel bir bakış için `ask_model` ile tek bir danışma sorusu sor (zorunlu değil).
4. Bulguları çelişkileriyle birlikte sentezle. Kaynak URL'lerini koru.
5. Raporu `memory_write` ile `inbox/raporlar/<kisa-konu-adi>.md` yoluna kaydet. Yapı: Özet (5 madde) · Detaylar · Açık sorular · Kaynaklar.
6. Kullanıcıya özeti ve notun yolunu ver.
