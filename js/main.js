import { Fleet, WORLD, SHIP_TYPES } from './fleet.js';
import { EnemyAI, COMMANDERS } from './ai.js';
import { UI } from './ui.js';
import { CampaignUI } from './campaign-ui.js';
import { initAudio, sfx, toggleMute } from './audio.js';
import { TACTIC_BY_ID, TACTICS } from './tactics.js';
import { OFFICER_MODS } from './roster.js';
import { loadCampaign } from './campaign.js';

const canvas = document.getElementById('game');
const ctx = canvas.getContext('2d');
canvas.width = WORLD.w;
canvas.height = WORLD.h;

const COLORS = {
  fed: '#5db1ff', fedDark: '#2a5f9e', fedGlow: 'rgba(93,177,255,',
  emp: '#ff6a55', empDark: '#a83a2c', empGlow: 'rgba(255,106,85,',
};

// ---------- 星空背景 ----------
const stars = [];
for (let i = 0; i < 160; i++) {
  stars.push({
    x: Math.random() * WORLD.w,
    y: Math.random() * WORLD.h,
    r: Math.random() * 1.6 + 0.3,
    a: Math.random() * 0.7 + 0.15,
    tw: Math.random() * 2 + 0.5,
  });
}

// ---------- 遊戲狀態 ----------
// state: title | campaign | battle | over | replay
const game = {
  state: 'title',
  time: 0,
  player: null,
  enemy: null,
  enemyAI: null,
  bolts: [], particles: [], mines: [],
  messages: [],
  moveMarker: null,
  shipsLost: 0, shipsKilled: 0,
  endTimer: 0,
  result: null,
  subvertUsed: false,
  retreating: 0,        // >0 = 撤退倒數
  defectQueue: [],
  mutinyAcc: 0,
  reyaTriggered: false,
  reyaDefected: false,
  rec: null,            // 戰史回放記錄

  log(text, cls) {
    this.messages.push({ text, cls, t: this.time });
    if (this.messages.length > 60) this.messages.shift();
  },

  spawnBolt(ship, target, dmg, fleet) {
    const speed = 460;
    const dx = target.x - ship.x, dy = target.y - ship.y;
    const d = Math.hypot(dx, dy) || 1;
    const ang = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.06;
    this.bolts.push({
      x: ship.x, y: ship.y,
      vx: Math.cos(ang) * speed, vy: Math.sin(ang) * speed,
      dmg, faction: fleet.faction,
      life: d / speed + 0.25,
      shooter: ship,
    });
    if (fleet.faction === 'fed') sfx('fire');
  },

  onAmbush(fleet, foe, penalty) {
    ui.banner('伏擊發動!', '#ffd166');
    sfx('ambush');
    this.log(`敵艦隊上釣!伏擊圈收攏,火力全開!(敵士氣 -${penalty})`, 'good');
    if (penalty > 12) this.log('雷因哈特嘅過度自信俾你利用咗——帝國艦隊士氣重挫!', 'good');
  },

  onFeintFail(fleet) {
    this.log('敵人冇追擊,詐敗撤退白做……艦隊重整旗鼓。', 'warn');
  },

  // 里昂・凱撒「戰術直覺」:敵方戰術發動前 2 秒預警
  onIntuition(id, commanderName) {
    const t = TACTIC_BY_ID[id];
    sfx('alarm');
    this.log(`⚡ 戰場嗅覺:敵艦隊陣型異動——${commanderName}想發動『${t.name}』!`, 'warn');
  },

  playerTactic(id) {
    if (this.state !== 'battle' || this.retreating) return;
    const ok = this.player.activateTactic(id, this, this.enemy);
    if (ok) {
      const t = TACTIC_BY_ID[id];
      ui.banner(t.name, '#5db1ff');
      this.log(`發動戰術:${t.name} ${t.en}`, 'good');
      if (id === 'feint') this.log('前鋒開始詐敗撤退……希望敵將上當。');
      if (id === 'decap') this.log('雷・莫拉萊斯突擊隊出擊,目標:敵旗艦!');
      if (id === 'scorch') this.log('艦隊後撤,沿路投放太空水雷。');
    }
  },

  // 艾莎・沃恩「策反」
  trySubvert() {
    if (this.state !== 'battle' || this.subvertUsed || this.retreating) return;
    this.subvertUsed = true;
    const candidates = this.enemy.aliveShips.filter(s => s.type !== 'flagship' && !s.fleeing);
    if (!candidates.length) { this.log('冇合適嘅策反目標。', 'warn'); return; }
    const target = candidates[Math.floor(Math.random() * candidates.length)];
    const chance = 0.35 + (this.enemy.morale < 50 ? 0.2 : 0);
    if (Math.random() < chance) {
      this.defectQueue.push(target);
      this.enemy.addMorale(-8);
      ui.banner('策反成功!', '#7dffb0');
      sfx('tactic');
      this.log(`🕵️ 艾莎嘅間諜網起效——敵${SHIP_TYPES[target.type].zh}降下帝國旗,轉投聯邦!(敵士氣 -8)`, 'good');
    } else {
      sfx('hit');
      this.log('🕵️ 策反失敗……目標艦長向政治部告發咗接頭人。艾莎:「條線斷咗。」', 'bad');
    }
  },

  // 撤退
  tryRetreat() {
    if (this.state !== 'battle' || this.retreating) return;
    this.retreating = 4;
    this.player.endTactic();
    this.player.dest = { x: 80, y: this.player.center().y };
    ui.banner('全艦隊撤退!', '#cfe3ff');
    this.log('打出撤退訊號——全艦隊邊打邊退!', 'warn');
  },
};

// ---------- 戰鬥 ----------
let battleCfg = null;

function quickCfg() {
  return {
    mode: 'quick',
    systemName: '賽勒斯星域遭遇戰',
    playerRoster: ['flagship', 'cruiser', 'cruiser', 'cruiser',
      'destroyer', 'destroyer', 'destroyer', 'destroyer', 'destroyer', 'destroyer',
      'frigate', 'frigate', 'frigate', 'frigate'],
    enemyRoster: ['flagship', 'cruiser', 'cruiser', 'cruiser', 'cruiser',
      'destroyer', 'destroyer', 'destroyer', 'destroyer', 'destroyer', 'destroyer',
      'frigate', 'frigate', 'frigate', 'frigate'],
    enemyCommander: 'reinhardt',
    playerMorale: 80, enemyMorale: 80,
    reyaPossible: true,
    onEnd: null,
  };
}

function startBattle(cfg) {
  battleCfg = cfg;
  game.state = 'battle';
  game.time = 0;
  game.bolts = []; game.particles = []; game.mines = [];
  game.messages = [];
  game.moveMarker = null;
  game.shipsLost = 0; game.shipsKilled = 0;
  game.endTimer = 0;
  game.result = null;
  game.subvertUsed = false;
  game.retreating = 0;
  game.defectQueue = [];
  game.mutinyAcc = 0;
  game.reyaTriggered = false;
  game.reyaDefected = false;

  game.player = new Fleet('fed', 300, WORLD.h / 2, cfg.playerRoster, '聯邦第13艦隊', OFFICER_MODS);
  game.enemy = new Fleet('emp', WORLD.w - 300, WORLD.h / 2, cfg.enemyRoster, '帝國艦隊');
  game.player.morale = cfg.playerMorale ?? 80;
  game.enemy.morale = cfg.enemyMorale ?? 80;
  game.enemy.formation = cfg.enemyCommander === 'wolf' ? 'line' : 'echelon';
  game.enemyAI = new EnemyAI(game.enemy, cfg.enemyCommander);

  // 蕾雅・達克:不穩定人格,座艦係其中一艘巡洋艦
  if (cfg.reyaPossible) {
    const cr = game.enemy.ships.find(s => s.type === 'cruiser');
    if (cr) cr.reya = true;
  }

  // 回放記錄器
  game.rec = { frames: [], booms: [], acc: 0, order: [...game.player.ships, ...game.enemy.ships] };

  const cmdr = COMMANDERS[cfg.enemyCommander];
  ui.setBattleInfo(cfg.systemName, cmdr.name);
  showScreen('battle');
  ui.banner(cfg.systemName, '#cfe3ff');
  game.log(`接敵!${cmdr.name}嘅艦隊出現。`);
  game.log('旗艦通訊:「凱撒指揮官,艦隊交俾你喇。」');
  if (cfg.lowSupplies) game.log('⚠️ 補給耗盡——艦隊士氣低落!', 'bad');
  if (cfg.ghostHelped) game.log('👻 偵測到傭兵「幽靈」嘅艦艇喺敵方編隊入面!', 'bad');
}

function showScreen(name) {
  document.getElementById('title-screen').classList.toggle('hidden', name !== 'title');
  document.getElementById('end-screen').classList.toggle('hidden', name !== 'end');
  if (name === 'battle' || name === 'end') ui.show(); else ui.hide();
  const ch = document.getElementById('campaign-hud');
  const sp = document.getElementById('system-panel');
  ch.classList.toggle('hidden', name !== 'campaign');
  sp.classList.toggle('hidden', name !== 'campaign');
  if (name === 'title') refreshTitleButtons();
}

function refreshTitleButtons() {
  document.getElementById('btn-continue').classList.toggle('hidden', !loadCampaign());
}

// ---------- 更新 ----------
function update(dt) {
  game.time += dt;
  const p = game.player, e = game.enemy;

  if (game.state === 'replay') { updateReplay(dt); return; }
  if (game.state === 'campaign' || !p) { return; }

  // 策反/嘩變執行 (喺艦隊更新之外處理,避免迭代中改陣容)
  while (game.defectQueue.length) {
    const ship = game.defectQueue.shift();
    if (ship.alive) {
      if (ship.reya) { game.reyaDefected = true; }
      p.adopt(ship, e);
    }
  }

  p.update(dt, e, game);
  e.update(dt, p, game);
  if (game.state === 'battle' && !game.retreating) game.enemyAI.update(dt, p, game);

  // 士氣崩潰 → 兵變逃亡 (每秒判定)
  game.mutinyAcc += dt;
  if (game.mutinyAcc >= 1) {
    game.mutinyAcc -= 1;
    if (game.state === 'battle') {
      checkMutiny(p, '我方');
      checkMutiny(e, '敵方');
      checkReya();
    }
  }

  // 撤退倒數
  if (game.retreating > 0 && game.state === 'battle') {
    game.retreating -= dt;
    p.dest = { x: 80, y: p.center().y };
    if (game.retreating <= 0) {
      game.state = 'over';
      game.result = { victory: false, retreated: true };
      game.endTimer = 1.2;
      ui.banner('撤退成功', '#cfe3ff');
      game.log('艦隊脫離戰場。', 'warn');
    }
  }

  // 炮火
  for (let i = game.bolts.length - 1; i >= 0; i--) {
    const b = game.bolts[i];
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    b.life -= dt;
    let hit = false;
    const targetFleet = b.faction === 'fed' ? e : p;
    const killerFleet = b.faction === 'fed' ? p : e;
    for (const s of targetFleet.aliveShips) {
      const r = s.stats.size + 4;
      if ((b.x - s.x) ** 2 + (b.y - s.y) ** 2 < r * r) {
        applyDamage(s, targetFleet, b.dmg * targetFleet.dmgInMult(s), killerFleet, b.shooter);
        spawnSparks(b.x, b.y, b.faction === 'fed' ? COLORS.fed : COLORS.emp, 4);
        hit = true;
        break;
      }
    }
    if (hit || b.life <= 0 || b.x < -20 || b.x > WORLD.w + 20 || b.y < -20 || b.y > WORLD.h + 20) {
      game.bolts.splice(i, 1);
    }
  }

  // 水雷
  for (let i = game.mines.length - 1; i >= 0; i--) {
    const m = game.mines[i];
    m.life -= dt;
    if (m.arm > 0) { m.arm -= dt; continue; }
    if (m.life <= 0) { game.mines.splice(i, 1); continue; }
    const targetFleet = m.faction === 'fed' ? e : p;
    const killerFleet = m.faction === 'fed' ? p : e;
    let boom = false;
    for (const s of targetFleet.aliveShips) {
      if ((m.x - s.x) ** 2 + (m.y - s.y) ** 2 < (s.stats.size + 10) ** 2) { boom = true; break; }
    }
    if (boom) {
      sfx('mine');
      spawnExplosion(m.x, m.y, 26, '#ffb347');
      for (const s2 of targetFleet.aliveShips) {
        const d = Math.hypot(m.x - s2.x, m.y - s2.y);
        if (d < 70) applyDamage(s2, targetFleet, 45 * (1 - d / 90), killerFleet, null);
      }
      game.mines.splice(i, 1);
    }
  }

  // 粒子
  for (let i = game.particles.length - 1; i >= 0; i--) {
    const pt = game.particles[i];
    pt.x += pt.vx * dt;
    pt.y += pt.vy * dt;
    pt.vx *= 0.97; pt.vy *= 0.97;
    pt.life -= dt;
    if (pt.life <= 0) game.particles.splice(i, 1);
  }

  // 回放記錄 (每 0.25s 一幀)
  if (game.rec && (game.state === 'battle' || game.state === 'over')) {
    game.rec.acc += dt;
    if (game.rec.acc >= 0.25) {
      game.rec.acc -= 0.25;
      game.rec.frames.push({
        t: game.time,
        ships: game.rec.order.map(s => ({
          x: Math.round(s.x), y: Math.round(s.y), a: +s.angle.toFixed(2),
          f: s.faction, ty: s.type, al: s.alive,
        })),
      });
    }
  }

  if (game.state === 'battle') checkVictory();
  if (game.state === 'over') {
    game.endTimer -= dt;
    if (game.endTimer <= 0 && document.getElementById('end-screen').classList.contains('hidden')) {
      showEndScreen();
    }
  }

  ui.update(dt);
}

function checkMutiny(fleet, label) {
  if (fleet.morale >= 20 || fleet.routed) return;
  for (const s of fleet.aliveShips) {
    if (s.type === 'flagship' || s.fleeing) continue;
    if (Math.random() < 0.03) {
      s.fleeing = true;
      game.log(`${label}士氣崩潰:一艘${SHIP_TYPES[s.type].zh}擅自脫離戰線!`, label === '我方' ? 'bad' : 'good');
      sfx('alarm');
    }
  }
}

// 蕾雅・達克:帝國士氣低迷時可能嘩變
function checkReya() {
  if (game.reyaTriggered) return;
  const reyaShip = game.enemy.aliveShips.find(s => s.reya && !s.fleeing);
  if (!reyaShip || game.enemy.morale >= 35) return;
  if (Math.random() < 0.12) {
    game.reyaTriggered = true;
    game.defectQueue.push(reyaShip);
    game.enemy.addMorale(-10);
    ui.banner('蕾雅・達克嘩變!', '#7dffb0');
    sfx('tactic');
    game.log('⚡ 敵新星艦長蕾雅・達克突然調轉炮口——佢嘅巡洋艦轉投聯邦!(敵士氣 -10)', 'good');
  }
}

function applyDamage(ship, fleet, dmg, killerFleet, shooter) {
  if (!ship.alive) return;
  ship.hp -= dmg;
  sfx('hit');
  if (ship.hp <= 0) {
    ship.hp = 0;
    const isFlag = ship.type === 'flagship';
    spawnExplosion(ship.x, ship.y, isFlag ? 60 : 24, fleet.faction === 'fed' ? COLORS.fed : COLORS.emp);
    sfx(isFlag ? 'bigboom' : 'boom');
    fleet.addMorale(isFlag ? -100 : -5);
    killerFleet.addMorale(2);
    if (shooter && shooter.alive) { shooter.xp++; shooter.kills++; }
    if (fleet.faction === 'fed') game.shipsLost++;
    else game.shipsKilled++;
    if (isFlag) {
      fleet.routed = true;
      game.log(fleet.faction === 'emp'
        ? '💥 敵旗艦擊沉!帝國艦隊全線潰散!'
        : '💥 我方旗艦被擊沉……艦隊指揮系統癱瘓!', fleet.faction === 'emp' ? 'good' : 'bad');
    } else if (fleet.faction === 'fed') {
      game.log(`我方${SHIP_TYPES[ship.type].zh}戰沉。`, 'warn');
    }
  }
}

function checkVictory() {
  const p = game.player, e = game.enemy;
  const pDead = p.routed || !p.aliveShips.length;
  const eDead = e.routed || !e.aliveShips.length;
  if (!pDead && !eDead) return;
  game.state = 'over';
  game.endTimer = 2.2;
  game.result = { victory: eDead && !pDead, retreated: false };
  if (game.result.victory) {
    ui.banner('勝利', '#ffd166');
    game.log('戰域確保。', 'good');
  } else {
    ui.banner('敗北', '#ff6a55');
    sfx('alarm');
    game.log('殘存艦艇向後方星域撤退……', 'bad');
  }
}

function collectResult() {
  return {
    victory: game.result.victory,
    retreated: !!game.result.retreated,
    kills: game.shipsKilled,
    losses: game.shipsLost,
    reyaDefected: game.reyaDefected,
    survivors: game.player.ships
      .filter(s => s.alive && !s.fleeing)
      .map(s => {
        const out = { type: s.type, hp: Math.round(s.hp), xp: s.xp, kills: s.kills };
        if (s.merc) { out.merc = true; out.expires = s.expires; }
        return out;
      }),
  };
}

function showEndScreen() {
  const el = document.getElementById('end-screen');
  const title = document.getElementById('end-title');
  const detail = document.getElementById('end-detail');
  const btnMain = document.getElementById('btn-restart');
  const mins = Math.floor(game.time / 60), secs = Math.floor(game.time % 60);
  const timeStr = `${mins}:${String(secs).padStart(2, '0')}`;
  const r = game.result;
  if (r.victory) {
    title.textContent = '勝 利';
    title.className = 'victory';
    detail.innerHTML = `${battleCfg.systemName} — 聯邦大捷<br>
      戰鬥時長 ${timeStr} · 擊沉敵艦 ${game.shipsKilled} · 我方損失 ${game.shipsLost}<br>
      「唔錯,凱撒指揮官。但戰爭仲未完。」`;
  } else if (r.retreated) {
    title.textContent = '撤 退';
    title.className = 'defeat';
    detail.innerHTML = `${battleCfg.systemName} — 有序撤退<br>
      戰鬥時長 ${timeStr} · 擊沉敵艦 ${game.shipsKilled} · 我方損失 ${game.shipsLost}<br>
      「留得青山在。」`;
  } else {
    title.textContent = '敗 北';
    title.className = 'defeat';
    detail.innerHTML = `${battleCfg.systemName} — 聯邦敗退<br>
      戰鬥時長 ${timeStr} · 擊沉敵艦 ${game.shipsKilled} · 我方損失 ${game.shipsLost}<br>
      「呢場輸咗,但戰爭先啱啱開始。」`;
  }
  btnMain.textContent = battleCfg.onEnd ? '🗺️ 返回星圖' : '🔄 再戰一場';
  el.classList.remove('hidden');
}

function endScreenContinue() {
  document.getElementById('end-screen').classList.add('hidden');
  if (battleCfg && battleCfg.onEnd) {
    const cb = battleCfg.onEnd;
    battleCfg.onEnd = null;
    cb(collectResult());
  } else {
    startBattle(quickCfg());
  }
}

// ---------- 戰史回放 ----------
let replayT = 0;
function startReplay() {
  if (!game.rec || game.rec.frames.length < 2) return;
  document.getElementById('end-screen').classList.add('hidden');
  ui.hide();
  game.state = 'replay';
  replayT = 0;
}
function updateReplay(dt) {
  replayT += dt * 3; // 3x 速度
  const frames = game.rec.frames;
  if (replayT >= frames[frames.length - 1].t) exitReplay();
}
function exitReplay() {
  game.state = 'over';
  ui.show();
  document.getElementById('end-screen').classList.remove('hidden');
}
function renderReplay() {
  const frames = game.rec.frames;
  let i = 0;
  while (i < frames.length - 2 && frames[i + 1].t <= replayT) i++;
  const a = frames[i], b = frames[Math.min(i + 1, frames.length - 1)];
  const span = Math.max(0.001, b.t - a.t);
  const k = Math.max(0, Math.min(1, (replayT - a.t) / span));

  for (let j = 0; j < a.ships.length; j++) {
    const s0 = a.ships[j], s1 = b.ships[j];
    if (!s0.al) continue;
    const x = s0.x + (s1.x - s0.x) * k;
    const y = s0.y + (s1.y - s0.y) * k;
    drawShipShape(x, y, s0.a, s0.ty, s0.f, false);
  }

  // 爆炸閃光
  for (const boom of game.rec.booms) {
    const age = replayT - boom.t;
    if (age < 0 || age > 0.6) continue;
    const r = (boom.big ? 46 : 22) * (age / 0.6 + 0.3);
    ctx.globalAlpha = 1 - age / 0.6;
    ctx.fillStyle = '#ffb347';
    ctx.beginPath();
    ctx.arc(boom.x, boom.y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
  }

  // 電影黑邊 + 標題 + 進度條
  ctx.fillStyle = 'rgba(0,0,0,.85)';
  ctx.fillRect(0, 0, WORLD.w, 70);
  ctx.fillRect(0, WORLD.h - 70, WORLD.w, 70);
  ctx.fillStyle = 'rgba(255,209,102,.9)';
  ctx.font = '22px "Noto Sans TC", sans-serif';
  ctx.textAlign = 'center';
  ctx.fillText(`📽️ 戰史回放 — ${battleCfg.systemName}(點擊退出)`, WORLD.w / 2, 44);
  const total = frames[frames.length - 1].t;
  ctx.fillStyle = 'rgba(255,255,255,.15)';
  ctx.fillRect(200, WORLD.h - 38, WORLD.w - 400, 6);
  ctx.fillStyle = 'rgba(255,209,102,.8)';
  ctx.fillRect(200, WORLD.h - 38, (WORLD.w - 400) * (replayT / total), 6);
  ctx.textAlign = 'left';
}

// ---------- 渲染 ----------
function render() {
  ctx.fillStyle = '#02040c';
  ctx.fillRect(0, 0, WORLD.w, WORLD.h);

  for (const s of stars) {
    const tw = 0.6 + 0.4 * Math.sin(game.time * s.tw + s.x);
    ctx.globalAlpha = s.a * tw;
    ctx.fillStyle = '#cfe3ff';
    ctx.fillRect(s.x, s.y, s.r, s.r);
  }
  ctx.globalAlpha = 1;

  if (game.state === 'campaign') { campaignUI.render(ctx, game.time); return; }
  if (game.state === 'replay') { renderReplay(); return; }
  if (!game.player) return;

  // 移動指示標記
  if (game.moveMarker && game.state === 'battle') {
    const m = game.moveMarker;
    const pulse = 1 + 0.25 * Math.sin(game.time * 6);
    ctx.strokeStyle = 'rgba(93,177,255,.6)';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 14 * pulse, 0, Math.PI * 2);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(m.x, m.y, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(93,177,255,.8)';
    ctx.fill();
  }

  // 水雷
  for (const m of game.mines) {
    const blink = m.arm > 0 ? 0.3 : 0.5 + 0.5 * Math.sin(game.time * 8);
    ctx.fillStyle = `rgba(255,179,71,${0.35 + blink * 0.5})`;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = `rgba(255,179,71,${0.25 * blink})`;
    ctx.beginPath();
    ctx.arc(m.x, m.y, 9, 0, Math.PI * 2);
    ctx.stroke();
  }

  // 炮火
  ctx.lineCap = 'round';
  for (const b of game.bolts) {
    const col = b.faction === 'fed' ? COLORS.fedGlow : COLORS.empGlow;
    const len = 14;
    const d = Math.hypot(b.vx, b.vy) || 1;
    const nx = b.vx / d, ny = b.vy / d;
    ctx.strokeStyle = col + '0.9)';
    ctx.lineWidth = 2.4;
    ctx.beginPath();
    ctx.moveTo(b.x - nx * len, b.y - ny * len);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
    ctx.strokeStyle = col + '0.3)';
    ctx.lineWidth = 5;
    ctx.beginPath();
    ctx.moveTo(b.x - nx * len * 0.7, b.y - ny * len * 0.7);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  drawFleet(game.player);
  drawFleet(game.enemy);

  for (const p of game.particles) {
    ctx.globalAlpha = Math.max(0, p.life / p.maxLife);
    ctx.fillStyle = p.color;
    ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
  }
  ctx.globalAlpha = 1;
}

function drawShipShape(x, y, angle, type, faction, engine) {
  const isFed = faction === 'fed';
  const body = isFed ? COLORS.fed : COLORS.emp;
  const dark = isFed ? COLORS.fedDark : COLORS.empDark;
  const sz = SHIP_TYPES[type].size;
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.fillStyle = dark;
  ctx.strokeStyle = body;
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  if (type === 'flagship') {
    ctx.moveTo(sz * 1.2, 0);
    ctx.lineTo(sz * 0.2, -sz * 0.65);
    ctx.lineTo(-sz * 0.9, -sz * 0.45);
    ctx.lineTo(-sz * 0.9, sz * 0.45);
    ctx.lineTo(sz * 0.2, sz * 0.65);
  } else {
    ctx.moveTo(sz * 1.3, 0);
    ctx.lineTo(-sz * 0.8, -sz * 0.7);
    ctx.lineTo(-sz * 0.4, 0);
    ctx.lineTo(-sz * 0.8, sz * 0.7);
  }
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

function drawFleet(fleet) {
  const isFed = fleet.faction === 'fed';
  const glow = isFed ? COLORS.fedGlow : COLORS.empGlow;

  for (const s of fleet.ships) {
    if (!s.alive) continue;
    const sz = s.stats.size;

    // 引擎光尾
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.rotate(s.angle);
    ctx.fillStyle = glow + '0.35)';
    ctx.beginPath();
    ctx.moveTo(-sz * 0.9, -sz * 0.3);
    ctx.lineTo(-sz * (1.6 + 0.3 * Math.sin(game.time * 20 + s.id)), 0);
    ctx.lineTo(-sz * 0.9, sz * 0.3);
    ctx.fill();
    ctx.restore();

    drawShipShape(s.x, s.y, s.angle, s.type, s.faction, true);

    // 旗艦光環
    if (s.type === 'flagship') {
      ctx.strokeStyle = glow + `${0.35 + 0.2 * Math.sin(game.time * 3)})`;
      ctx.beginPath();
      ctx.arc(s.x, s.y, sz * 1.8, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 突擊隊標記
    if (s.strike) {
      ctx.strokeStyle = 'rgba(255,209,102,.8)';
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.arc(s.x, s.y, sz + 5, 0, Math.PI * 2);
      ctx.stroke();
    }
    // 傭兵骷髏標記
    if (s.merc) {
      ctx.fillStyle = 'rgba(255,255,255,.7)';
      ctx.font = '9px sans-serif';
      ctx.fillText('☠', s.x + sz, s.y - sz);
    }
    // 老兵軍階 (擊殺章)
    if (s.level > 0) {
      ctx.fillStyle = '#ffd166';
      for (let l = 0; l < s.level; l++) {
        ctx.fillRect(s.x - 6 + l * 5, s.y - sz - 15, 3, 3);
      }
    }
    // HP 條
    if (s.hp < s.maxHp) {
      const w = sz * 2.2;
      const pct = s.hp / s.maxHp;
      ctx.fillStyle = 'rgba(0,0,0,.5)';
      ctx.fillRect(s.x - w / 2, s.y - sz - 9, w, 3);
      ctx.fillStyle = pct > 0.5 ? '#7dffb0' : pct > 0.25 ? '#ffd166' : '#ff6a55';
      ctx.fillRect(s.x - w / 2, s.y - sz - 9, w * pct, 3);
    }
  }
}

function spawnSparks(x, y, color, n) {
  for (let i = 0; i < n; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 40 + Math.random() * 90;
    game.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0.3 + Math.random() * 0.3, maxLife: 0.6,
      size: 2, color,
    });
  }
}

function spawnExplosion(x, y, size, color) {
  if (game.rec) game.rec.booms.push({ t: game.time, x, y, big: size > 40 });
  for (let i = 0; i < size; i++) {
    const a = Math.random() * Math.PI * 2;
    const v = 30 + Math.random() * size * 6;
    game.particles.push({
      x, y, vx: Math.cos(a) * v, vy: Math.sin(a) * v,
      life: 0.4 + Math.random() * 0.7, maxLife: 1.1,
      size: 2 + Math.random() * 3,
      color: Math.random() < 0.5 ? '#ffb347' : color,
    });
  }
}

// ---------- 輸入 ----------
function canvasToWorld(e) {
  const rect = canvas.getBoundingClientRect();
  const scale = Math.min(rect.width / WORLD.w, rect.height / WORLD.h);
  const ox = (rect.width - WORLD.w * scale) / 2;
  const oy = (rect.height - WORLD.h * scale) / 2;
  return {
    x: (e.clientX - rect.left - ox) / scale,
    y: (e.clientY - rect.top - oy) / scale,
  };
}

canvas.addEventListener('pointerdown', e => {
  const pt = canvasToWorld(e);
  if (game.state === 'replay') { exitReplay(); return; }
  if (game.state === 'campaign') { campaignUI.onClick(pt); return; }
  if (game.state !== 'battle') return;
  if (pt.x < 0 || pt.x > WORLD.w || pt.y < 0 || pt.y > WORLD.h) return;
  if (game.retreating) return;
  if (game.player.feint || game.player.scorching) {
    game.log('戰術執行中,暫時無法改變航向。', 'warn');
    return;
  }
  game.player.dest = { x: pt.x, y: pt.y };
  game.moveMarker = { x: pt.x, y: pt.y };
});

window.addEventListener('keydown', e => {
  if (e.repeat) return;
  if (e.key === 'm' || e.key === 'M') {
    const muted = toggleMute();
    game.log(muted ? '🔇 靜音' : '🔊 音效開啟');
    return;
  }
  if (game.state === 'replay') { exitReplay(); return; }
  if (game.state === 'title' && e.key === 'Enter') { beginCampaign(); return; }
  if (game.state === 'over' && (e.key === 'r' || e.key === 'R' || e.key === 'Enter')) { endScreenContinue(); return; }
  if (game.state === 'battle') {
    if (e.key === '7') { game.trySubvert(); return; }
    if (e.key === '8') { game.tryRetreat(); return; }
    const t = TACTICS.find(t => t.key === e.key);
    if (t) game.playerTactic(t.id);
  }
});

function beginCampaign() { initAudio(); campaignUI.startNew(); }

document.getElementById('btn-campaign').addEventListener('click', beginCampaign);
document.getElementById('btn-continue').addEventListener('click', () => { initAudio(); campaignUI.continue(); });
document.getElementById('btn-quick').addEventListener('click', () => { initAudio(); startBattle(quickCfg()); });
document.getElementById('btn-restart').addEventListener('click', () => { initAudio(); endScreenContinue(); });
document.getElementById('btn-replay').addEventListener('click', startReplay);

// ---------- Debug: ?auto=1&tactic=pincer&speed=8 自動開戰 (headless 測試用) ----------
const params = new URLSearchParams(location.search);
const DEBUG = params.has('auto');
const TIME_SCALE = Math.max(1, Number(params.get('speed')) || 1);
if (DEBUG) {
  const origLog = game.log.bind(game);
  game.log = (text, cls) => { origLog(text, cls); console.log(`[game] ${text}`); };
  setTimeout(() => {
    if (params.get('mode') === 'campaign') { campaignUI.startNew(); }
    else {
      startBattle(quickCfg());
      const tac = params.get('tactic');
      if (tac) setTimeout(() => game.playerTactic(tac), 2500);
    }
    setInterval(() => {
      if (game.player) console.log(`[state] t=${game.time.toFixed(1)} state=${game.state} fed=${game.player.aliveShips.length} emp=${game.enemy.aliveShips.length} result=${JSON.stringify(game.result)}`);
      else console.log(`[state] state=${game.state}`);
    }, 3000);
  }, 100);
}
window.__game = game;

// ---------- 主迴圈 ----------
const ui = new UI(game);
const campaignUI = new CampaignUI(game, { startBattle, showScreen });
window.__campaign = campaignUI;

showScreen('title');

let last = performance.now();
function loop(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  if (game.state !== 'title') {
    for (let i = 0; i < TIME_SCALE; i++) update(dt);
  }
  render();
  requestAnimationFrame(loop);
}
requestAnimationFrame(loop);
