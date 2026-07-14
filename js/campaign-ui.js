// 戰役層 UI — 星圖渲染、系統面板、事件/決策/議會 modal、回合流程
import {
  SYSTEMS, SYS, newCampaign, loadCampaign, saveCampaign, clearSave,
  playerAction, endTurn, buildBattleConfig, applyBattleResult,
  repairCost, moveCost, SHIP_COST, SHIP_HP, isAdjacent,
  isRevealed, refreshIntel, SCOUT_COST, SCOUT_SUPPLY,
} from './campaign.js';
import { OFFICERS } from './roster.js';
import { pickDecision } from './events.js';
import { sfx } from './audio.js';
import { TECH_TREE, techCost } from './tech.js';

const TYPE_ZH = { flagship: '旗艦', cruiser: '巡洋艦', destroyer: '驅逐艦', frigate: '護衛艦' };
const OWNER_ZH = { fed: '聯邦', emp: '帝國', neutral: '中立' };
const OWNER_COLOR = { fed: '#5db1ff', emp: '#ff6a55', neutral: '#8a94ad' };

export class CampaignUI {
  constructor(game, hooks) {
    this.game = game;
    this.hooks = hooks;
    this.st = null;
    this.selected = null;
    this.queue = [];
    this.toastTimer = null;

    this.hud = document.getElementById('campaign-hud');
    this.panel = document.getElementById('system-panel');
    this.modalRoot = document.getElementById('modal-root');
    this.toastEl = document.getElementById('campaign-toast');

    document.getElementById('btn-armistice').addEventListener('click', () => this.action({ type: 'armistice' }));
    document.getElementById('btn-tech').addEventListener('click', () => this.showTech());
    this.buildOfficerChips();
  }

  buildOfficerChips() {
    const wrap = document.getElementById('officer-chips');
    wrap.innerHTML = OFFICERS.map(o =>
      `<span class="officer-chip" title="${o.name}(${o.role})\n${o.effect}">${o.icon}</span>`
    ).join('');
  }

  // ---------- 進入/離開 ----------
  startNew() {
    clearSave();
    this.st = newCampaign();
    this.enter();
    this.showModal({
      icon: '📡', title: '開戰通告',
      body: '帝國遠征艦隊越過中立宙域,聯邦全面動員。<br><br>你——<b>里昂・凱撒</b>——受命統率第13艦隊。你嘅四位軍官(瑪雅、雷、菲比、艾莎)已經就位。<br><br><b>目標:攻陷帝國首都奧丁。</b><br>守住新特拉維夫,留意議會支持度,同埋……小心雷因哈特。',
      choices: [{ label: '⚔️ 出擊', fn: () => {} }],
    });
  }

  continue() {
    this.st = loadCampaign();
    if (!this.st) return this.startNew();
    if (!this.st.tech) this.st.tech = { hull: 0, logistics: 0, econ: 0 };
    if (!this.st.intel) this.st.intel = { scouted: {}, reinhardtSeenAt: this.st.reinhardt.system, reinhardtSeenTurn: this.st.turn, blackout: 0 };
    this.enter();
    if (this.st.pendingBattle) this.launchBattle();
  }

  enter() {
    this.game.state = 'campaign';
    this.selected = this.st.playerSystem;
    this.hooks.showScreen('campaign');
    this.refresh();
  }

  // ---------- 玩家行動 ----------
  action(act) {
    if (!this.st || this.st.over || this.modalOpen()) return;
    const r = playerAction(this.st, act);
    if (r.error) { this.toast(`⚠️ ${r.error}`); return; }
    sfx('tactic');
    if (r.battle) { this.launchBattle(); return; }
    if (r.text) this.toast(r.text);
    this.processTurn();
  }

  processTurn() {
    const { results, income } = endTurn(this.st);
    this.toast(`回合 ${this.st.turn} — 星域收入 +${income} 資金`);
    this.queue = results;
    saveCampaign(this.st);
    this.refresh();
    this.nextResult();
  }

  nextResult() {
    const r = this.queue.shift();
    if (!r) {
      saveCampaign(this.st);
      this.refresh();
      return;
    }
    switch (r.type) {
      case 'info':
        this.showModal({ icon: r.icon, title: r.title, body: r.text, choices: [{ label: '確認', fn: () => this.nextResult() }] });
        break;
      case 'event': {
        const ev = r.ev;
        this.showModal({
          icon: ev.icon, title: `黑天鵝事件:${ev.title}`, body: ev.desc,
          choices: ev.choices.map(c => ({
            label: c.label,
            fn: () => {
              const outcome = c.apply(this.st);
              saveCampaign(this.st);
              this.refresh();
              this.showModal({ icon: ev.icon, title: ev.title, body: outcome, choices: [{ label: '繼續', fn: () => this.nextResult() }] });
            },
          })),
        });
        break;
      }
      case 'council':
        sfx(r.grant > 0 ? 'tactic' : 'alarm');
        this.showModal({
          icon: '🏛️', title: '議會撥款表決',
          body: `${r.text}${r.grant > 0 ? `<br><br><b>+${r.grant} 資金</b>` : ''}`,
          choices: [{ label: '散會', fn: () => this.nextResult() }],
        });
        break;
      case 'attack':
        sfx('alarm');
        this.showModal({
          icon: '🚨', title: '敵襲!', body: r.text,
          choices: [{ label: '⚔️ 迎擊', fn: () => this.launchBattle() }],
        });
        break;
      case 'gameover':
        this.gameOver();
        break;
      default:
        this.nextResult();
    }
  }

  // ---------- 戰鬥橋接 ----------
  launchBattle() {
    const st = this.st;
    const wasDefensive = !!st.pendingBattle?.defensive;
    const cfg = buildBattleConfig(st);
    cfg.onEnd = res => this.onBattleEnd(res, wasDefensive);
    saveCampaign(st);
    this.hooks.startBattle(cfg);
  }

  onBattleEnd(res, wasDefensive) {
    const st = this.st;
    const notes = applyBattleResult(st, res);
    saveCampaign(st);
    this.enter();

    const afterNotes = () => {
      if (st.over) { this.gameOver(); return; }
      if (res.victory) {
        const d = pickDecision(st);
        this.showModal({
          icon: d.icon, title: `戰後決策:${d.title}`, body: d.desc,
          choices: d.choices.map(c => ({
            label: c.label,
            fn: () => {
              const outcome = c.apply(st);
              saveCampaign(st);
              this.refresh();
              this.showModal({
                icon: d.icon, title: d.title, body: outcome,
                choices: [{ label: '繼續', fn: () => { if (!wasDefensive) this.processTurn(); else { saveCampaign(st); this.refresh(); } } }],
              });
            },
          })),
        });
      } else if (!wasDefensive) {
        this.processTurn();
      } else {
        saveCampaign(st);
        this.refresh();
      }
    };

    if (notes.length) {
      this.showModal({
        icon: res.victory ? '🎖️' : '📋', title: '戰役報告',
        body: notes.join('<br>'),
        choices: [{ label: '繼續', fn: afterNotes }],
      });
    } else {
      afterNotes();
    }
  }

  gameOver() {
    const st = this.st;
    clearSave();
    const s = st.stats;
    this.showModal({
      icon: st.over.win ? '🏆' : '🪦',
      title: st.over.win ? '戰爭勝利' : '戰役終結',
      body: `${st.over.reason}<br><br>回合數 ${st.turn} · 會戰 ${s.battles} 場(勝 ${s.wins})· 擊沉敵艦 ${s.kills} · 損失 ${s.losses}`,
      choices: [{ label: '返回主選單', fn: () => { this.st = null; this.hooks.showScreen('title'); this.game.state = 'title'; } }],
    });
  }

  // ---------- Modal / Toast ----------
  modalOpen() { return this.modalRoot.children.length > 0; }

  showModal({ icon, title, body, choices }) {
    this.modalRoot.innerHTML = '';
    const m = document.createElement('div');
    m.className = 'modal';
    m.innerHTML = `
      <div class="modal-box">
        <div class="modal-title">${icon || ''} ${title}</div>
        <div class="modal-body">${body}</div>
        <div class="modal-choices"></div>
      </div>`;
    const wrap = m.querySelector('.modal-choices');
    for (const c of choices) {
      const b = document.createElement('button');
      b.className = 'modal-btn';
      b.innerHTML = c.label;
      b.addEventListener('click', () => { this.modalRoot.innerHTML = ''; c.fn(); });
      wrap.appendChild(b);
    }
    this.modalRoot.appendChild(m);
  }

  toast(text) {
    this.toastEl.textContent = text;
    this.toastEl.classList.add('show');
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => this.toastEl.classList.remove('show'), 3200);
  }

  // ---------- HUD / 面板 ----------
  refresh() {
    const st = this.st;
    if (!st) return;
    refreshIntel(st);
    document.getElementById('c-turn').textContent = st.turn;
    document.getElementById('c-credits').textContent = st.credits;
    document.getElementById('c-supplies').textContent = st.supplies;
    document.getElementById('c-rep').textContent = st.rep;
    document.getElementById('c-fleet').textContent = st.fleet.length;
    const armBtn = document.getElementById('btn-armistice');
    armBtn.disabled = st.armisticeUsed;
    armBtn.title = st.armisticeUsed ? '停戰只可以談一次' : '同帝國停戰 4 回合(議會支持度 -12,一次性)';
    this.renderPanel();
  }

  renderPanel() {
    const st = this.st;
    const sys = SYS[this.selected];
    if (!sys) { this.panel.innerHTML = ''; return; }
    const owner = st.owners[sys.id];
    const here = st.playerSystem === sys.id;
    const adj = isAdjacent(st, sys.id);
    const garrison = st.garrisons[sys.id] || 0;
    const revealed = isRevealed(st, sys.id);
    const reinHere = !st.reinhardt.destroyed && st.reinhardt.system === sys.id;
    const reinLastSeenHere = !st.reinhardt.destroyed && st.intel.reinhardtSeenAt === sys.id && !(reinHere && revealed);

    let html = `
      <div class="sp-title" style="color:${OWNER_COLOR[owner]}">${sys.capital ? '✦ ' : ''}${sys.name}</div>
      <div class="sp-row">陣營:<b style="color:${OWNER_COLOR[owner]}">${OWNER_ZH[owner]}</b>${sys.capital ? '(首都)' : ''}</div>
      <div class="sp-row">經濟:${'¤'.repeat(sys.econ) || '—'} ${sys.shipyard ? '· ⚓ 船塢' : ''}</div>`;
    if (owner === 'emp' && !here) {
      if (revealed && garrison > 0) html += `<div class="sp-row">🕵️ 情報:駐防等級 ${garrison}</div>`;
      else if (!revealed) html += `<div class="sp-row dim">🌫️ 敵情不明 — 超出情報覆蓋範圍</div>`;
    }
    if (reinHere && revealed) html += `<div class="sp-row warn">👑 雷因哈特艦隊喺呢度${st.reinhardt.weakened ? '(重創未復)' : ''}${st.reinhardt.frozen > 0 ? ' ❄ 按兵不動' : ''}</div>`;
    else if (reinLastSeenHere) html += `<div class="sp-row dim">📡 情報(回合 ${st.intel.reinhardtSeenTurn}):雷因哈特上次目擊喺呢度,而家位置未知</div>`;
    if (here) {
      const byType = {};
      for (const s of st.fleet) byType[s.type] = (byType[s.type] || 0) + 1;
      const hpPct = Math.round(st.fleet.reduce((a, s) => a + s.hp / SHIP_HP[s.type], 0) / Math.max(1, st.fleet.length) * 100);
      html += `<div class="sp-row fleet-here">🚩 第13艦隊駐留(平均艦體 ${hpPct}%)<br>${Object.entries(byType).map(([t, n]) => `${TYPE_ZH[t]}×${n}`).join(' ')}</div>`;
    }

    html += '<div class="sp-actions">';
    if (here) {
      const rc = repairCost(st);
      html += `<button class="sp-btn" data-act="repair" ${rc === 0 || st.credits < rc ? 'disabled' : ''}>🔧 全面維修(${rc} 資金)</button>`;
      if (sys.shipyard && st.owners[sys.id] === 'fed') {
        html += `<button class="sp-btn" data-act="recruit">⚓ 招募新艦</button>`;
      }
      html += `<button class="sp-btn" data-act="hold">⏳ 補整待命${st.owners[sys.id] === 'fed' ? '(補給 +25)' : ''}</button>`;
    } else if (adj) {
      let warn = '';
      if (reinHere) warn = ' ⚔️👑';
      else if (owner === 'emp' && garrison > 0) warn = ' ⚔️';
      html += `<button class="sp-btn move" data-act="move">🚀 移動去呢度(補給 -${moveCost(st)})${warn}</button>`;
    } else if (!revealed) {
      const blackout = (st.intel.blackout || 0) >= st.turn;
      html += `<div class="sp-row dim">唔喺航線範圍內</div>`;
      html += `<button class="sp-btn" data-act="scout" ${st.credits < SCOUT_COST || blackout ? 'disabled' : ''}>🔭 派遣偵察艦(${SCOUT_COST} 資金 / ${SCOUT_SUPPLY} 補給)</button>`;
      if (blackout) html += `<div class="sp-row dim">⚠️ 偵察網絡遭反情報癱瘓中</div>`;
    } else {
      html += `<div class="sp-row dim">唔喺航線範圍內(已有情報覆蓋)</div>`;
    }
    html += '</div>';
    this.panel.innerHTML = html;

    this.panel.querySelectorAll('.sp-btn').forEach(b => {
      b.addEventListener('click', () => {
        const act = b.dataset.act;
        if (act === 'move') this.action({ type: 'move', to: sys.id });
        else if (act === 'repair') this.action({ type: 'repair' });
        else if (act === 'hold') this.action({ type: 'hold' });
        else if (act === 'recruit') this.showRecruit();
        else if (act === 'scout') this.action({ type: 'scout', target: sys.id });
      });
    });
  }

  showRecruit() {
    const st = this.st;
    const cart = [];
    const body = () => `
      揀艦艇加入建造清單(即時交付):<br><br>
      ${Object.entries(SHIP_COST).map(([t, c]) => `<button class="modal-btn small" data-ship="${t}">${TYPE_ZH[t]} — ${c} 資金</button>`).join(' ')}
      <div class="cart">清單:${cart.length ? cart.map(t => TYPE_ZH[t]).join('、') : '(空)'} · 合共 ${cart.reduce((a, t) => a + SHIP_COST[t], 0)} 資金(持有 ${st.credits})</div>`;

    const rebuild = () => {
      this.showModal({
        icon: '⚓', title: '船塢 — 招募新艦', body: body(),
        choices: [
          { label: `✅ 確認招募(用 1 回合)`, fn: () => { if (cart.length) this.action({ type: 'recruit', ships: cart }); } },
          { label: '取消', fn: () => {} },
        ],
      });
      this.modalRoot.querySelectorAll('[data-ship]').forEach(b => {
        b.addEventListener('click', () => {
          const t = b.dataset.ship;
          const total = cart.reduce((a, x) => a + SHIP_COST[x], 0) + SHIP_COST[t];
          if (total <= st.credits) { cart.push(t); rebuild(); }
        });
      });
    };
    rebuild();
  }

  showTech() {
    const st = this.st;
    const body = () => TECH_TREE.map(t => {
      const tier = st.tech[t.id] || 0;
      const cost = techCost(st, t.id);
      const bars = '●'.repeat(tier) + '○'.repeat(3 - tier);
      return `
        <div class="tech-row">
          <div class="tech-head">${t.icon} <b>${t.name}</b> <span class="tech-tier">${bars}</span></div>
          <div class="tech-desc">${t.desc}${tier ? `<br><i>已生效:${t.tierDesc(tier)}</i>` : ''}</div>
          ${cost !== null
            ? `<button class="modal-btn small" data-tech="${t.id}" ${st.credits < cost ? 'disabled' : ''}>研發 Lv.${tier + 1}(${cost} 資金)— ${t.tierDesc(tier + 1)}</button>`
            : `<div class="tech-maxed">✅ 已滿級</div>`}
        </div>`;
    }).join('');

    const rebuild = () => {
      this.showModal({
        icon: '🔬', title: '科研院 — 科技樹', body: body(),
        choices: [{ label: '離開科研院', fn: () => {} }],
      });
      this.modalRoot.querySelectorAll('[data-tech]').forEach(b => {
        b.addEventListener('click', () => {
          this.modalRoot.innerHTML = '';
          this.action({ type: 'research', id: b.dataset.tech });
        });
      });
    };
    rebuild();
  }

  // ---------- 星圖渲染 ----------
  onClick(pt) {
    if (this.modalOpen()) return;
    for (const sys of SYSTEMS) {
      if ((pt.x - sys.x) ** 2 + (pt.y - sys.y) ** 2 < 34 ** 2) {
        this.selected = sys.id;
        this.refresh();
        return;
      }
    }
  }

  render(ctx, t) {
    const st = this.st;
    if (!st) return;

    // 航線
    ctx.strokeStyle = 'rgba(120,150,200,.22)';
    ctx.lineWidth = 1.5;
    ctx.setLineDash([6, 8]);
    for (const sys of SYSTEMS) {
      for (const l of sys.links) {
        if (l < sys.id) continue;
        const o = SYS[l];
        ctx.beginPath();
        ctx.moveTo(sys.x, sys.y);
        ctx.lineTo(o.x, o.y);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    // 玩家可達航線 highlight
    const cur = SYS[st.playerSystem];
    ctx.strokeStyle = 'rgba(93,177,255,.5)';
    ctx.lineWidth = 2;
    for (const l of cur.links) {
      const o = SYS[l];
      ctx.beginPath();
      ctx.moveTo(cur.x, cur.y);
      ctx.lineTo(o.x, o.y);
      ctx.stroke();
    }

    // 星系
    for (const sys of SYSTEMS) {
      const owner = st.owners[sys.id];
      const r = sys.capital ? 24 : 16;
      const col = OWNER_COLOR[owner];

      const grad = ctx.createRadialGradient(sys.x, sys.y, 2, sys.x, sys.y, r * 1.6);
      grad.addColorStop(0, col + 'cc');
      grad.addColorStop(1, 'transparent');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(sys.x, sys.y, r * 1.6, 0, Math.PI * 2);
      ctx.fill();

      ctx.fillStyle = '#0a1020';
      ctx.strokeStyle = col;
      ctx.lineWidth = sys.capital ? 3 : 2;
      ctx.beginPath();
      ctx.arc(sys.x, sys.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      if (sys.capital) {
        ctx.fillStyle = col;
        ctx.font = '16px sans-serif';
        ctx.textAlign = 'center';
        ctx.fillText('✦', sys.x, sys.y + 6);
      }

      // 選中圈
      if (this.selected === sys.id) {
        ctx.strokeStyle = '#ffd166';
        ctx.lineWidth = 2;
        ctx.setLineDash([4, 4]);
        ctx.beginPath();
        ctx.arc(sys.x, sys.y, r + 8 + Math.sin(t * 4) * 2, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
      }

      // 名稱與資訊
      ctx.font = '15px "Noto Sans TC", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(230,240,255,.92)';
      ctx.fillText(sys.name, sys.x, sys.y + r + 22);
      ctx.font = '11px "Noto Sans TC", sans-serif';
      ctx.fillStyle = 'rgba(200,215,240,.55)';
      const extras = [];
      if (sys.econ) extras.push('¤'.repeat(sys.econ));
      if (sys.shipyard) extras.push('⚓');
      const g = st.garrisons[sys.id] || 0;
      const rev = isRevealed(st, sys.id);
      if (st.owners[sys.id] === 'emp' && g > 0) extras.push(rev ? `守${g}` : '守❓');
      if (extras.length) ctx.fillText(extras.join(' '), sys.x, sys.y + r + 38);
    }

    // 玩家艦隊標記 (環繞)
    const ps = SYS[st.playerSystem];
    const orbA = t * 1.2;
    const px = ps.x + Math.cos(orbA) * 34, py = ps.y + Math.sin(orbA) * 34;
    ctx.fillStyle = '#5db1ff';
    ctx.save();
    ctx.translate(px, py);
    ctx.rotate(orbA + Math.PI / 2);
    ctx.beginPath();
    ctx.moveTo(8, 0); ctx.lineTo(-6, -5); ctx.lineTo(-3, 0); ctx.lineTo(-6, 5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.font = '12px "Noto Sans TC", sans-serif';
    ctx.fillStyle = 'rgba(93,177,255,.9)';
    ctx.fillText('第13艦隊', ps.x, ps.y - 34);

    // 雷因哈特標記 — 根據情報覆蓋顯示實時或過時位置
    if (!st.reinhardt.destroyed) {
      const stale = st.intel.reinhardtSeenTurn < st.turn;
      const rs = SYS[st.intel.reinhardtSeenAt];
      const ra = -t * 1.4;
      const rx = rs.x + Math.cos(ra) * 34, ry = rs.y + Math.sin(ra) * 34;
      ctx.save();
      ctx.globalAlpha = stale ? 0.4 : 1;
      ctx.fillStyle = '#ff6a55';
      ctx.translate(rx, ry);
      ctx.rotate(ra + Math.PI / 2);
      ctx.beginPath();
      ctx.moveTo(9, 0); ctx.lineTo(-7, -6); ctx.lineTo(-4, 0); ctx.lineTo(-7, 6);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      ctx.fillStyle = stale ? 'rgba(255,106,85,.55)' : 'rgba(255,106,85,.9)';
      const label = stale
        ? `👑 雷因哈特(上次目擊:回合${st.intel.reinhardtSeenTurn})`
        : `👑 雷因哈特${st.reinhardt.frozen > 0 ? ' ❄' : ''}`;
      ctx.fillText(label, rs.x, rs.y - 34);
    }
    ctx.textAlign = 'left';
  }
}
