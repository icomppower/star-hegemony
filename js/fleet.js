import { TACTIC_BY_ID } from './tactics.js';
import { sfx } from './audio.js';

export const WORLD = { w: 1600, h: 900, margin: 40 };

export const SHIP_TYPES = {
  flagship:  { hp: 800, speed: 55,  range: 270, dmg: 12,  fr: 0.9, size: 16, zh: '旗艦' },
  cruiser:   { hp: 340, speed: 72,  range: 230, dmg: 8,   fr: 1.3, size: 11, zh: '巡洋艦' },
  destroyer: { hp: 200, speed: 95,  range: 190, dmg: 5,   fr: 1.9, size: 8,  zh: '驅逐艦' },
  frigate:   { hp: 120, speed: 120, range: 160, dmg: 3.5, fr: 2.6, size: 6,  zh: '護衛艦' },
};

const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

let shipSeq = 0;

export class Ship {
  constructor(faction, type, x, y) {
    this.id = ++shipSeq;
    this.faction = faction;
    this.type = type;
    const t = SHIP_TYPES[type];
    this.hp = t.hp;
    this.maxHp = t.hp;
    this.x = x; this.y = y;
    this.angle = faction === 'fed' ? 0 : Math.PI;
    this.cool = Math.random() * 1.2;
    this.slot = { x, y };
    this.strike = false;     // 斬首突擊隊成員
    this.wing = 0;           // 鉗形夾擊分翼 (0 = 主隊, 1/2 = 左右翼)
    this.xp = 0;             // 老兵經驗 (擊殺累積)
    this.kills = 0;
    this.merc = false;       // 傭兵
    this.reya = false;       // 蕾雅・達克座艦
    this.fleeing = false;    // 兵變逃亡中
    this.fled = false;       // 已逃離戰場
  }
  get alive() { return this.hp > 0 && !this.fled; }
  get level() { return Math.min(3, Math.floor(this.xp / 2)); }
  get stats() { return SHIP_TYPES[this.type]; }
}

// 陣型 slot 產生器 — 本地座標 (x 沿 heading 向前, y 橫向)
function formationSlots(n, formation) {
  const slots = [];
  if (formation === 'column') {
    for (let i = 0; i < n; i++) {
      slots.push({ x: -Math.floor(i / 2) * 42, y: (i % 2 === 0 ? -1 : 1) * 16 });
    }
  } else if (formation === 'echelon') {
    for (let i = 0; i < n; i++) {
      const k = i - (n - 1) / 2;
      slots.push({ x: -Math.abs(k) * 34, y: k * 46 });
    }
  } else { // line — 每排 6 隻,橫向展開
    const perRow = 6;
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow);
      const inRow = Math.min(perRow, n - row * perRow);
      const col = i % perRow;
      slots.push({ x: -row * 58, y: (col - (inRow - 1) / 2) * 52 });
    }
  }
  // 中央 slot 排前 — 旗艦/主力艦優先攞中間位
  return slots.sort((a, b) => (Math.abs(a.y) + Math.abs(a.x) * 0.3) - (Math.abs(b.y) + Math.abs(b.x) * 0.3));
}

const TYPE_PRIORITY = { flagship: 0, cruiser: 1, destroyer: 2, frigate: 3 };

export class Fleet {
  // roster 項可以係 'cruiser' 字串,或者 {type, hp, xp, kills, merc, expires} 物件 (戰役層帶傷/帶經驗上陣)
  constructor(faction, x, y, roster, name, mods = {}) {
    this.faction = faction;
    this.name = name;
    this.mods = Object.assign({
      echelonIn: 0.65, echelonCdMult: 1,
      strikeOut: 1.5, strikeIn: 1.5, strikeSpeed: 1.25,
    }, mods);
    this.ships = roster.map(entry => {
      const e = typeof entry === 'string' ? { type: entry } : entry;
      const jx = (Math.random() - 0.5) * 120, jy = (Math.random() - 0.5) * 200;
      const s = new Ship(faction, e.type, x + jx, y + jy);
      if (e.hp != null) s.hp = Math.max(1, Math.min(s.maxHp, e.hp));
      s.xp = e.xp || 0;
      s.kills = e.kills || 0;
      s.merc = !!e.merc;
      if (e.expires != null) s.expires = e.expires;
      return s;
    });
    this.anchor = { x, y };
    this.dest = { x, y };
    this.heading = faction === 'fed' ? 0 : Math.PI;
    this.formation = 'line';
    this.morale = 80;
    this.activeTactic = null;
    this.tacticTimer = 0;
    this.cooldowns = {};
    this.wings = null;       // 鉗形: [{anchor, waypoints, ships}]
    this.feint = null;       // 誘敵: {phase:'bait'|'ambush', startFoeDist}
    this.scorching = false;
    this.mineTimer = 0;
    this.routed = false;
  }

  get aliveShips() { return this.ships.filter(s => s.alive); }
  get flagship() { return this.ships.find(s => s.type === 'flagship'); }

  strength() {
    let hp = 0, max = 0;
    for (const s of this.ships) { hp += Math.max(0, s.hp); max += s.maxHp; }
    return hp / max;
  }

  center() {
    const alive = this.aliveShips;
    if (!alive.length) return { ...this.anchor };
    let x = 0, y = 0;
    for (const s of alive) { x += s.x; y += s.y; }
    return { x: x / alive.length, y: y / alive.length };
  }

  // ---------- 士氣 ----------
  moraleMult() { return 0.55 + (this.morale / 100) * 0.6; }
  addMorale(d) { this.morale = clamp(this.morale + d, 10, 100); }

  // ---------- 策反/嘩變:艦艇轉投呢支艦隊 ----------
  adopt(ship, foe) {
    const i = foe.ships.indexOf(ship);
    if (i >= 0) foe.ships.splice(i, 1);
    if (foe.wings) for (const w of foe.wings) {
      const j = w.ships.indexOf(ship);
      if (j >= 0) w.ships.splice(j, 1);
    }
    ship.faction = this.faction;
    ship.wing = 0;
    ship.strike = false;
    ship.fleeing = false;
    this.ships.push(ship);
  }

  // ---------- 傷害加成 ----------
  dmgOutMult(ship) {
    let m = this.moraleMult();
    m *= 1 + ship.level * 0.08; // 老兵加成
    if (this.activeTactic === 'breakthrough') m *= 1.25;
    if (this.activeTactic === 'pincer' && this._crossfire) m *= 1.3;
    if (this.feint) m *= this.feint.phase === 'ambush' ? 1.6 : 0.5;
    if (ship.strike) m *= this.mods.strikeOut;
    return m;
  }
  dmgInMult(ship) {
    let m = 1;
    if (this.activeTactic === 'breakthrough') m *= 1.25;
    if (this.activeTactic === 'echelon') m *= this.mods.echelonIn;
    if (ship.strike) m *= this.mods.strikeIn;
    return m;
  }
  speedMult() {
    if (this.activeTactic === 'breakthrough') return 1.4;
    if (this.activeTactic === 'echelon') return 0.6;
    if (this.feint || this.scorching) return 1.15;
    return 1;
  }

  // ---------- 戰術 ----------
  canActivate(id) {
    return !this.activeTactic && (this.cooldowns[id] || 0) <= 0 && !this.routed;
  }

  activateTactic(id, game, foe) {
    if (!this.canActivate(id)) return false;
    const t = TACTIC_BY_ID[id];
    this.activeTactic = id;
    this.tacticTimer = t.dur;
    const isPlayer = this.faction === 'fed';
    if (isPlayer) sfx('tactic');

    switch (id) {
      case 'breakthrough': {
        this.formation = 'column';
        const fc = foe.center();
        this.dest = { x: fc.x, y: fc.y };
        break;
      }
      case 'pincer': {
        const alive = this.aliveShips.filter(s => s.type !== 'flagship');
        const fc = foe.center();
        const c = this.center();
        const dx = fc.x - c.x, dy = fc.y - c.y;
        const len = Math.hypot(dx, dy) || 1;
        const px = -dy / len, py = dx / len; // 垂直方向
        this.wings = [1, 2].map(w => {
          const sign = w === 1 ? 1 : -1;
          return {
            anchor: { x: c.x + px * sign * 120, y: c.y + py * sign * 120 },
            waypoints: [
              { x: clamp(fc.x + px * sign * 320 - dx / len * 120, WORLD.margin, WORLD.w - WORLD.margin),
                y: clamp(fc.y + py * sign * 320 - dy / len * 120, WORLD.margin, WORLD.h - WORLD.margin) },
              { x: fc.x, y: fc.y },
            ],
            ships: [],
          };
        });
        alive.forEach((s, i) => {
          const w = (i % 2) + 1;
          s.wing = w;
          this.wings[w - 1].ships.push(s);
        });
        break;
      }
      case 'feint': {
        const fc = foe.center();
        const c = this.center();
        const dx = c.x - fc.x, dy = c.y - fc.y;
        const len = Math.hypot(dx, dy) || 1;
        this.dest = {
          x: clamp(c.x + dx / len * 480, WORLD.margin, WORLD.w - WORLD.margin),
          y: clamp(c.y + dy / len * 480, WORLD.margin, WORLD.h - WORLD.margin),
        };
        this.feint = { phase: 'bait', t: 5, startFoeDist: dist(c, fc) };
        break;
      }
      case 'echelon':
        this.formation = 'echelon';
        break;
      case 'decap': {
        const runners = this.aliveShips
          .filter(s => s.type !== 'flagship')
          .sort((a, b) => b.stats.speed - a.stats.speed)
          .slice(0, 3);
        runners.forEach(s => { s.strike = true; });
        break;
      }
      case 'scorch': {
        const fc = foe.center();
        const c = this.center();
        const dx = c.x - fc.x, dy = c.y - fc.y;
        const len = Math.hypot(dx, dy) || 1;
        this.dest = {
          x: clamp(c.x + dx / len * 520, WORLD.margin, WORLD.w - WORLD.margin),
          y: clamp(c.y + dy / len * 520, WORLD.margin, WORLD.h - WORLD.margin),
        };
        this.scorching = true;
        this.mineTimer = 0;
        break;
      }
    }
    return true;
  }

  endTactic() {
    const id = this.activeTactic;
    if (!id) return;
    this.cooldowns[id] = TACTIC_BY_ID[id].cd * (id === 'echelon' ? this.mods.echelonCdMult : 1);
    this.activeTactic = null;
    this.tacticTimer = 0;
    this.formation = this.faction === 'emp' ? 'echelon' : 'line';
    this.feint = null;
    this.scorching = false;
    if (this.wings) {
      for (const s of this.ships) s.wing = 0;
      this.wings = null;
      const c = this.center();
      this.anchor = { x: c.x, y: c.y };
    }
    for (const s of this.ships) s.strike = false;
  }

  // ---------- 每幀更新 ----------
  update(dt, foe, game) {
    // 冷卻
    for (const k of Object.keys(this.cooldowns)) {
      this.cooldowns[k] = Math.max(0, this.cooldowns[k] - dt);
    }

    // 戰術倒數
    if (this.activeTactic) {
      this.tacticTimer -= dt;
      if (this.tacticTimer <= 0) this.endTactic();
    }

    // 誘敵深入判定
    if (this.feint && this.feint.phase === 'bait') {
      this.feint.t -= dt;
      if (this.feint.t <= 0) {
        const foeDist = dist(this.center(), foe.center());
        if (foeDist < this.feint.startFoeDist - 50) {
          // 敵人上釣 — 反轉伏擊
          this.feint.phase = 'ambush';
          this.tacticTimer = 8;
          const fc = foe.center();
          this.dest = { x: fc.x, y: fc.y };
          const penalty = foe.ambushPenaltyMult ? 12 * foe.ambushPenaltyMult : 12;
          foe.addMorale(-penalty);
          this.addMorale(8);
          game.onAmbush(this, foe, penalty);
        } else {
          game.onFeintFail(this);
          this.endTactic();
        }
      }
    }

    // 焦土佈雷
    if (this.scorching) {
      this.mineTimer -= dt;
      if (this.mineTimer <= 0) {
        this.mineTimer = 0.9;
        const rear = this.aliveShips;
        if (rear.length) {
          const s = rear[Math.floor(Math.random() * rear.length)];
          game.mines.push({ x: s.x, y: s.y, faction: this.faction, life: 30, arm: 0.8 });
        }
      }
    }

    this.moveAnchorsAndSlots(dt, foe);
    this.updateShips(dt, foe, game);

    // 鉗形交叉火網判定:兩翼都有艦接敵
    if (this.activeTactic === 'pincer' && this.wings) {
      this._crossfire = this.wings.every(w =>
        w.ships.some(s => s.alive && foe.aliveShips.some(f => dist(s, f) < s.stats.range))
      );
    } else {
      this._crossfire = false;
    }
  }

  moveAnchorsAndSlots(dt, foe) {
    const spd = 62 * this.speedMult();

    const moveToward = (pt, target, speed) => {
      const dx = target.x - pt.x, dy = target.y - pt.y;
      const d = Math.hypot(dx, dy);
      if (d < 2) return false;
      const step = Math.min(d, speed * dt);
      pt.x += dx / d * step;
      pt.y += dy / d * step;
      return true;
    };

    // 主錨點
    const moving = moveToward(this.anchor, this.dest, spd);
    const fc = foe.center();
    if (moving) {
      this.heading = Math.atan2(this.dest.y - this.anchor.y, this.dest.x - this.anchor.x);
      // 詐敗/焦土時船頭照舊向前逃,唔使轉頭
    } else if (foe.aliveShips.length) {
      this.heading = Math.atan2(fc.y - this.anchor.y, fc.x - this.anchor.x);
    }

    // 分翼錨點 (鉗形)
    if (this.wings) {
      for (const w of this.wings) {
        if (!w.waypoints.length) continue;
        const wp = w.waypoints[0];
        if (!moveToward(w.anchor, wp, 82)) w.waypoints.shift();
      }
    }

    // 指派 slot — 旗艦有專屬後方受保護位,其餘按艦種排前
    const assign = (ships, anchor, heading, formation) => {
      const cos = Math.cos(heading), sin = Math.sin(heading);
      const flag = ships.find(s => s.type === 'flagship');
      const rest = (flag ? ships.filter(s => s !== flag) : [...ships])
        .sort((a, b) => TYPE_PRIORITY[a.type] - TYPE_PRIORITY[b.type]);
      const slots = formationSlots(rest.length, formation);
      let ordered = rest;
      if (flag) {
        const minX = slots.length ? Math.min(...slots.map(o => o.x)) : 0;
        slots.unshift({ x: minX - 60, y: 0 }); // 旗艦:全陣型最後方中央
        ordered = [flag, ...rest];
      }
      ordered.forEach((s, i) => {
        const o = slots[i];
        s.slot.x = clamp(anchor.x + cos * o.x - sin * o.y, WORLD.margin, WORLD.w - WORLD.margin);
        s.slot.y = clamp(anchor.y + sin * o.x + cos * o.y, WORLD.margin, WORLD.h - WORLD.margin);
      });
    };

    if (this.wings) {
      const mains = this.aliveShips.filter(s => s.wing === 0 && !s.strike && !s.fleeing);
      assign(mains, this.anchor, this.heading, 'line');
      this.wings.forEach(w => {
        const alive = w.ships.filter(s => s.alive && !s.strike && !s.fleeing);
        const wpt = w.waypoints[0] || fc;
        const h = Math.atan2(wpt.y - w.anchor.y, wpt.x - w.anchor.x);
        assign(alive, w.anchor, h, 'line');
      });
    } else {
      assign(this.aliveShips.filter(s => !s.strike && !s.fleeing), this.anchor, this.heading, this.formation);
    }
  }

  updateShips(dt, foe, game) {
    const frMult = this.moraleMult();
    const foeAlive = foe.aliveShips;
    const foeFlag = foe.flagship;
    const fc = foe.center();

    for (const s of this.ships) {
      if (!s.alive) continue;
      const st = s.stats;

      // 兵變逃亡:直奔己方後方邊界,唔開火
      if (s.fleeing) {
        const fx = this.faction === 'fed' ? -100 : WORLD.w + 100;
        const dxf = fx - s.x;
        s.x += Math.sign(dxf) * st.speed * 1.2 * dt;
        s.angle = lerpAngle(s.angle, Math.atan2(0, dxf), 4 * dt);
        if (s.x < -80 || s.x > WORLD.w + 80) s.fled = true;
        continue;
      }

      // 移動:突擊隊直取旗艦,其他歸位
      let tx = s.slot.x, ty = s.slot.y;
      if (s.strike && foeFlag && foeFlag.alive) {
        const standoff = st.range * 0.7;
        const d = dist(s, foeFlag);
        if (d > standoff) { tx = foeFlag.x; ty = foeFlag.y; }
        else { tx = s.x; ty = s.y; }
      }
      const dx = tx - s.x, dy = ty - s.y;
      const d = Math.hypot(dx, dy);
      if (d > 3) {
        const spd = st.speed * (s.strike ? this.mods.strikeSpeed : 1);
        const step = Math.min(d, spd * dt);
        s.x += dx / d * step;
        s.y += dy / d * step;
        s.angle = lerpAngle(s.angle, Math.atan2(dy, dx), 6 * dt);
      } else if (foeAlive.length) {
        s.angle = lerpAngle(s.angle, Math.atan2(fc.y - s.y, fc.x - s.x), 3 * dt);
      }

      // 開火
      s.cool -= dt * frMult;
      if (s.cool <= 0 && !this.routed) {
        let target = null;
        if (s.strike && foeFlag && foeFlag.alive) {
          if (dist(s, foeFlag) <= st.range) target = foeFlag;
        } else if (this.activeTactic === 'breakthrough') {
          // 集中火力:打最接近敵陣中心嘅艦
          let best = Infinity;
          for (const f of foeAlive) {
            const dd = dist(s, f);
            if (dd <= st.range) {
              const score = dist(f, fc);
              if (score < best) { best = score; target = f; }
            }
          }
        } else {
          let best = Infinity;
          for (const f of foeAlive) {
            const dd = dist(s, f);
            if (dd <= st.range && dd < best) { best = dd; target = f; }
          }
        }
        if (target) {
          s.cool = 1 / st.fr;
          game.spawnBolt(s, target, st.dmg * this.dmgOutMult(s), this);
        }
      }
    }
  }
}

function lerpAngle(a, b, t) {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * Math.min(1, t);
}
