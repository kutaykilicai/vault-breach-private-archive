// Telegram botu: telefondan doğrudan V.A.U.L.T. / B.R.E.A.C.H.'e yazmak için. Sadece izinli kullanıcılara cevap verir.
const crypto = require('crypto');
const config = require('./config');
const bridge = require('./bridge');

const API = 'https://api.telegram.org';
const MAX_LEN = 4000;

let running = false;
let offset = 0;
let botInfo = null;
let lastError = null;
let pairCode = null;
const approvals = new Map();
const chatModes = new Map();

function cfg() {
  return config.get().telegram;
}

async function tg(method, body, timeoutMs = 15000) {
  const res = await fetch(`${API}/bot${cfg().botToken}/${method}`, {
    method: 'POST',
    head