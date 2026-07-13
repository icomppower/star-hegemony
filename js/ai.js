import { WORLD } from './fleet.js';

// 敵將人格 — 影響戰術傾向 (GDD: 將領人格系統)
export const COMMANDERS = {
  // 法爾肯・雷因哈特:完美主義天才,梯次防禦大師,過度自信
  reinhardt: {
    name: '法爾肯・雷因哈特',
    aggression: 0.6, pursueChance: 0.85, ambushPenaltyMult: 2,
    lightning: true, counters: true, standoff: 300,
    pursueLine: '雷因哈特下令全速追擊!「殲滅戰嘅機會嚟喇。」',
    seeThroughLine: '雷因哈特識破咗你嘅詐敗,艦隊按兵不動。',
  },
  // 卡西米爾・沃夫:中央突破專精,進攻狂,防守低
  wolf: {
    name: '卡西米爾・沃夫',
    aggression: 0.95, pursueChance: 0.55, ambushPenaltyMult: 1,
    lightning: false, counters: false, standoff: 140, favorite: 'breakthrough',
    pursueLine: '沃夫狂笑追擊:「逃?遲喇!」',
    seeThroughLine: '沃夫一時猶豫,冇咬鉤。',
  },
  // 駐防艦隊:保守,少戰術
  garrison: {
    name: '駐防艦隊司令',
    aggression: 0.3, pursueChance: 0.35, ambushPenaltyMult: 1,
    lightning: false, counters: false, standoff: 280, passive: true,
    pursueLine: '敵駐防艦隊離開陣位追擊!',
    seeThroughLine: '敵駐防艦隊堅守陣位,唔上當。',
  },
};

export class EnemyAI {
  constructor(fleet, commanderId = 'reinhardt') {
    this.fleet = fleet;
    this.id = commanderId;
    this.p = COMMANDERS[commanderId];
    fleet.ambushPenaltyMult = this.p.ambushPenaltyMult;
    this.decisionTimer = 2;
    this.pursuing = false;
    this.lightningUsed = false;
    this.pending = null; // {id, t} — 俾里昂嘅「戰術直覺」預警窗口
    this._feintJudged = false;
  }

  // 排程戰術:先觸發玩家直覺預警,2 秒後先發動
  schedule(id, game, announce) {
    this.pending = { id, t: 2, announce };
    game.onIntuition?.(id, this.p.name);
  }

  update(dt, player, game) {
    const f = this.fleet;
    if (f.routed || !f.aliveShips.length) return;

    // 排程中嘅戰術
    if (this.pending) {
      this.pending.t -= dt;
      if (this.pending.t <= 0) {
        const { id, announce } = this.pending;
        this.pending = null;
        if (f.activateTactic(id, game, player) && announce) game.log(announce, 'bad');
      }
      return;
    }

    this.decisionTimer -= dt;

    // 玩家詐敗:即時決定追唔追
    if (player.feint && player.feint.phase === 'bait' && !this._feintJudged) {
      this._feintJudged = true;
      if (Math.random() < this.p.pursueChance) {
        this.pursuing = true;
        game.log(this.p.pursueLine, 'warn');
      } else {
        this.pursuing = false;
        f.dest = { ...f.center() };
        game.log(this.p.seeThroughLine, 'bad');
      }
    }
    if (!player.feint) this._feintJudged = false;

    if (this.pursuing) {
      if (player.feint) {
        const pc = player.center();
        f.dest = { x: pc.x, y: pc.y };
        return;
      }
      this.pursuing = false;
    }

    // 電光戰法(雷因哈特限定):戰力跌穿 65% 清空冷卻
    if (this.p.lightning && !this.lightningUsed && f.strength() < 0.65) {
      this.lightningUsed = true;
      if (f.activeTactic) f.endTactic();
      f.cooldowns = {};
      this.decisionTimer = 0;
      game.log('⚡ 電光戰法!雷因哈特連續發動戰術!', 'bad');
    }

    if (this.decisionTimer > 0) return;
    this.decisionTimer = 4 + Math.random() * 2;

    const pc = player.center();
    const c = f.center();
    const d = Math.hypot(pc.x - c.x, pc.y - c.y);
    const strAdv = f.strength() / Math.max(0.05, player.strength());

    // 戰術選擇
    if (!f.activeTactic && !this.pending) {
      if (this.p.counters && player.activeTactic === 'breakthrough' && f.canActivate('pincer')) {
        this.schedule('pincer', game, '雷因哈特分兵兩翼,反包抄你嘅突破縱隊!');
        return;
      }
      if (this.p.counters && player.activeTactic === 'echelon' && f.canActivate('breakthrough') && d < 500) {
        this.schedule('breakthrough', game, '敵艦隊組成突破縱隊,直插你嘅防線中央!');
        return;
      }
      if (this.p.favorite === 'breakthrough' && d < 550 && Math.random() < 0.5 && f.canActivate('breakthrough')) {
        this.schedule('breakthrough', game, '沃夫全軍突擊:「撞散佢哋!」');
        return;
      }
      if (!this.p.passive && strAdv > 1.25 && d < 450 && Math.random() < 0.4 && f.canActivate('breakthrough')) {
        this.schedule('breakthrough', game, `${this.p.name}發動中央突破!`);
        return;
      }
    }

    // 移動決策
    const clampPt = (x, y) => ({
      x: Math.min(WORLD.w - WORLD.margin, Math.max(WORLD.margin, x)),
      y: Math.min(WORLD.h - WORLD.margin, Math.max(WORLD.margin, y)),
    });

    if (strAdv > 1.15 || this.p.aggression > Math.random()) {
      f.dest = clampPt(pc.x, pc.y);
    } else {
      const dx = c.x - pc.x, dy = c.y - pc.y;
      const len = Math.hypot(dx, dy) || 1;
      f.dest = clampPt(pc.x + dx / len * this.p.standoff, pc.y + dy / len * this.p.standoff);
    }
  }
}
