// Web Audio 合成音效 — 零外部資源
let ctx = null;
let master = null;
let muted = false;
let lastFire = 0;

export function initAudio() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();
  master = ctx.createGain();
  master.gain.value = 0.5;
  master.connect(ctx.destination);
}

export function toggleMute() {
  muted = !muted;
  if (master) master.gain.value = muted ? 0 : 0.5;
  return muted;
}

function env(gainNode, t, attack, peak, decay) {
  gainNode.gain.setValueAtTime(0, t);
  gainNode.gain.linearRampToValueAtTime(peak, t + attack);
  gainNode.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
}

function osc(type, freq, endFreq, attack, peak, decay) {
  const t = ctx.currentTime;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq) o.frequency.exponentialRampToValueAtTime(endFreq, t + attack + decay);
  env(g, t, attack, peak, decay);
  o.connect(g); g.connect(master);
  o.start(t); o.stop(t + attack + decay + 0.05);
}

function noise(attack, peak, decay, filterFreq) {
  const t = ctx.currentTime;
  const len = Math.ceil(ctx.sampleRate * (attack + decay));
  const buf = ctx.createBuffer(1, len, ctx.sampleRate);
  const data = buf.getChannelData(0);
  for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
  const src = ctx.createBufferSource();
  src.buffer = buf;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.setValueAtTime(filterFreq, t);
  f.frequency.exponentialRampToValueAtTime(Math.max(80, filterFreq * 0.15), t + attack + decay);
  const g = ctx.createGain();
  env(g, t, attack, peak, decay);
  src.connect(f); f.connect(g); g.connect(master);
  src.start(t);
}

export function sfx(name) {
  if (!ctx || muted) return;
  switch (name) {
    case 'fire': {
      const now = performance.now();
      if (now - lastFire < 70) return; // 避免密集開火時炒耳
      lastFire = now;
      osc('square', 880 + Math.random() * 240, 220, 0.005, 0.06, 0.08);
      break;
    }
    case 'hit':
      osc('triangle', 320, 90, 0.004, 0.09, 0.09);
      break;
    case 'boom':
      noise(0.01, 0.5, 0.5, 900);
      osc('sine', 110, 35, 0.01, 0.35, 0.45);
      break;
    case 'bigboom':
      noise(0.02, 0.8, 1.2, 600);
      osc('sine', 70, 24, 0.02, 0.5, 1.1);
      break;
    case 'tactic':
      osc('sawtooth', 220, 660, 0.05, 0.16, 0.28);
      osc('sine', 440, 880, 0.05, 0.1, 0.25);
      break;
    case 'ambush':
      osc('sawtooth', 130, 520, 0.08, 0.3, 0.5);
      noise(0.02, 0.2, 0.35, 1400);
      break;
    case 'mine':
      noise(0.008, 0.4, 0.3, 1200);
      osc('sine', 160, 50, 0.008, 0.25, 0.28);
      break;
    case 'alarm':
      osc('square', 440, 440, 0.02, 0.12, 0.18);
      setTimeout(() => ctx && !muted && osc('square', 350, 350, 0.02, 0.12, 0.22), 180);
      break;
  }
}
