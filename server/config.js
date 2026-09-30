const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
// VB_CONFIG_PATH yalnızca testler için: gerçek config.json'a dokunmadan izole bir dosya kullanılır.
const CONFIG_PATH = process.env.VB_CONFIG_PATH ? path.resolve(process.env.VB_CONFIG_PATH) : path.join(ROOT, 'config.json');
const MASK = '••••••••';

const DEFAULTS = {
  port: 7777,
  vaultPath: '',
  autoApprove: false,
  voice: { tts: false, lang: 'tr-TR' },
  modes: {
    vault: { provider: 'openrouter', model: '' },
    breach: { provider: 'local', model: '' },
  },
  fastModel: { provider: '', model: '' },
  jev: {
    enabled: true,
    baseUrl: 'https://freejev.org/api/v1',
    apiKey: '',
    useInBreach: true,
    timeoutMs: 4000,
  },
  memory: {
    coreNotes: [],
    maxHits: 5,
    writeFolder: 'inbox',
    logConversations: true,
    logFolder: 'inbox/sohbet-kayitlari',
  },
  providers: {
    local: { label: 'LM Studio (Yerel)', baseUrl: 'http://localhost:1234/v1', apiKey: 'lm-studio', defaultModel: '' },
    openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', apiKey: '', defaultModel: 'google/gemini-3.5-flash-lite' },
    kimi: { label: 'Kimi (Moonshot)', baseUrl: 'https://api.moonshot.ai/v1', apiKey: '', defaultModel: 'kimi-k3' },
    anthropic: { label: 'Claude (Anthropic)', baseUrl: 'https://api.anthropic.com/v1', apiKey: '', defaultModel: 'claude-sonnet-5-5' },
    gemini: { label: 'Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: '', defaultModel: 'gemini-3.5-flash' },
    nvidia: { label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', apiKey: '', defaultModel: 'nvidia/nemotron-3-super-120b-a12b' },
    xai: { label: 'Grok (xAI)', baseUrl: 'https://api.x.ai/v1', apiKey: '', defaultModel: '' },
    perplexity: { label: 'Perplexity', baseUrl: 'https://api.perplexity.ai', apiKey: '', defaultModel: 'sonar', noTools: true },
  },
  clis: {
    claude: { cmd: 'claude', args: ['-p', '{prompt}'] },
    gemini: { cmd: 'gemini', args: ['-p', '{prompt}'] },
    codex: { cmd: 'codex', args: ['exec', '{prompt}'] },
    kimi: { cmd: 'kimi', args: ['--print', '-c', '{prompt}'] },
    grok: { cmd: 'grok', args: ['-p', '{prompt}'] },
    opencode: { cmd: 'opencode', args: ['run', '{prompt}'] },
  },
};

function isObj(v) {
  return v && typeof v === 'object' && !Array.isArray(v);
}

function deepMerge(base, over) {
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [k, v] of Object.entries(over || {})) {
    out[k] = isObj(v) && isObj(base[k]) ? deepMerge(base[k], v) : v;
  }
  return out;
}

let current = null;

function load() {
  let user = {};
  if (fs.existsSync(CONFIG_PATH)) {
    try {
      user = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8').replace(/^\uFEFF/, ''));
    } catch (e) {
      console.error('[config] config.json okunamadı, varsayılanlar kullanılıyor:', e.message);
    }
  }
  current = deepMerge(DEFAULTS, user);
  return current;
}

function get() {
  return current || load();
}

function save(next) {
  current = deepMerge(DEFAULTS, next);
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(current, null, 2), 'utf8');
  return current;
}

function masked() {
  const c = JSON.parse(JSON.stringify(get()));
  for (const p of Object.values(c.providers)) {
    p.hasKey = Boolean(p.apiKey);
    if (p.apiKey && p.apiKey !== 'lm-studio') p.apiKey = MASK;
  }
  c.jev.hasKey = Boolean(c.jev.apiKey);
  if (c.jev.apiKey) c.jev.apiKey = MASK;
  return c;
}

function updateFromClient(incoming) {
  const c = JSON.parse(JSON.stringify(get()));
  const merged = deepMerge(c, incoming);
  for (const [name, p] of Object.entries(merged.providers || {})) {
    if (p.apiKey === MASK) p.apiKey = c.providers[name]?.apiKey || '';
    delete p.hasKey;
  }
  if (merged.jev) {
    if (merged.jev.apiKey === MASK) merged.jev.apiKey = c.jev.apiKey;
    delete merged.jev.hasKey;
  }
  return save(merged);
}

module.exports = { ROOT, get, load, save, masked, updateFromClient };
