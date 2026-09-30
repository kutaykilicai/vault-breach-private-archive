(() => {
  const $ = (s) => document.querySelector(s);
  const el = (tag, cls, html) => {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html !== undefined) e.innerHTML = html;
    return e;
  };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

  const PERSONA = {
    vault: { name: 'V.A.U.L.T.', full: 'Virtual Assistant for Universal & Local Tasks' },
    breach: { name: 'B.R.E.A.C.H.', full: 'Bypassed Reactive Entity for Autonomous Cognitive Heuristics' },
  };
  const STATE_LABEL = { waiting: 'working' };

  let mode = localStorage.getItem('vb.mode') === 'breach' ? 'breach' : 'vault';
  let histories = { vault: [], breach: [] };
  try {
    histories = { ...histories, ...JSON.parse(localStorage.getItem('vb.histories') || '{}') };
  } catch { /* bozuk kayıt */ }
  let status = null;
  let busy = null;

  const chat = $('#chat');
  const input = $('#input');

  // ---------- yardımcılar ----------
  function saveHistories() {
    for (const k of Object.keys(histories)) histories[k] = histories[k].slice(-200);
    try {
      localStorage.setItem('vb.histories', JSON.stringify(histories));
    } catch {
      for (const k of Object.keys(histories)) histories[k] = histories[k].slice(-40);
      try { localStorage.setItem('vb.histories', JSON.stringify(histories)); } catch { /* depolama dolu */ }
    }
  }

  function accentRgb() {
    return getComputedStyle(document.body).getPropertyValue('--accent-rgb').trim();
  }

  function md(src) {
    let think = '';
    src = String(src || '').replace(/<think>([\s\S]*?)(<\/think>|$)/g, (_, t) => {
      think += t;
      return '';
    });
    const blocks = [];
    let s = esc(src.trim());
    s = s.replace(/```[\w-]*\n?([\s\S]*?)(```|$)/g, (_, code) => {
      blocks.push(`<pre><code>${code.replace(/\n$/, '')}</code></pre>`);
      return `\u0000${blocks.length - 1}\u0000`;
    });
    s = s
      .replace(/`([^`\n]+)`/g, '<code>$1</code>')
      .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
      .replace(/(^|[^*])\*([^*\n]+)\*/g, '$1<i>$2</i>')
      .replace(/\[\[([^\]]+)\]\]/g, '<span class="wl">$1</span>')
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>')
      .replace(/(^|\s)(https?:\/\/[^\s<]+)/g, '$1<a href="$2" target="_blank" rel="noopener">$2</a>');

    const out = [];
    let list = null;
    let para = [];
    let table = null;
    const cells = (row) => row.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
    const flushTable = () => {
      if (!table) return;
      const [head, ...body] = table;
      out.push(`<table><thead><tr>${cells(head).map((c) => `<th>${c}</th>`).join('')}</tr></thead><tbody>${body.map((r) => `<tr>${cells(r).map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`);
      table = null;
    };
    const flushPara = () => {
      if (para.length) out.push(`<p>${para.join('<br>')}</p>`);
      para = [];
    };
    const flushList = () => {
      if (list) out.push(`<${list.tag}>${list.items.map((i) => `<li>${i}</li>`).join('')}</${list.tag}>`);
      list = null;
    };
    for (const line of s.split('\n')) {
      let m;
      if (/^\s*\|.*\|\s*$/.test(line)) {
        flushPara();
        flushList();
        if (!/^\s*\|?[\s:|-]+\|?\s*$/.test(line) || !table) (table ||= []).push(line);
        continue;
      }
      flushTable();
      if (/^\u0000\d+\u0000$/.test(line.trim())) {
        flushPara();
        flushList();
        out.push(line.trim());
      } else if ((m = /^(#{1,4})\s+(.*)$/.exec(line))) {
        flushPara();
        flushList();
        out.push(`<h${m[1].length + 1}>${m[2]}</h${m[1].length + 1}>`);
      } else if ((m = /^\s*[-*•]\s+(.*)$/.exec(line)) || (m = /^\s*\d+[.)]\s+(.*)$/.exec(line))) {
        flushPara();
        const tag = /^\s*\d/.test(line) ? 'ol' : 'ul';
        if (!list || list.tag !== tag) {
          flushList();
          list = { tag, items: [] };
        }
        list.items.push(m[1]);
      } else if (!line.trim()) {
        flushPara();
        flushList();
      } else {
        flushList();
        para.push(line);
      }
    }
    flushPara();
    flushList();
    flushTable();
    let html = out.join('').replace(/\u0000(\d+)\u0000/g, (_, i) => blocks[i]);
    if (think.trim()) html = `<details class="think"><summary>◇ düşünce süreci</summary><div>${esc(think.trim())}</div></details>` + html;
    return html;
  }

  function scrollDown() {
    chat.scrollTop = chat.scrollHeight;
  }

  function setOrbState(s) {
    window.Orb.setState(s);
    const shown = STATE_LABEL[s] || s;
    document.querySelectorAll('#orbStates span').forEach((x) => x.classList.toggle('on', x.dataset.s === shown));
  }

  function activity(text, tag = '›') {
    const box = $('#activity');
    if (box.querySelector('.muted')) box.innerHTML = '';
    const t = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    box.prepend(el('div', 'a', `<span class="t">${t}</span><span>${tag} ${text}</span>`));
    while (box.children.length > 60) box.lastChild.remove();
  }

  // ---------- mod ----------
  function applyMode(next, animate) {
    mode = next;
    localStorage.setItem('vb.mode', mode);
    document.body.dataset.mode = mode;
    const p = PERSONA[mode];
    $('#brandName').textContent = p.name;
    $('#brandFull').textContent = p.full;
    $('#orbTitle').textContent = p.name;
    document.title = p.name;
    requestAnimationFrame(() => {
      const c = accentRgb();
      window.MemGraph.setColor(c);
      window.Orb.setColor(c);
    });
    if (animate) {
      const fx = $('#breachFx');
      fx.classList.remove('go');
      void fx.offsetWidth;
      fx.classList.add('go');
      document.body.classList.add('glitch');
      setTimeout(() => document.body.classList.remove('glitch'), 600);
      activity(mode === 'breach' ? '<b>B.R.E.A.C.H.</b> protokolü aktif — filtresiz yerel motor' : '<b>V.A.U.L.T.</b> moduna dönüldü', '⚡');
    }
    updateEngineChip();
    renderChat();
  }

  function updateEngineChip(live) {
    const cfg = status?.config;
    if (!cfg) return;
    const e = cfg.modes[mode];
    const model = e.model || cfg.providers[e.provider]?.defaultModel;
    const label = live || `${cfg.providers[e.provider]?.label || e.provider}${model ? ` · ${model}` : ''}`;
    $('#engineChip').textContent = `motor: ${label}`;
    $('#engineChip').title = label;
  }

  // ---------- sohbet görüntüleme ----------
  function botBubble() {
    const b = el('div', 'msg bot');
    b.appendChild(el('div', 'who', PERSONA[mode].name));
    const body = el('div', 'body');
    b.appendChild(body);
    chat.appendChild(b);
    return { root: b, body, text: '', reasoning: '' };
  }

  function paintBubble(bub, streaming) {
    let html = md(bub.text);
    if (bub.reasoning && !bub.text.includes('<think>')) {
      html = `<details class="think"${streaming && !bub.text ? ' open' : ''}><summary>◇ düşünce süreci</summary><div>${esc(bub.reasoning)}</div></details>` + html;
    }
    bub.body.innerHTML = html || (streaming ? '' : '<span class="muted">(boş yanıt)</span>');
    bub.body.classList.toggle('cursor', Boolean(streaming));
  }

  function toolCard(id, name, args, risk) {
    const d = el('details', `tool ${risk === 'risky' ? 'risky' : ''}`);
    d.dataset.id = id;
    const argText = typeof args === 'string' ? args : JSON.stringify(args);
    d.innerHTML = `<summary><span class="tst">⟳</span><span class="tname">${esc(name)}</span><span class="targ">${esc(argText)}</span></summary><pre class="tout">${esc(argText)}</pre>`;
    chat.appendChild(d);
    return d;
  }

  function finishToolCard(card, output, ok) {
    if (!card) return;
    card.querySelector('.tst').textContent = ok ? '✓' : '✕';
    card.querySelector('.tout').textContent = output;
    card.querySelector('.approval')?.remove();
  }

  function renderChat() {
    chat.innerHTML = '';
    const h = histories[mode];
    document.body.classList.toggle('has-chat', h.length > 0);
    const cards = new Map();
    for (const m of h) {
      if (m.role === 'user') {
        chat.appendChild(userBubble(m.display || m.content, m.from, m.atts));
      } else if (m.role === 'assistant') {
        if (m.content) {
          const b = botBubble();
          b.text = m.content;
          paintBubble(b, false);
        }
        for (const tc of m.tool_calls || []) {
          let args = tc.function.arguments;
          try { args = JSON.parse(args); } catch { /* ham göster */ }
          cards.set(tc.id, toolCard(tc.id, tc.function.name, args));
        }
      } else if (m.role === 'tool') {
        const out = String(m.content || '');
        finishToolCard(cards.get(m.tool_call_id), out.slice(0, 2000), !out.startsWith('Hata') && !out.includes('REDDETTİ'));
      } else if (m.role === 'error') {
        chat.appendChild(el('div', 'msg bot error', esc(m.content)));
      }
    }
    scrollDown();
  }

  // ---------- gönderme / akış ----------
  async function send(text, { tier, display, bridge } = {}) {
    text = text.trim();
    const files = bridge ? [] : attachments.splice(0);
    if ((!text && !files.length) || busy) {
      attachments.unshift(...files);
      return;
    }
    renderAttachments();
    let atts = null;
    if (files.length) {
      $('#sendBtn').textContent = 'Yükleniyor…';
      try {
        atts = await Promise.all(files.map(uploadAttachment));
      } catch (e) {
        activity(`dosya yüklenemedi: ${esc(e.message)}`, '!');
        attachments.unshift(...files);
        renderAttachments();
        $('#sendBtn').textContent = 'Gönder';
        return;
      }
      $('#sendBtn').textContent = 'Gönder';
      if (!text) text = atts.length > 1 ? 'Ekteki dosyalara bak.' : 'Ekteki dosyaya bak.';
      display = display || text;
      text += attachmentBlock(atts);
      if (!tier && !$('#tierSel').value && atts.some((a) => a.inline == null)) tier = '3';
    }
    const h = histories[mode];
    const sendMode = mode;
    const attNames = atts?.map((a) => a.name);
    h.push({ role: 'user', content: text, ...(display ? { display } : {}), ...(bridge ? { from: bridge.label } : {}), ...(attNames ? { atts: attNames } : {}) });
    saveHistories();
    document.body.classList.add('has-chat');
    chat.appendChild(userBubble(display || text, bridge?.label, attNames));
    scrollDown();
    input.value = '';
    autoGrow();

    const controller = new AbortController();
    busy = controller;
    const sendBtn = $('#sendBtn');
    sendBtn.textContent = 'Durdur';
    sendBtn.classList.add('stop');
    setOrbState('thinking');

    let bubble = null;
    const cards = new Map();
    let finalText = '';
    let errorMsg = null;
    let gotDone = false;

    const handlers = {
      route(d) {
        const box = $('#routeLog');
        if (box.querySelector('.muted')) box.innerHTML = '';
        const src = d.source === 'jev' ? '<span class="src jev">JEV</span>' : '<span class="src">YEREL</span>';
        const ms = d.ms < 1 ? '<1ms' : d.ms < 1000 ? `${d.ms.toFixed(0)}ms` : `${(d.ms / 1000).toFixed(1)}s`;
        box.prepend(el('div', 'r', `<span class="tier">T${d.tier}</span>${src}<span class="why" title="${esc(d.reason)}">${esc(d.reason)}</span><span>${ms}</span>`));
        while (box.children.length > 30) box.lastChild.remove();
        if (d.source === 'jev' && typeof d.credits === 'number') {
          status.jev = { ...status.jev, credits: d.credits };
          renderLinks();
        }
      },
      memory(d) {
        const box = $('#memHits');
        box.innerHTML = d.hits.length
          ? d.hits.map((x) => `<div class="hit" title="${esc(x.path)}"><b>${esc(x.title)}</b><span>${esc(x.snippet)}</span></div>`).join('')
          : '<div class="muted">Bu istek için hafızada eşleşme yok.</div>';
        if (d.hits.length) {
          window.MemGraph.highlight(d.hits.map((x) => x.path));
          activity(`hafıza: <b>${d.hits.length}</b> not bulundu`, '◈');
        }
      },
      engine(d) {
        updateEngineChip(`${status?.config?.providers[d.provider]?.label || d.provider} · ${d.model}`);
      },
      state(d) {
        setOrbState(d.state);
      },
      reasoning(d) {
        if (!bubble) bubble = botBubble();
        bubble.reasoning += d.content;
        paintBubble(bubble, true);
        scrollDown();
      },
      delta(d) {
        if (!bubble) bubble = botBubble();
        bubble.text += d.content;
        finalText += d.content;
        paintBubble(bubble, true);
        scrollDown();
      },
      segment() {
        if (finalText && !finalText.endsWith('\n\n')) finalText += '\n\n';
        if (bubble) {
          if (!bubble.text.trim() && !bubble.reasoning) bubble.root.remove();
          else paintBubble(bubble, false);
        }
        bubble = null;
      },
      tool_start(d) {
        cards.set(d.id, toolCard(d.id, d.name, d.args, d.risk));
        activity(`araç: <b>${esc(d.name)}</b>`, '⚙');
        scrollDown();
      },
      approval(d) {
        const card = cards.get(d.id) || toolCard(d.id, d.tool, d.args, 'risky');
        card.open = true;
        const box = el('div', 'approval', `<span>⚠ <b>${esc(d.tool)}</b> çalıştırılsın mı?</span><button type="button" class="yes">Onayla</button><button type="button" class="no">Reddet</button>`);
        const answer = async (allow) => {
          box.querySelectorAll('button').forEach((b) => (b.disabled = true));
          await fetch('/api/approve', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ id: d.id, allow }) });
          box.remove();
          activity(`${esc(d.tool)} ${allow ? 'onaylandı' : 'reddedildi'}`, allow ? '✓' : '✕');
        };
        box.querySelector('.yes').onclick = () => answer(true);
        box.querySelector('.no').onclick = () => answer(false);
        card.appendChild(box);
        scrollDown();
        if (document.hidden && window.Notification?.permission === 'granted') new Notification(`${PERSONA[mode].name}: onay gerekiyor`, { body: d.tool });
      },
      tool_end(d) {
        finishToolCard(cards.get(d.id), d.output, d.ok);
      },
      done(d) {
        gotDone = true;
        if (bubble) paintBubble(bubble, false);
        histories[sendMode].push(...d.messages);
        saveHistories();
        if (status?.config?.voice?.tts && finalText.trim()) speak(finalText);
      },
      error(d) {
        errorMsg = d.message;
        if (bubble) paintBubble(bubble, false);
        bubble = null;
        chat.appendChild(el('div', 'msg bot error', `⚠ ${esc(d.message)}`));
        histories[sendMode].push({ role: 'error', content: `⚠ ${d.message}` });
        saveHistories();
        activity(`hata: ${esc(d.message).slice(0, 120)}`, '!');
        scrollDown();
      },
    };

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: sendMode, tier: tier ?? $('#tierSel').value, messages: h.filter((m) => m.role !== 'error').map(({ display, from, atts, ...m }) => m) }),
        signal: controller.signal,
      });
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const raw = buf.slice(0, i);
          buf = buf.slice(i + 2);
          const ev = /^event: (.*)$/m.exec(raw)?.[1];
          const data = /^data: (.*)$/m.exec(raw)?.[1];
          if (ev && data && handlers[ev]) handlers[ev](JSON.parse(data));
        }
      }
    } catch (e) {
      if (e.name !== 'AbortError') handlers.error({ message: e.message });
    } finally {
      if (!gotDone && bubble) {
        paintBubble(bubble, false);
        if (bubble.text) histories[sendMode].push({ role: 'assistant', content: bubble.text });
        saveHistories();
      }
      busy = null;
      sendBtn.textContent = 'Gönder';
      sendBtn.classList.remove('stop');
      if (!window.speechSynthesis?.speaking) setOrbState('idle');
      updateEngineChip();
      if (bridge) {
        const reply = finalText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
        await fetch('/api/bridge/reply', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ id: bridge.id, status: errorMsg ? 'error' : 'done', text: errorMsg ? `Hata: ${errorMsg}` : reply || '(boş yanıt)' }),
        }).catch(() => {});
        activity(`cevap <b>${esc(bridge.label)}</b>'a iletildi`, '⇄');
      }
      processBridgeQueue();
    }
  }

  // ---------- dış ajan köprüsü (Grok Bot) ----------
  const bridgeQueue = [];

  function userBubble(text, from, atts) {
    const b = el('div', `msg user${from ? ' ext' : ''}`);
    if (from) b.appendChild(el('div', 'from', `⇄ ${esc(from)}`));
    b.appendChild(document.createTextNode(text));
    if (atts?.length) b.appendChild(el('div', 'atts', `📎 ${atts.map(esc).join(' · ')}`));
    return b;
  }

  // ---------- dosya ekleri ----------
  const attachments = [];
  const INLINE_MAX = 120 * 1024;
  const TEXT_EXT = /\.(txt|md|markdown|csv|tsv|json|jsonl|xml|html?|css|js|mjs|cjs|ts|tsx|jsx|py|ps1|psm1|bat|cmd|sh|c|h|cpp|hpp|cs|java|kt|go|rs|rb|php|sql|yaml|yml|toml|ini|cfg|conf|log|env\.example|srt|vtt|tex)$/i;
  const fmtSize = (n) => (n < 1024 ? `${n} B` : n < 1048576 ? `${(n / 1024).toFixed(0)} KB` : `${(n / 1048576).toFixed(1)} MB`);

  function addFiles(list) {
    for (const f of list) {
      if (f.size > 25 * 1024 * 1024) {
        activity(`${esc(f.name)}: 25 MB sınırını aşıyor`, '!');
        continue;
      }
      if (attachments.length >= 10) {
        activity('en fazla 10 dosya eklenebilir', '!');
        break;
      }
      attachments.push(f);
    }
    renderAttachments();
  }

  function renderAttachments() {
    const box = $('#attachList');
    box.innerHTML = '';
    box.hidden = !attachments.length;
    attachments.forEach((f, i) => {
      const c = el('div', 'att', `<b title="${esc(f.name)}">${esc(f.name)}</b><span>${fmtSize(f.size)}</span>`);
      const x = el('button', '', '×');
      x.type = 'button';
      x.title = 'Kaldır';
      x.onclick = () => {
        attachments.splice(i, 1);
        renderAttachments();
      };
      c.appendChild(x);
      box.appendChild(c);
    });
  }

  function readAs(file, kind) {
    return new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = () => reject(r.error || new Error('okunamadı'));
      kind === 'text' ? r.readAsText(file) : r.readAsDataURL(file);
    });
  }

  async function uploadAttachment(file) {
    const dataUrl = await readAs(file, 'data');
    const res = await fetch('/api/upload', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: file.name, data: String(dataUrl).split(',')[1] || '' }),
    });
    const r = await res.json();
    if (!res.ok) throw new Error(r.error || `HTTP ${res.status}`);
    let inline = null;
    if ((file.type.startsWith('text/') || TEXT_EXT.test(file.name) || /json|xml|javascript/.test(file.type)) && file.size <= INLINE_MAX) {
      const t = await readAs(file, 'text');
      if (!/\u0000/.test(t)) inline = t;
    }
    return { name: file.name, path: r.path, size: file.size, inline };
  }

  function attachmentBlock(atts) {
    let s = '\n\n📎 EKLER — kullanıcı bu dosyaları ekledi (bilgisayarda kayıtlı yolları ile):';
    for (const a of atts) {
      if (a.inline != null) {
        const fence = a.inline.includes('```') ? '````' : '```';
        s += `\n\n### ${a.name} (${fmtSize(a.size)}) — ${a.path}\n${fence}\n${a.inline}\n${fence}`;
      } else {
        s += `\n\n### ${a.name} (${fmtSize(a.size)}) — ${a.path}\n(İçerik metin olarak eklenmedi. Gerekirse read_file veya run_command araçlarıyla bu yoldan oku/işle.)`;
      }
    }
    return s;
  }

  function processBridgeQueue() {
    if (busy || !bridgeQueue.length) return;
    const m = bridgeQueue.shift();
    if (m.mode !== mode) applyMode(m.mode, true);
    send(m.content, { display: m.text, bridge: { id: m.id, label: m.label } });
  }

  function connectEvents() {
    const es = new EventSource('/api/events');
    es.addEventListener('bridge_in', (e) => {
      const m = JSON.parse(e.data);
      activity(`<b>${esc(m.label)}</b> mesaj gönderdi`, '⇄');
      bridgeQueue.push(m);
      processBridgeQueue();
    });
    es.addEventListener('config_changed', async () => {
      if (savingSettings) return;
      await refreshStatus(false).catch(() => {});
      loadGraph().catch(() => {});
      if ($('#settings').open) $('#settingsMsg').textContent = '⚠ Ayarlar başka yerden değişti — kaydetmeden önce pencereyi kapatıp yeniden açın.';
    });
    es.addEventListener('bridge_out', (e) => {
      const m = JSON.parse(e.data);
      activity(`Grok Bot'a mesaj bırakıldı: ${esc(m.text).slice(0, 80)}`, '⇄');
    });
  }

  // ---------- ses ----------
  function speak(text) {
    if (!window.speechSynthesis) return;
    const clean = text.replace(/<think>[\s\S]*?<\/think>/g, '').replace(/```[\s\S]*?```/g, ' kod bloğu ').replace(/[*#`>_\[\]]/g, '').slice(0, 1500);
    const u = new SpeechSynthesisUtterance(clean);
    u.lang = status?.config?.voice?.lang || 'tr-TR';
    const v = speechSynthesis.getVoices().find((x) => x.lang?.startsWith(u.lang.slice(0, 2)));
    if (v) u.voice = v;
    u.onstart = () => setOrbState('speaking');
    u.onend = () => setOrbState('idle');
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  }

  const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
  let rec = null;
  function toggleMic() {
    if (!SR) return activity('Tarayıcı ses tanımayı desteklemiyor (Chrome/Edge kullanın).', '!');
    if (rec) return rec.stop();
    rec = new SR();
    rec.lang = status?.config?.voice?.lang || 'tr-TR';
    rec.interimResults = true;
    rec.continuous = false;
    $('#micBtn').classList.add('on');
    setOrbState('listening');
    let finalT = '';
    rec.onresult = (e) => {
      let interim = '';
      for (const r of e.results) (r.isFinal ? (finalT = r[0].transcript) : (interim += r[0].transcript));
      input.value = finalT || interim;
      autoGrow();
    };
    rec.onend = () => {
      $('#micBtn').classList.remove('on');
      rec = null;
      if (!busy) setOrbState('idle');
      if (finalT.trim()) send(finalT);
    };
    rec.onerror = (e) => activity(`mikrofon: ${e.error}`, '!');
    rec.start();
  }

  // ---------- paneller ----------
  function renderLinks() {
    const ul = $('#links');
    ul.innerHTML = '';
    const add = (cls, label, tag, title = '') => ul.appendChild(el('li', '', `<span class="st ${cls}"></span><span class="lbl" title="${esc(title)}">${esc(label)}</span><span class="tag">${esc(tag)}</span>`));
    ul.appendChild(el('li', 'group', 'Motorlar'));
    for (const [k, p] of Object.entries(status.providers)) {
      if (k === 'local') add(p.online ? 'ok' : 'warn', p.label, p.online ? `${p.models.length} model` : 'çevrimdışı', p.models.join('\n'));
      else add(p.configured ? 'ok' : '', p.label, p.configured ? 'anahtar var' : 'anahtar yok');
    }
    ul.appendChild(el('li', 'group', 'Sınıflandırıcı'));
    const j = status.jev || {};
    const credits = typeof j.credits === 'number' ? `${Math.floor(j.credits).toLocaleString('tr-TR')} kredi` : j.error ? 'hata' : '—';
    if (!status.config.jev.hasKey) add('', 'Jev (freejev)', 'anahtar yok');
    else add(j.enabled ? (j.error && typeof j.credits !== 'number' ? 'warn' : 'ok') : '', 'Jev (freejev)', j.enabled ? credits : 'kapalı', j.error || '');
    ul.appendChild(el('li', 'group', 'CLI araçları'));
    for (const [k, c] of Object.entries(status.clis)) add(c.found ? 'ok' : '', k, c.found ? 'bulundu' : 'yok', c.path || '');
    ul.appendChild(el('li', 'group', 'Sistem'));
    add('ok', status.system.host, `${status.system.ramGB} GB`, `${status.system.cpu} · ${status.system.cores} çekirdek`);
  }

  function renderVaultStats() {
    const m = status.memory;
    $('#vaultStats').innerHTML = m.root
      ? `vault: <b>${esc(m.root)}</b><br>notlar: <b>${m.notes}</b>`
      : m.missing
        ? `vault: <b class="bad">yol bulunamadı</b><br><span title="${esc(m.configured)}">${esc(m.configured)}</span><br><span>(Google Drive açık mı? ↻ ile tekrar dene)</span>`
        : 'vault: <b>bağlı değil</b> — Ayarlar ⚙ › Vault yolu<br><span>(arkaplandaki grafik şu an demo)</span>';
    $('#hostInfo').textContent = `${status.system.host} · ${status.system.cpu}`;
    $('#approveInfo').textContent = status.config.autoApprove ? 'OTOMATİK ONAY: AÇIK' : 'riskli işlemler onaya tabi';
  }

  async function refreshStatus(force) {
    status = await (await fetch(`/api/status${force ? '?refresh=1' : ''}`)).json();
    renderLinks();
    renderVaultStats();
    updateEngineChip();
    return status;
  }

  async function loadSkills() {
    const skills = await (await fetch('/api/skills')).json();
    const box = $('#skills');
    box.innerHTML = '';
    $('#skillCount').textContent = skills.length ? `(${skills.length})` : '';
    for (const s of skills) {
      const b = el('button', 'skill', `<b><i>${esc(s.icon)}</i>${esc(s.title)}</b><span>${esc(s.description)}</span>`);
      b.type = 'button';
      b.onclick = async () => {
        const full = await (await fetch(`/api/skill?id=${encodeURIComponent(s.id)}`)).json();
        const extra = input.value.trim();
        send(`[SKILL: ${full.title}]\nAşağıdaki beceri talimatını uygula:\n\n${full.body}${extra ? `\n\nKullanıcı notu: ${extra}` : ''}`, {
          tier: '3',
          display: `▶ ${full.title}${extra ? ` — ${extra}` : ''}`,
        });
      };
      box.appendChild(b);
    }
    if (!skills.length) box.innerHTML = '<div class="muted">skills/ klasöründe beceri yok.</div>';
  }

  async function loadGraph() {
    const g = await (await fetch('/api/graph')).json();
    window.MemGraph.load(g);
  }

  // ---------- ayarlar ----------
  function providerOptions(sel) {
    return Object.entries(status.config.providers)
      .map(([k, p]) => `<option value="${k}" ${k === sel ? 'selected' : ''}>${esc(p.label || k)}</option>`)
      .join('');
  }

  function engineRow(id, label, e, allowEmpty) {
    return `<div class="row three" data-engine="${id}">
      <label>${label}</label>
      <select class="eprov">${allowEmpty ? `<option value="" ${!e.provider ? 'selected' : ''}>— ana motor —</option>` : ''}${providerOptions(e.provider)}</select>
      <input type="text" class="emodel" list="dl-${id}" value="${esc(e.model || '')}" placeholder="boş = sağlayıcının varsayılan modeli" />
      <button type="button" class="mini elist" title="Modelleri getir" style="width:auto;padding:0 8px">liste</button>
      <datalist id="dl-${id}"></datalist>
    </div>`;
  }

  async function openSettings() {
    try {
      await refreshStatus(false);
    } catch {
      return activity('sunucuya ulaşılamadı — ayarlar açılmadı', '!');
    }
    const c = status.config;
    const body = $('#settingsBody');
    body.innerHTML = `
      <fieldset>
        <legend>Hafıza (Obsidian)</legend>
        <div class="row"><label>Vault yolu</label><input type="text" id="sVault" value="${esc(c.vaultPath)}" placeholder="C:\\Users\\...\\Obsidian\\Vault" /></div>
        <div class="row"><label>Çekirdek notlar</label><input type="text" id="sCore" value="${esc((c.memory.coreNotes || []).join(', '))}" placeholder="_beyin/kimlik.md, _beyin/kurallar.md" /></div>
        <p class="hint">Çekirdek notlar her mesajda ajana verilir (kimlik, tercihler, kurallar). Diğer notlar soruya göre otomatik aranır.</p>
        <div class="row"><label>Sohbetleri kaydet</label><label><input type="checkbox" id="sLog" ${c.memory.logConversations ? 'checked' : ''}/> vault içine <code>${esc(c.memory.logFolder)}</code> klasörüne günlük kayıt</label></div>
      </fieldset>
      <fieldset>
        <legend>Motorlar</legend>
        ${engineRow('vault', 'V.A.U.L.T. motoru', c.modes.vault)}
        ${engineRow('breach', 'B.R.E.A.C.H. motoru', c.modes.breach)}
        ${engineRow('fast', 'Hızlı model (T2)', c.fastModel, true)}
        <p class="hint">B.R.E.A.C.H. için "LM Studio (Yerel)" seçin ve LM Studio'da sansürsüz modeli yükleyip Local Server'ı açın. Model adı boşsa yüklü ilk model kullanılır.</p>
      </fieldset>
      <fieldset>
        <legend>Jev sınıflandırıcı</legend>
        <div class="row"><label>Jev kullan</label><label><input type="checkbox" id="sJev" ${c.jev.enabled ? 'checked' : ''}/> T2/T3 kararını Jev versin (hata olursa yerel sezgiye düşer)</label></div>
        <div class="row"><label>FreeJev anahtarı</label><input type="password" id="sJevKey" autocomplete="off" data-orig="${esc(c.jev.apiKey || '')}" value="${esc(c.jev.apiKey || '')}" placeholder="sk-freejev-…" /></div>
        <div class="row"><label>B.R.E.A.C.H.'te de</label><label><input type="checkbox" id="sJevBreach" ${c.jev.useInBreach ? 'checked' : ''}/> B.R.E.A.C.H. modunda da kullan</label></div>
        <p class="hint">Jev uzak bir servistir: mesajının ilk 2000 karakteri sınıflandırma için freejev.org'a (oradan TypeSafe/OpenRouter'a) gider. Tamamen yerel kalmak istediğin konuşmalar için B.R.E.A.C.H. seçeneğini kapat.</p>
      </fieldset>
      <fieldset>
        <legend>API anahtarları</legend>
        ${Object.entries(c.providers)
          .map(([k, p]) => `<div class="prov" data-prov="${k}"><b>${esc(p.label || k)}</b><input type="text" class="purl" value="${esc(p.baseUrl)}" title="Adres" /><input type="password" class="pkey" autocomplete="off" data-orig="${esc(p.apiKey || '')}" value="${esc(p.apiKey || '')}" placeholder="API anahtarı" /><input type="text" class="pdef" value="${esc(p.defaultModel || '')}" placeholder="varsayılan model" title="Varsayılan model" /></div>`)
          .join('')}
        <p class="hint">Anahtarlar sadece bu bilgisayardaki <code>config.json</code> dosyasında durur. Gemini için ücretsiz anahtar: aistudio.google.com. Perplexity API ücretlidir. Bir anahtarı silmek için kutusunu boşaltıp kaydedin; dokunmadığınız kutular olduğu gibi kalır.</p>
      </fieldset>
      <fieldset>
        <legend>Güvenlik ve ses</legend>
        <div class="row"><label>Otomatik onay</label><label><input type="checkbox" id="sAuto" ${c.autoApprove ? 'checked' : ''}/> riskli işlemleri (komut, dosya yazma, program açma, CLI) sormadan çalıştır</label></div>
        <div class="row"><label>Sesli yanıt</label><label><input type="checkbox" id="sTts" ${c.voice.tts ? 'checked' : ''}/> cevapları sesli oku (Windows sesi)</label></div>
      </fieldset>`;

    body.querySelectorAll('.elist').forEach((btn) => {
      btn.onclick = async () => {
        const row = btn.closest('[data-engine]');
        const prov = row.querySelector('.eprov').value || status.config.modes[mode].provider;
        btn.textContent = '…';
        const r = await (await fetch(`/api/models?provider=${encodeURIComponent(prov)}`)).json();
        btn.textContent = 'liste';
        row.querySelector('datalist').innerHTML = r.models.map((m) => `<option value="${esc(m)}"></option>`).join('');
        $('#settingsMsg').textContent = r.error ? `⚠ ${r.error}` : `${r.models.length} model bulundu — kutuya tıklayıp seçin.`;
      };
    });
    $('#settingsMsg').textContent = '';
    $('#settings').showModal();
  }

  let savingSettings = false;
  async function saveSettings() {
    const body = $('#settingsBody');
    const eng = (id) => {
      const row = body.querySelector(`[data-engine="${id}"]`);
      return { provider: row.querySelector('.eprov').value, model: row.querySelector('.emodel').value.trim() };
    };
    // Dokunulmamış anahtar kutusunu hiç göndermeyiz: /api/config derin birleştirir, yani
    // gönderilmeyen alan korunur. Böylece tarayıcı parola yöneticisi kutuyu boşaltsa bile
    // config.json'daki anahtar silinmez. Kutuyu kullanıcı boşaltırsa boş değer gider ve silinir.
    const secret = (inp) => (inp.value === inp.dataset.orig ? null : inp.value.trim());
    const provs = {};
    body.querySelectorAll('[data-prov]').forEach((r) => {
      const p = {
        baseUrl: r.querySelector('.purl').value.trim(),
        defaultModel: r.querySelector('.pdef').value.trim(),
      };
      const key = secret(r.querySelector('.pkey'));
      if (key !== null) p.apiKey = key;
      provs[r.dataset.prov] = p;
    });
    const jevKey = secret($('#sJevKey'));
    const payload = {
      vaultPath: $('#sVault').value.trim().replace(/^"|"$/g, ''),
      autoApprove: $('#sAuto').checked,
      voice: { tts: $('#sTts').checked },
      modes: { vault: eng('vault'), breach: eng('breach') },
      fastModel: eng('fast'),
      jev: { enabled: $('#sJev').checked, useInBreach: $('#sJevBreach').checked, ...(jevKey === null ? {} : { apiKey: jevKey }) },
      memory: { coreNotes: $('#sCore').value.split(',').map((s) => s.trim()).filter(Boolean), logConversations: $('#sLog').checked },
      providers: provs,
    };
    $('#settingsMsg').textContent = 'kaydediliyor…';
    savingSettings = true;
    const r = await fetch('/api/config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(payload) }).finally(() => setTimeout(() => (savingSettings = false), 500));
    if (!r.ok) {
      $('#settingsMsg').textContent = '⚠ kaydedilemedi';
      return;
    }
    await refreshStatus(true);
    await Promise.all([loadGraph(), loadSkills()]);
    $('#settings').close();
    activity('ayarlar kaydedildi', '✓');
  }

  // ---------- açılış ----------
  async function boot() {
    const log = $('#bootLog');
    const bootEl = $('#boot');
    $('#bootLogo').textContent = PERSONA[mode].name;
    $('#bootSub').textContent = PERSONA[mode].full;
    let skipped = false;
    bootEl.onclick = () => {
      skipped = true;
      bootEl.classList.add('hide');
    };
    const line = async (html, delay = 140) => {
      log.innerHTML += `${html}\n`;
      if (!skipped) await new Promise((r) => setTimeout(r, delay));
    };
    await line('> çekirdek başlatılıyor…');
    let st;
    try {
      st = await refreshStatus(false);
    } catch (e) {
      await line(`<span class="warn">> sunucuya ulaşılamadı: ${esc(e.message)}</span>`, 2000);
      return;
    }
    await line(`> sistem: ${esc(st.system.host)} · ${esc(st.system.cpu)} · ${st.system.ramGB} GB`);
    await line(st.memory.root ? `<span class="ok">> hafıza bağlandı: ${st.memory.notes} not</span>` : '<span class="warn">> hafıza: vault bağlı değil (Ayarlar)</span>');
    for (const [k, p] of Object.entries(st.providers)) {
      if (k === 'local') await line(p.online ? `<span class="ok">> ${esc(p.label)}: çevrimiçi (${p.models.length} model)</span>` : `<span class="warn">> ${esc(p.label)}: çevrimdışı</span>`);
      else await line(p.configured ? `<span class="ok">> ${esc(p.label)}: hazır</span>` : `<span class="no">> ${esc(p.label)}: anahtar yok</span>`, 70);
    }
    if (st.config.jev.hasKey && st.jev.enabled) {
      await line(typeof st.jev.credits === 'number' ? `<span class="ok">> Jev sınıflandırıcı: hazır (${Math.floor(st.jev.credits)} kredi)</span>` : `<span class="warn">> Jev sınıflandırıcı: ${esc(st.jev.error || 'bakiye okunamadı')}</span>`);
    }
    for (const [k, c] of Object.entries(st.clis)) await line(c.found ? `<span class="ok">> ${k} CLI: bulundu</span>` : `<span class="no">> ${k} CLI: yok</span>`, 60);
    await Promise.all([loadGraph(), loadSkills()]);
    await line(`<span class="ok">> ${PERSONA[mode].name} hazır.</span>`, 700);
    bootEl.classList.add('hide');
  }

  // ---------- olaylar ----------
  function autoGrow() {
    input.style.height = 'auto';
    input.style.height = `${Math.min(input.scrollHeight, 180)}px`;
  }

  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    if (busy) {
      busy.abort();
      return;
    }
    const cmd = /^\/(temizle|clear)(\s+(hepsi|tümü|tumu|all))?\s*$/i.exec(input.value.trim());
    if (cmd) {
      input.value = '';
      autoGrow();
      clearChats(cmd[3] ? 'all' : 'mode');
      return;
    }
    send(input.value);
  });
  $('#attachBtn').onclick = () => $('#fileInput').click();
  $('#fileInput').onchange = (e) => {
    addFiles(e.target.files);
    e.target.value = '';
    input.focus();
  };
  const composerEl = $('#composer');
  const hasFiles = (e) => [...(e.dataTransfer?.types || [])].includes('Files');
  for (const target of [composerEl, chat]) {
    target.addEventListener('dragover', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      composerEl.classList.add('drop');
    });
    target.addEventListener('dragleave', () => composerEl.classList.remove('drop'));
    target.addEventListener('drop', (e) => {
      if (!hasFiles(e)) return;
      e.preventDefault();
      composerEl.classList.remove('drop');
      addFiles(e.dataTransfer.files);
    });
  }
  input.addEventListener('paste', (e) => {
    const files = [...(e.clipboardData?.files || [])];
    if (!files.length) return;
    e.preventDefault();
    addFiles(files.map((f, i) => (f.name && f.name !== 'image.png' ? f : new File([f], `yapistirilan-${Date.now()}-${i}.${(f.type.split('/')[1] || 'bin').replace('jpeg', 'jpg')}`, { type: f.type }))));
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      $('#composer').requestSubmit();
    }
  });
  input.addEventListener('input', autoGrow);
  $('#modeSwitch').onclick = () => !busy && applyMode(mode === 'vault' ? 'breach' : 'vault', true);
  $('#settingsBtn').onclick = openSettings;
  $('#saveSettings').onclick = saveSettings;
  $('#micBtn').onclick = toggleMic;
  $('#refreshBtn').onclick = () => refreshStatus(true).then(() => activity('bağlantılar tarandı', '↻'));
  $('#reindexBtn').onclick = async () => {
    await fetch('/api/memory/reindex', { method: 'POST' });
    await refreshStatus(false);
    await loadGraph();
    activity('vault yeniden tarandı', '↻');
  };
  $('#newChatBtn').onclick = () => {
    if (busy) return;
    histories[mode] = [];
    saveHistories();
    renderChat();
    activity('yeni sohbet', '＋');
  };

  async function clearChats(scope, panels = true) {
    if (busy) {
      activity('yanıt sürerken temizlenemez — önce Durdur', '!');
      return;
    }
    window.speechSynthesis?.cancel();
    const modes = scope === 'all' ? ['vault', 'breach'] : [mode];
    for (const m of modes) histories[m] = [];
    saveHistories();
    await fetch('/api/chat/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: scope === 'all' ? 'all' : mode }),
    }).catch(() => {});
    renderChat();
    if (panels) {
      $('#memHits').innerHTML = '<div class="muted">Sorgu bekleniyor…</div>';
      $('#routeLog').innerHTML = '<div class="muted">Henüz istek yok.</div>';
      $('#activity').innerHTML = '';
    }
    setOrbState('idle');
    activity(scope === 'all' ? 'tüm sohbetler temizlendi' : `${PERSONA[mode].name} sohbeti temizlendi`, '🗑');
  }

  const clearMenu = $('#clearMenu');
  $('#clearBtn').onclick = (e) => {
    e.stopPropagation();
    $('#clearModeBtn').textContent = `Bu modun sohbeti (${PERSONA[mode].name})`;
    clearMenu.hidden = !clearMenu.hidden;
  };
  clearMenu.addEventListener('click', (e) => {
    e.stopPropagation();
    const scope = e.target.closest('[data-clear]')?.dataset.clear;
    if (!scope) return;
    clearMenu.hidden = true;
    clearChats(scope, $('#clearPanels').checked);
  });
  document.addEventListener('click', () => (clearMenu.hidden = true));
  document.addEventListener('keydown', (e) => {
    if (e.ctrlKey && e.altKey && e.key.toLowerCase() === 'j') {
      e.preventDefault();
      toggleMic();
    }
    if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'b') {
      e.preventDefault();
      $('#modeSwitch').click();
    }
  });

  setInterval(() => {
    $('#clock').textContent = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  }, 1000);
  $('#clock').textContent = new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
  if (window.Notification && Notification.permission === 'default') Notification.requestPermission().catch(() => {});

  setInterval(() => {
    if (!busy && !document.hidden && status) refreshStatus(false).catch(() => {});
  }, 30000);

  applyMode(mode, false);
  setOrbState('idle');
  boot();
  connectEvents();
})();
