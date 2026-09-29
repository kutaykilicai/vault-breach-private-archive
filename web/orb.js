// Parçacık küresi: ajanın durumunu (beklemede / dinliyor / düşünüyor / çalışıyor / konuşuyor) gösterir.
(() => {
  const canvas = document.getElementById('orb');
  const ctx = canvas.getContext('2d');
  const S = canvas.width;
  const N = 700;
  const pts = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < N; i++) {
    const y = 1 - (i / (N - 1)) * 2;
    const r = Math.sqrt(1 - y * y);
    const t = golden * i;
    pts.push({ x: Math.cos(t) * r, y, z: Math.sin(t) * r, seed: Math.random() * Math.PI * 2 });
  }

  const PROFILES = {
    idle: { speed: 0.004, amp: 0.02, glow: 0.35 },
    listening: { speed: 0.008, amp: 0.08, glow: 0.7 },
    thinking: { speed: 0.02, amp: 0.05, glow: 0.6 },
    working: { speed: 0.03, amp: 0.1, glow: 0.8 },
    waiting: { speed: 0.006, amp: 0.04, glow: 0.5 },
    speaking: { speed: 0.012, amp: 0.14, glow: 0.9 },
  };
  let state = 'idle';
  let cur = { ...PROFILES.idle };
  let rot = 0;
  let rgb = '58, 160, 255';

  function frame(now) {
    requestAnimationFrame(frame);
    const target = PROFILES[state] || PROFILES.idle;
    for (const k of Object.keys(cur)) cur[k] += (target[k] - cur[k]) * 0.05;
    rot += cur.speed;
    ctx.clearRect(0, 0, S, S);

    const c = S / 2;
    const R = S * 0.3;
    const g = ctx.createRadialGradient(c, c, R * 0.1, c, c, R * 1.5);
    g.addColorStop(0, `rgba(${rgb}, ${cur.glow * 0.35})`);
    g.addColorStop(1, `rgba(${rgb}, 0)`);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, S, S);

    const cos = Math.cos(rot);
    const sin = Math.sin(rot);
    const tilt = 0.35;
    const ct = Math.cos(tilt);
    const st = Math.sin(tilt);
    const t = now / 1000;
    for (const p of pts) {
      const wobble = 1 + Math.sin(t * 3 + p.seed + p.y * 4) * cur.amp;
      let x = p.x * cos - p.z * sin;
      let z = p.x * sin + p.z * cos;
      let y = p.y * ct - z * st;
      z = p.y * st + z * ct;
      x *= wobble;
      y *= wobble;
      const depth = (z + 1) / 2;
      ctx.beginPath();
      ctx.arc(c + x * R, c + y * R, 0.6 + depth * 1.6, 0, Math.PI * 2);
      ctx.fillStyle = `rgba(${rgb}, ${0.15 + depth * 0.8})`;
      ctx.fill();
    }
  }

  window.Orb = {
    setState(s) {
      state = s;
    },
    setColor(c) {
      rgb = c;
    },
  };
  requestAnimationFrame(frame);
})();
