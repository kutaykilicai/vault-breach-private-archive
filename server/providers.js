const config = require('./config');

function getProvider(name) {
  const p = config.get().providers[name];
  if (!p) throw new Error(`Bilinmeyen sağlayıcı: ${name}`);
  return p;
}

function headers(p, name) {
  const h = { 'Content-Type': 'application/json' };
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
  if (name === 'anthropic' && p.apiKey) {
    h['x-api-key'] = p.apiKey;
    h['anthropic-version'] = '2023-06-01';
  }
  if (name === 'openrouter') {
    h['HTTP-Referer'] = 'http://127.0.0.1';
    h['X-Title'] = 'VAULT-BREACH';
  }
  return h;
}

function isReady(name) {
  const p = config.get().providers[name];
  if (!p) return false;
  return name === 'local' || Boolean(p.apiKey);
}

async function listModels(name, timeoutMs = 4000) {
  const p = getProvider(name);
  const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/models`, {
    headers: headers(p, name),
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!res.ok) throw new Error(`${name} /models: HTTP ${res.status}`);
  const data = await res.json();
  const list = data.data || data.models || [];
  return list
    .map((m) => (typeof m === 'string' ? m : m.id || m.name))
    .filter(Boolean)
    .map((id) => id.replace(/^models\//, ''));
}

async function resolveModel(name, model) {
  if (model) return model;
  const def = config.get().providers[name]?.defaultModel;
  if (def) return def;
  const models = await listModels(name);
  if (!models.length) throw new Error(`${name} için model bulunamadı. Ayarlardan model seçin (LM Studio'da model yüklü mü?).`);
  return models[0];
}

/**
 * OpenAI uyumlu /chat/completions akışı.
 * onDelta({content, reasoning}) her parçada çağrılır.
 * Dönen değer: { content, toolCalls, finishReason }
 */
const NETWORK_ERR = /terminated|fetch failed|ECONNRESET|ETIMEDOUT|EAI_AGAIN|socket|other side closed/i;

function stripToolHistory(messages) {
  const out = messages
    .filter((m) => m.role !== 'tool')
    .map((m) => (m.tool_calls ? { role: m.role, content: m.content || '' } : m))
    .filter((m) => m.role !== 'assistant' || m.content);
  const note = 'ÖNEMLİ: Bu model araç çağıramıyor. Bilgisayarda komut çalıştıramaz, dosya okuyamaz/listeleyemezsin. Yapmış gibi davranma ve hafızadaki eski kayıtları güncel sonuç gibi sunma; gerekiyorsa kullanıcıya bunun için araç destekli bir motor gerektiğini söyle.';
  const i = out.findIndex((m) => m.role === 'system');
  if (i >= 0) out[i] = { ...out[i], content: `${out[i].content}\n\n${note}` };
  else out.unshift({ role: 'system', content: note });
  return out;
}

async function streamChat(opts) {
  let received = false;
  const onDelta = (d) => {
    received = true;
    opts.onDelta?.(d);
  };
  for (let attempt = 0; ; attempt++) {
    try {
      return await streamOnce({ ...opts, onDelta });
    } catch (e) {
      const msg = `${e.message} ${e.cause?.code || ''}`;
      if (opts.signal?.aborted || !NETWORK_ERR.test(msg)) throw e;
      if (received) throw new Error(`${opts.provider} bağlantısı cevap ortasında koptu (internet bağlantısını kontrol edin). "devam" yazarak sürdürebilirsiniz.`);
      if (attempt >= 2) throw new Error(`${opts.provider} sunucusuna ulaşılamadı (${e.cause?.code || e.message}).`);
      await new Promise((r) => setTimeout(r, 1500 * (attempt + 1)));
    }
  }
}

async function streamOnce({ provider, model, messages, tools, signal, onDelta, temperature }) {
  const p = getProvider(provider);
  const body = {
    model: await resolveModel(provider, model),
    messages,
    stream: true,
  };
  if (temperature !== undefined) body.temperature = temperature;
  if (tools && tools.length && !p.noTools) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }

  const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: headers(p, provider),
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    if (body.tools && (res.status === 404 || res.status === 400) && /support tool|tool use|tools? (is|are) not supported|does not support tools/i.test(txt)) {
      return streamOnce({ provider, model: body.model, messages: stripToolHistory(messages), tools: null, signal, onDelta, temperature });
    }
    throw new Error(`${provider} HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }

  let content = '';
  let reasoningText = '';
  let finishReason = null;
  const toolCalls = [];
  const decoder = new TextDecoder();
  let buf = '';

  for await (const chunk of res.body) {
    buf += decoder.decode(chunk, { stream: true });
    let idx;
    while ((idx = buf.indexOf('\n')) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line.startsWith('data:')) continue;
      const payload = line.slice(5).trim();
      if (payload === '[DONE]') continue;
      let json;
      try {
        json = JSON.parse(payload);
      } catch {
        continue;
      }
      const choice = json.choices?.[0];
      if (!choice) continue;
      const d = choice.delta || {};
      const reasoning = d.reasoning_content || d.reasoning;
      if (reasoning) {
        reasoningText += reasoning;
        onDelta?.({ reasoning });
      }
      if (d.content) {
        content += d.content;
        onDelta?.({ content: d.content });
      }
      for (const tc of d.tool_calls || []) {
        const i = tc.index ?? toolCalls.length;
        if (!toolCalls[i]) toolCalls[i] = { id: tc.id || `call_${Date.now()}_${i}`, type: 'function', function: { name: '', arguments: '' } };
        if (tc.id) toolCalls[i].id = tc.id;
        if (tc.function?.name) toolCalls[i].function.name += tc.function.name;
        if (tc.function?.arguments) toolCalls[i].function.arguments += tc.function.arguments;
      }
      if (choice.finish_reason) finishReason = choice.finish_reason;
    }
  }

  return { content, reasoning: reasoningText, toolCalls: toolCalls.filter(Boolean), finishReason, model: body.model };
}

async function complete({ provider, model, messages, signal }) {
  let out = '';
  await streamChat({ provider, model, messages, signal, onDelta: (d) => { if (d.content) out += d.content; } });
  return out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

module.exports = { listModels, streamChat, complete, isReady, resolveModel };
