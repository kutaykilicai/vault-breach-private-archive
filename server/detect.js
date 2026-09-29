const { execFile } = require('child_process');
const os = require('os');
const config = require('./config');
const providers = require('./providers');

const isWin = process.platform === 'win32';

function which(cmd) {
  return new Promise((resolve) => {
    execFile(isWin ? 'where.exe' : 'which', [cmd], { timeout: 4000, windowsHide: true }, (err, stdout) => {
      if (err) return resolve(null);
      resolve(stdout.split(/\r?\n/).map((s) => s.trim()).filter(Boolean)[0] || null);
    });
  });
}

let cache = { at: 0, data: null };

async function detectAll(force = false) {
  if (!force && cache.data && Date.now() - cache.at < 30000) return cache.data;
  const cfg = config.get();

  const cliEntries = await Promise.all(
    Object.entries(cfg.clis).map(async ([name, c]) => [name, { path: await which(c.cmd) }])
  );
  const clis = Object.fromEntries(cliEntries.map(([n, v]) => [n, { found: Boolean(v.path), path: v.path }]));

  const provEntries = await Promise.all(
    Object.entries(cfg.providers).map(async ([name, p]) => {
      const info = { label: p.label || name, configured: providers.isReady(name), online: null, models: [] };
      if (name === 'local') {
        try {
          info.models = await providers.listModels('local', 1500);
          info.online = true;
        } catch {
          info.online = false;
        }
      }
      return [name, info];
    })
  );

  cache = {
    at: Date.now(),
    data: {
      clis,
      providers: Object.fromEntries(provEntries),
      system: {
        host: os.hostname(),
        platform: `${os.type()} ${os.release()}`,
        cpu: os.cpus()[0]?.model?.trim() || 'bilinmiyor',
        cores: os.cpus().length,
        ramGB: Math.round((os.totalmem() / 1024 ** 3) * 10) / 10,
      },
    },
  };
  return cache.data;
}

module.exports = { detectAll, which };
