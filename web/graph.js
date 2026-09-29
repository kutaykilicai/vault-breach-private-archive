// Obsidian hafıza grafiği: arkaplanda yavaşça dönen kuvvet-yönelimli ağ.
(() => {
  const canvas = document.getElementById('graph');
  const ctx = canvas.getContext('2d');
  let W = 0;
  let H = 0;
  let dpr = 1;
  let nodes = [];
  let links = [];
  let alpha = 1;
  let angle = 0;
  let rgb = '58, 160, 255';
  let highlighted = new Map();
  let lastFrame = 0;
  let small = false;

  function resize() {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    W = window.innerWidth;
    H = window.innerHeight;
    canvas.width = W * dpr;
    canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  function demoData() {
    const hubs = 14;
    const n = 460;
    const out = { nodes: [], links: [] };
    for (let i = 0; i < n; i++) out.nodes.push({ id: `demo-${i}`, title: i < hubs ? `hub ${i}` : `not ${i}`, degree: 0 });
    for (let i = hubs; i < n; i++) {
      const hub = i % hubs;
      out.links.push([i, hub]);
      if (Math.random() < 0.35) out.links.push([i, hubs + Math.floor(Math.random() * (n - hubs))]);
    }
    for (let i = 0; i < hubs; i++) if (Math.random() < 0.6) out.links.push([i, (i + 1 + Math.floor(Math.random() * 3)) % hubs]);
    for (const [a, b] of out.links) {
      out.nodes[a].degree++;
      out.nodes[b].degree++;
    }
    return out;
  }

  // Az bağlantılı küçük vault'larda notlar klasör merkezlerine bağlanır; yoksa ağ görünmez.
  function withFolderHubs(data) {
    const out = { nodes: data.nodes.map((n) => ({ ...n })), links: data.links.map((l) => [...l]) };
    const hubIndex = new Map();
    const hub = (key, title) => {
      if (!hubIndex.has(key)) {
        hubIndex.set(key, out.nodes.length);
        out.nodes.push({ id: `hub:${key}`, title, degree: 0, hub: true });
      }
      return hubIndex.get(key);
    };
    const root = hub('', 'VAULT');
    data.nodes.forEach((n, i) => {
      const parts = String(n.id).split('/');
      if (parts.length < 2) return out.links.push([i, root]);
      const f = hub(parts[0], `${parts[0]}/`);
      out.links.push([i, f]);
    });
    for (const [key, i] of hubIndex) if (key) out.links.push([i, root]);
    for (const n of out.nodes) n.degree = 0;
    for (const [a, b] of out.links) {
      out.nodes[a].degree++;
      out.nodes[b].degree++;
    }
    return out;
  }

  function load(data) {
    const real = Boolean(data && data.nodes && data.nodes.length);
    if (!real) data = demoData();
    else if (data.links.length < data.nodes.length) data = withFolderHubs(data);
    small = real && data.nodes.length <= 80;
    const spread = Math.sqrt(data.nodes.length) * 22;
    nodes = data.nodes.map((n) => {
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * spread;
      const size = small ? (n.hub ? 4.5 : 3) + Math.sqrt(n.degree || 0) * 1.2 : 1.1 + Math.sqrt(n.degree || 0) * 0.9;
      return { ...n, x: Math.cos(a) * r, y: Math.sin(a) * r, vx: 0, vy: 0, size };
    });
    links = data.links.filter(([a, b]) => nodes[a] && nodes[b]);
    alpha = 1;
  }

  function tick() {
    const CELL = 70;
    const grid = new Map();
    for (const n of nodes) {
      const k = `${Math.floor(n.x / CELL)},${Math.floor(n.y / CELL)}`;
      if (!grid.has(k)) grid.set(k, []);
      grid.get(k).push(n);
    }
    const rep = 1100 * alpha;
    for (const n of nodes) {
      const cx = Math.floor(n.x / CELL);
      const cy = Math.floor(n.y / CELL);
      for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
          const cell = grid.get(`${cx + dx},${cy + dy}`);
          if (!cell) continue;
          for (const m of cell) {
            if (m === n) continue;
            let ddx = n.x - m.x;
            let ddy = n.y - m.y;
            let d2 = ddx * ddx + ddy * ddy;
            if (d2 < 0.01) {
              ddx = Math.random() - 0.5;
              ddy = Math.random() - 0.5;
              d2 = 0.5;
            }
            const f = Math.min(rep / d2, 6);
            const d = Math.sqrt(d2);
            n.vx += (ddx / d) * f;
            n.vy += (ddy / d) * f;
          }
        }
      }
    }
    for (const [ai, bi] of links) {
      const a = nodes[ai];
      const b = nodes[bi];
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const f = (d - 38) * 0.03 * alpha;
      const fx = (dx / d) * f;
      const fy = (dy / d) * f;
      a.vx += fx;
      a.vy += fy;
      b.vx -= fx;
      b.vy -= fy;
    }
    for (const n of nodes) {
      n.vx -= n.x * 0.004 * Math.max(alpha, 0.2);
      n.vy -= n.y * 0.004 * Math.max(alpha, 0.2);
      n.vx *= 0.82;
      n.vy *= 0.82;
      n.x += n.vx;
      n.y += n.vy;
    }
    alpha = Math.max(alpha * 0.992, 0.04);
  }

  function draw(now) {
    requestAnimationFrame(draw);
    if (now - lastFrame < 33) return;
    lastFrame = now;
    if (!nodes.length) return;
    if (alpha > 0.041) tick();
    else if (Math.floor(now / 33) % 3 === 0) tick();
    angle += 0.0006;

    let maxR = small ? 90 : 260;
    for (const n of nodes) maxR = Math.max(maxR, Math.abs(n.x), Math.abs(n.y));
    const scale = (Math.min(W, H) * 0.46) / maxR;
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = W / 2;
    const cy = H / 2 + 20;
    const px = (n) => cx + (n.x * cos - n.y * sin) * scale;
    const py = (n) => cy + (n.x * sin + n.y * cos) * scale;

    ctx.clearRect(0, 0, W, H);
    ctx.lineWidth = 0.6;
    ctx.strokeStyle = `rgba(${rgb}, ${small ? 0.22 : 0.09})`;
    ctx.beginPath();
    for (const [a, b] of links) {
      ctx.moveTo(px(nodes[a]), py(nodes[a]));
      ctx.lineTo(px(nodes[b]), py(nodes[b]));
    }
    ctx.stroke();

    const pulse = 0.5 + 0.5 * Math.sin(now / 300);
    for (const n of nodes) {
      const x = px(n);
      const y = py(n);
      const hi = highlighted.has(n.id);
      ctx.beginPath();
      ctx.arc(x, y, hi ? n.size + 3 + pulse * 2 : n.size, 0, Math.PI * 2);
      ctx.fillStyle = hi ? `rgba(${rgb}, 0.95)` : `rgba(${rgb}, ${(small ? 0.5 : 0.25) + Math.min(n.degree, 20) * 0.025})`;
      ctx.fill();
      if (small && !hi) {
        ctx.font = n.hub ? '11px Consolas, monospace' : '10px Consolas, monospace';
        ctx.fillStyle = `rgba(${rgb}, ${n.hub ? 0.75 : 0.5})`;
        ctx.fillText(n.title, x + n.size + 4, y + 3);
      }
      if (hi) {
        ctx.beginPath();
        ctx.arc(x, y, 14 + pulse * 6, 0, Math.PI * 2);
        ctx.strokeStyle = `rgba(${rgb}, ${0.5 - pulse * 0.3})`;
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.font = '11px Consolas, monospace';
        ctx.fillStyle = 'rgba(255,255,255,0.9)';
        ctx.fillText(n.title, x + 10, y - 8);
        ctx.lineWidth = 0.6;
      }
    }

    for (const [id, until] of highlighted) if (until < now) highlighted.delete(id);
  }

  window.MemGraph = {
    load,
    setColor(c) {
      rgb = c;
    },
    highlight(ids, ms = 20000) {
      const until = performance.now() + ms;
      for (const id of ids) highlighted.set(id, until);
    },
    kick() {
      alpha = Math.max(alpha, 0.4);
    },
  };

  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(draw);
})();
