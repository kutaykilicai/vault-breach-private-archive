const config = require('./config');

function getProvider(name) {
  const p = config.get().providers[name];
  if (!p) throw new Error(`Bilinmeyen sağlayıcı: ${name}`);
  return p;
}

function headers(p, name) {
  const h = { 'Content-Type': 'application/json' };
  if (p.apiKey) h.Authorization = `Bearer ${p.apiKey}`;
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
  return list.map((m) => (typeof m === 'string' ? m : m.id || m.name)).filter(Boolean);
}

async function resolveModel(name, model) {
  if (model) return model;
  const models = await listModels(name);
  if (!models.length) throw new Error(`${name} için model bulunamadı. Ayarlardan model seçin (LM Studio'da model yüklü mü?).`);
  return models[0];
}

/**
 * OpenAI uyumlu /chat/completions akışı.
 * onDelta({content, reasoning}) her parçada çağrılır.
 * Dönen değer: { content, toolCalls, finishReason }
 */
async function streamChat({ provider, model, messages, tools, signal, onDelta, temperature }) {
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
    throw new Error(`${provider} HTTP ${res.status}: ${txt.slice(0, 400)}`);
  }

  let content = '';
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
      if (reasoning) onDelta?.({ reasoning });
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

  return { content, toolCalls: toolCalls.filter(Boolean), finishReason, model: body.model };
}

async function complete({ provider, model, messages, signal }) {
  let out = '';
  await streamChat({ provider, model, messages, signal, onDelta: (d) => { if (d.content) out += d.content; } });
  return out.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
}

module.exports = { listModels, streamChat, complete, isReady, resolveModel };
