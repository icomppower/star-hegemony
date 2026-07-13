import { TACTICS } from './tactics.js';

// 特殊指令按鈕 (戰術以外)
export const SPECIALS = [
  { id: 'subvert', key: '7', icon: '🕵️', name: '策反',
    tip: '艾莎・沃恩:嘗試策反一艘敵艦轉投聯邦(每場戰鬥一次,成功率受敵方士氣影響)' },
  { id: 'retreat', key: '8', icon: '🏳️', name: '撤退',
    tip: '全艦隊脫離戰鬥。戰役模式中殘存艦艇會保留,議會支持度小扣' },
];

export class UI {
  constructor(game) {
    this.game = game;
    this.hud = document.getElementById('hud');
    this.logEl = document.getElementById('log');
    this.bannerEl = document.getElementById('banner');
    this.bannerTimer = 0;
    this.buttons = {};
    this.buildTacticBar();
  }

  buildTacticBar() {
    const bar = document.getElementById('tactic-bar');
    bar.innerHTML = '';
    for (const t of TACTICS) {
      const btn = document.createElement('button');
      btn.className = 'tactic-btn';
      btn.title = `${t.name} ${t.en}\n效果:${t.desc}\n風險:${t.risk}\n冷卻:${t.cd}s`;
      btn.innerHTML = `
        <span class="tactic-key">${t.key}</span>
        <span class="tactic-icon">${t.icon}</span>
        <span class="tactic-name">${t.name}</span>
        <div class="tactic-cd hidden"></div>`;
      btn.addEventListener('click', () => this.game.playerTactic(t.id));
      bar.appendChild(btn);
      this.buttons[t.id] = btn;
    }
    for (const sp of SPECIALS) {
      const btn = document.createElement('button');
      btn.className = 'tactic-btn special';
      btn.title = sp.tip;
      btn.innerHTML = `
        <span class="tactic-key">${sp.key}</span>
        <span class="tactic-icon">${sp.icon}</span>
        <span class="tactic-name">${sp.name}</span>`;
      btn.addEventListener('click', () => {
        if (sp.id === 'subvert') this.game.trySubvert();
        else this.game.tryRetreat();
      });
      bar.appendChild(btn);
      this.buttons[sp.id] = btn;
    }
  }

  setBattleInfo(systemName, enemyName) {
    document.getElementById('battle-title').textContent = systemName;
    document.querySelector('#panel-enemy .fleet-name').textContent = `帝國艦隊 · ${enemyName}`;
  }

  show() { this.hud.classList.remove('hidden'); }
  hide() { this.hud.classList.add('hidden'); }

  banner(text, color = '#ffd166') {
    this.bannerEl.textContent = text;
    this.bannerEl.style.color = color;
    this.bannerEl.style.opacity = '1';
    this.bannerTimer = 2.2;
  }

  update(dt) {
    const g = this.game;
    const p = g.player, e = g.enemy;
    if (!p || !e) return;
    const inBattle = g.state === 'battle';

    // 頂部面板
    setBar('bar-player-str', p.strength());
    setBar('bar-player-morale', p.morale / 100);
    setBar('bar-enemy-str', e.strength());
    setBar('bar-enemy-morale', e.morale / 100);
    document.getElementById('count-player').textContent = `艦艇 ${p.aliveShips.length} / ${p.ships.length}`;
    document.getElementById('count-enemy').textContent = `艦艇 ${e.aliveShips.length} / ${e.ships.length}`;

    // 戰術按鈕
    for (const t of TACTICS) {
      const btn = this.buttons[t.id];
      const cdEl = btn.querySelector('.tactic-cd');
      const cd = p.cooldowns[t.id] || 0;
      const isActive = p.activeTactic === t.id;
      btn.classList.toggle('active', isActive);
      if (isActive) {
        cdEl.classList.remove('hidden');
        cdEl.textContent = Math.ceil(p.tacticTimer);
        cdEl.style.background = 'rgba(255,209,102,.15)';
        btn.disabled = true;
      } else if (cd > 0) {
        cdEl.classList.remove('hidden');
        cdEl.textContent = Math.ceil(cd);
        cdEl.style.background = 'rgba(2,4,12,.68)';
        btn.disabled = true;
      } else {
        cdEl.classList.add('hidden');
        btn.disabled = !!p.activeTactic || !inBattle || g.retreating;
      }
    }

    // 特殊按鈕
    this.buttons.subvert.disabled = g.subvertUsed || !inBattle || g.retreating;
    this.buttons.subvert.classList.toggle('used', g.subvertUsed);
    this.buttons.retreat.disabled = !inBattle || !!g.retreating;

    // 訊息 log
    const recent = g.messages.slice(-6);
    this.logEl.innerHTML = recent.map(m => {
      const age = g.time - m.t;
      const op = Math.max(0, Math.min(1, (9 - age) / 3));
      return `<div class="msg ${m.cls || ''}" style="opacity:${op.toFixed(2)}">${m.text}</div>`;
    }).join('');

    // Banner 淡出
    if (this.bannerTimer > 0) {
      this.bannerTimer -= dt;
      if (this.bannerTimer <= 0) this.bannerEl.style.opacity = '0';
    }
  }
}

function setBar(id, pct) {
  document.getElementById(id).style.width = `${Math.max(0, Math.min(1, pct)) * 100}%`;
}
