// Qwen3.5 sohbet şablonu açılış <think> etiketini isteğin sonuna koyar.
// Model cevabı bu yüzden "Thinking Process:" ile başlar ve yanıt ancak </think> sonrasındadır.
(function (root, factory) {
  const api = factory();
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Think = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  const CLOSE_RE = /<\/think(?:ing)?>/i;
  const MARKERS = ['thinking process:', '<thinking>', '<think>'];

  function isAmbiguousStart(text) {
    const t = String(text || '').replace(/^\s+/, '').toLowerCase();
    if (!t) return true;
    return MARKERS.some((m) => m.startsWith(t) && t.length < m.length);
  }

  function partialCloseHold(text) {
    const lower = String(text || '').toLowerCase();
    const tags = ['</thinking>', '</think>'];
    let hold = 0;
    for (const tag of tags) {
      const max = Math.min(tag.length - 1, lower.length);
      for (let n = max; n > 0; n--) {
        if (lower.endsWith(tag.slice(0, n))) {
          hold = Math.max(hold, n);
          break;
        }
      }
    }
    return hold;
  }

  function splitThink(src, opts) {
    const flush = Boolean(opts && opts.flush);
    const fromReasoning = Boolean(opts && opts.fromReasoning);
    const original = String(src ?? '');
    let text = original;
    let reasoning = '';

    const before = text;
    const eat = (re) => {
      text = text.replace(re, (_, body) => {
        reasoning += body || '';
        return '';
      });
    };
    eat(/<think>([\s\S]*?)<\/think>/gi);
    eat(/<thinking>([\s\S]*?)<\/thinking>/gi);
    const atePair = text !== before;

    const openTail = /<think(?:ing)?>([\s\S]*)$/i.exec(text);
    if (openTail) {
      reasoning += openTail[1];
      text = text.slice(0, openTail.index);
    }

    const close = CLOSE_RE.exec(text);
    if (close) {
      reasoning += text.slice(0, close.index);
      text = text.slice(close.index + close[0].length);
    } else if (!fromReasoning && /^\s*thinking process\s*:/i.test(text)) {
      reasoning += text;
      text = '';
    } else if (!fromReasoning && !flush && !atePair && !openTail && isAmbiguousStart(text)) {
      return { reasoning: '', content: '', pending: true };
    } else if (fromReasoning && !atePair && !openTail && !close) {
      return { reasoning: original, content: '', pending: false };
    }

    return { reasoning, content: text, pending: false };
  }

  function visibleThink(src, opts) {
    const split = splitThink(src, opts);
    if (split.pending || (opts && opts.flush) || String(split.content || '').trim()) return split;
    const hold = partialCloseHold(split.reasoning);
    if (!hold) return split;
    return { reasoning: split.reasoning.slice(0, -hold), content: split.content, pending: false };
  }

  function parts(reasoning, content, opts) {
    const flush = Boolean(opts && opts.flush);
    const r = visibleThink(reasoning || '', { flush, fromReasoning: true });
    const c = visibleThink(content || '', { flush });
    if (!flush && c.pending && !String(r.reasoning || '').trim() && !String(r.content || '').trim()) {
      return { reasoning: '', content: '', pending: true };
    }
    const why = [r.reasoning, c.reasoning].map((s) => String(s || '').trim()).filter(Boolean).join('\n\n');
    const fromC = String(c.content || '');
    const fromR = String(r.content || '');
    return { reasoning: why, content: fromC.trim() ? fromC : fromR, pending: false };
  }

  function isUrlModel(model) {
    const s = String(model || '').trim();
    if (!s) return false;
    if (/^https?:\/\//i.test(s)) return true;
    return /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?(\/.*)?$/i.test(s);
  }

  return { splitThink, visibleThink, parts, isUrlModel };
});
