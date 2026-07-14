// 戰役層 — 星圖、回合、經濟、補給線、議會、帝國 AI(純邏輯,無 DOM)
import { pickBlackSwan } from './events.js';
import { REPAIR_DISCOUNT, SUPPLY_DISCOUNT } from './roster.js';
import { applyResearch, TECH_BY_ID } from './tech.js';

export const SHIP_COST = { cruiser: 350, destroyer: 200, frigate: 120 };
export const SHIP_HP = { flagship: 800, cruiser: 340, destroyer: 200, frigate: 120 };

export const SYSTEMS = [
  { id: 'telaviv',  name: '新特拉維夫', x: 180,  y: 450, econ: 3, shipyard: true,  capital: 'fed', links: ['fisher', 'cyrus'] },
  { id: 'fisher',   name: '費舍爾站',   x: 340,  y: 240, econ: 2, links: ['telaviv', 'cyrus', 'capella'] },
  { id: 'cyrus',    name: '賽勒斯',     x: 360,  y: 640, econ: 1, links: ['telaviv', 'fisher', 'aztlan', 'ghostneb'] },
  { id: 'capella',  name: '卡佩拉',     x: 580,  y: 170, econ: 2, links: ['fisher', 'governor', 'garman'] },
  { id: 'aztlan',   name: '阿茲特蘭',   x: 640,  y: 500, econ: 2, shipyard: true, links: ['cyrus', 'governor', 'ghostneb', 'tiamat'] },
  { id: 'ghostneb', name: '幽靈星雲',   x: 540,  y: 760, econ: 0, links: ['cyrus', 'aztlan', 'tiamat'] },
  { id: 'governor', name: '邊境總督府', x: 800,  y: 330, econ: 2, links: ['capella', 'aztlan', 'garman', 'valhalla'] },
  { id: 'garman',   name: '加爾曼',     x: 1010, y: 170, econ: 2, def: 2, links: ['capella', 'governor', 'valhalla'] },
  { id: 'valhalla', name: '瓦爾哈拉',   x: 1090, y: 430, econ: 2, def: 3, shipyard: true, links: ['governor', 'garman', 'odin', 'tiamat'] },
  { id: 'tiamat',   name: '提亞馬特',   x: 920,  y: 690, econ: 1, def: 2, links: ['aztlan', 'ghostneb', 'valhalla', 'odin'] },
  { id: 'odin',     name: '奧丁',       x: 1370, y: 450, econ: 3, def: 4, capital: 'emp', shipyard: true, links: ['valhalla', 'tiamat'] },
];

export const SYS = Object.fromEntries(SYSTEMS.map(s => [s.id, s]));
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

export function newCampaign() {
  return {
    turn: 1, credits: 450, supplies: 100, rep: 50,
    playerSystem: 'cyrus', lastSystem: 'telaviv',
    fleet: [
      { type: 'flagship', hp: SHIP_HP.flagship, xp: 0 },
      { type: 'cruiser', hp: SHIP_HP.cruiser, xp: 0 }, { type: 'cruiser', hp: SHIP_HP.cruiser, xp: 0 },
      { type: 'destroyer', hp: SHIP_HP.destroyer, xp: 0 }, { type: 'destroyer', hp: SHIP_HP.destroyer, xp: 0 },
      { type: 'destroyer', hp: SHIP_HP.destroyer, xp: 0 }, { type: 'destroyer', hp: SHIP_HP.destroyer, xp: 0 },
      { type: 'frigate', hp: SHIP_HP.frigate, xp: 0 }, { type: 'frigate', hp: SHIP_HP.frigate, xp: 0 },
      { type: 'frigate', hp: SHIP_HP.frigate, xp: 0 },
    ],
    owners: Object.fromEntries(SYSTEMS.map(s => [s.id, s.capital === 'fed' ? 'fed' : s.def ? 'emp' : s.capital === 'emp' ? 'emp' : ['telaviv', 'fisher', 'cyrus'].includes(s.id) ? 'fed' : 'neutral'])),
    garrisons: { garman: 2, valhalla: 3, tiamat: 2, odin: 4 },
    reinhardt: { system: 'valhalla', weakened: false, frozen: 0, destroyed: false, rebuildAt: 0, sieging: null },
    ghost: { active: false, empireHired: false },
    armisticeUsed: false,
    tech: { hull: 0, logistics: 0, econ: 0 },
    intel: { scouted: {}, reinhardtSeenAt: 'valhalla', reinhardtSeenTurn: 1, blackout: 0 },
    usedEvents: [], recentDecisions: [], flags: {},
    pendingBattle: null, over: null,
    stats: { battles: 0, wins: 0, kills: 0, losses: 0 },
  };
}

export function currentSystem(st) { return SYS[st.playerSystem]; }
export function isAdjacent(st, id) { return SYS[st.playerSystem].links.includes(id); }
export function moveCost(st) { return Math.max(2, Math.round(10 * SUPPLY_DISCOUNT * (1 - 0.1 * (st?.tech.logistics || 0)))); }

// ---------- 情報戰 Intelligence War ----------
export const SCOUT_COST = 100;
export const SCOUT_SUPPLY = 10;
export const SCOUT_DURATION = 5;

// 聯邦星域網絡外圍 2 跳內,艾莎嘅線人網絡照樣有情報回報
function hopDistanceFromFed(st, sysId) {
  if (st.owners[sysId] === 'fed') return 0;
  const visited = new Set(Object.keys(st.owners).filter(id => st.owners[id] === 'fed'));
  let frontier = [...visited];
  let dist = 0;
  while (frontier.length) {
    dist++;
    const next = [];
    for (const id of frontier) {
      for (const n of SYS[id].links) {
        if (visited.has(n)) continue;
        if (n === sysId) return dist;
        visited.add(n);
        next.push(n);
      }
    }
    frontier = next;
  }
  return Infinity;
}

// 星域係咪處於己方情報覆蓋範圍(己方領土/艦隊感應/線人網絡/偵察報告有效期內)
export function isRevealed(st, sysId) {
  if (sysId === st.playerSystem) return true;
  if (st.owners[sysId] === 'fed') return true;
  if (isAdjacent(st, sysId)) return true;
  if ((st.intel.scouted[sysId] || 0) >= st.turn) return true;
  return hopDistanceFromFed(st, sysId) <= 2;
}

// 每次行動/回合結束後,將雷因哈特目前所在地(如喺情報覆蓋範圍內)寫入已知情報
export function refreshIntel(st) {
  if (!st.intel || st.reinhardt.destroyed) return;
  if (isRevealed(st, st.reinhardt.system)) {
    st.intel.reinhardtSeenAt = st.reinhardt.system;
    st.intel.reinhardtSeenTurn = st.turn;
  }
}

export function repairCost(st) {
  let missing = 0;
  for (const s of st.fleet) missing += Math.max(0, SHIP_HP[s.type] - s.hp);
  return Math.ceil(missing * 0.35 * REPAIR_DISCOUNT * (1 - 0.08 * (st.tech.hull || 0)));
}

// ---------- 玩家行動(每個行動 = 1 回合) ----------
export function playerAction(st, action) {
  if (st.over || st.pendingBattle) return { error: '而家唔可以行動' };
  switch (action.type) {
    case 'move': {
      if (!isAdjacent(st, action.to)) return { error: '唔相鄰' };
      st.supplies = clamp(st.supplies - moveCost(st), 0, 100);
      st.lastSystem = st.playerSystem;
      st.playerSystem = action.to;
      // 攻打奧丁 = 決戰:雷因哈特必定回防首都
      if (action.to === 'odin' && !st.reinhardt.destroyed) {
        st.reinhardt.system = 'odin';
        st.reinhardt.sieging = null;
      }
      const hostileReinhardt = !st.reinhardt.destroyed && st.reinhardt.system === action.to;
      const hostileGarrison = st.owners[action.to] === 'emp' && (st.garrisons[action.to] || 0) > 0;
      if (hostileReinhardt || hostileGarrison) {
        st.pendingBattle = { systemId: action.to, kind: hostileReinhardt ? 'reinhardt' : 'garrison', defensive: false };
        return { battle: true };
      }
      if (st.owners[action.to] === 'emp' || st.owners[action.to] === 'neutral') {
        if (st.owners[action.to] === 'emp') st.owners[action.to] = 'fed'; // 無守軍星域直接光復
      }
      return { battle: false };
    }
    case 'repair': {
      const cost = repairCost(st);
      if (st.credits < cost) return { error: '資金不足' };
      st.credits -= cost;
      for (const s of st.fleet) s.hp = SHIP_HP[s.type];
      return { battle: false, text: `艦隊全面維修完成(-${cost} 資金)` };
    }
    case 'recruit': {
      const cost = action.ships.reduce((a, t) => a + SHIP_COST[t], 0);
      if (st.credits < cost) return { error: '資金不足' };
      st.credits -= cost;
      for (const t of action.ships) st.fleet.push({ type: t, hp: SHIP_HP[t], xp: 0 });
      return { battle: false, text: `${action.ships.length} 艘新艦入列(-${cost} 資金)` };
    }
    case 'hold': {
      if (st.owners[st.playerSystem] === 'fed') st.supplies = clamp(st.supplies + 25, 0, 100);
      return { battle: false, text: st.owners[st.playerSystem] === 'fed' ? '艦隊停留補整(補給 +25)' : '喺非友方星域警戒待命。' };
    }
    case 'armistice': {
      if (st.armisticeUsed) return { error: '已經用過' };
      st.armisticeUsed = true;
      st.rep = clamp(st.rep - 12, 0, 100);
      st.reinhardt.frozen = 4;
      return { battle: false, text: '停戰談判達成:帝國艦隊 4 回合內唔會行動。議會鷹派好唔滿意(支持度 -12)。' };
    }
    case 'research': {
      const r = applyResearch(st, action.id);
      if (r.error) return { error: r.error };
      return { battle: false, text: r.text };
    }
    case 'scout': {
      if (isRevealed(st, action.target)) return { error: '呢個星域情報已經好清楚,唔使再偵察' };
      if ((st.intel.blackout || 0) >= st.turn) return { error: '偵察網絡遭反情報癱瘓中,暫時冇辦法派遣' };
      if (st.credits < SCOUT_COST) return { error: '資金不足' };
      st.credits -= SCOUT_COST;
      st.supplies = clamp(st.supplies - SCOUT_SUPPLY, 0, 100);
      st.intel.scouted[action.target] = st.turn + SCOUT_DURATION;
      refreshIntel(st);
      const hit = !st.reinhardt.destroyed && st.reinhardt.system === action.target;
      return {
        battle: false,
        text: hit
          ? `偵察艦傳回確切座標:雷因哈特艦隊現正喺${SYS[action.target].name}!`
          : `偵察報告:${SYS[action.target].name}情報已更新(${SCOUT_DURATION} 回合內有效)。`,
      };
    }
  }
  return { error: '未知行動' };
}

// ---------- 敵艦隊編成 ----------
export function generateEnemyRoster(st) {
  const pb = st.pendingBattle;
  const scale = Math.floor(st.turn / 6); // 隨時間增兵
  let roster = [];
  if (pb.kind === 'reinhardt') {
    roster = ['flagship', 'cruiser', 'cruiser', 'cruiser', 'cruiser',
      'destroyer', 'destroyer', 'destroyer', 'destroyer', 'destroyer', 'destroyer',
      'frigate', 'frigate', 'frigate', 'frigate'];
    if (st.reinhardt.weakened) roster = roster.slice(0, roster.length - 4);
    if (pb.systemId === 'odin') roster.push('cruiser', 'cruiser', 'destroyer', 'destroyer', 'frigate'); // 首都守備隊
    else if (st.owners[pb.systemId] === 'emp' && st.garrisons[pb.systemId]) roster.push('destroyer', 'frigate');
  } else {
    const tier = st.garrisons[pb.systemId] || 1;
    const base = {
      1: ['cruiser', 'destroyer', 'destroyer', 'frigate', 'frigate'],
      2: ['cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'frigate', 'frigate'],
      3: ['cruiser', 'cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'destroyer', 'frigate', 'frigate', 'frigate'],
      4: ['cruiser', 'cruiser', 'cruiser', 'cruiser', 'destroyer', 'destroyer', 'destroyer', 'destroyer', 'destroyer', 'frigate', 'frigate', 'frigate', 'frigate'],
    }[tier];
    roster = [...base];
  }
  for (let i = 0; i < scale; i++) roster.push('destroyer');
  if (st.ghost.empireHired) { roster.push('destroyer', 'destroyer'); }
  return roster;
}

export function buildBattleConfig(st) {
  const pb = st.pendingBattle;
  const sys = SYS[pb.systemId];
  let commander = 'garrison';
  if (pb.kind === 'reinhardt') commander = 'reinhardt';
  else if (pb.systemId === 'valhalla') commander = 'wolf';
  const empireHired = st.ghost.empireHired;
  st.ghost.empireHired = false; // 用一次
  return {
    mode: 'campaign',
    systemName: `${sys.name}${pb.defensive ? '防衛戰' : '攻略戰'}`,
    playerRoster: st.fleet.map(s => ({ ...s })),
    enemyRoster: generateEnemyRoster(st),
    enemyCommander: commander,
    playerMorale: clamp(80 + (st.rep > 70 ? 5 : 0) - (st.supplies <= 0 ? 20 : 0), 30, 95),
    enemyMorale: clamp(80 - (st.flags.otto ? 10 : 0) - (pb.kind === 'reinhardt' && st.reinhardt.weakened ? 8 : 0), 30, 95),
    reyaPossible: pb.kind === 'reinhardt' && !st.flags.reyaGone,
    lowSupplies: st.supplies <= 0,
    ghostHelped: empireHired,
  };
}

// ---------- 戰鬥結果回寫 ----------
export function applyBattleResult(st, res) {
  const pb = st.pendingBattle;
  st.pendingBattle = null;
  st.stats.battles++;
  st.stats.kills += res.kills;
  st.stats.losses += res.losses;
  if (res.reyaDefected) st.flags.reyaGone = true;

  st.fleet = res.survivors.map(s => ({ ...s }));
  const notes = [];

  if (res.victory) {
    st.stats.wins++;
    const loot = 150 + res.kills * 20;
    st.credits += loot;
    notes.push(`戰場繳獲 +${loot} 資金`);
    if (pb.kind === 'reinhardt') {
      st.rep = clamp(st.rep + 12, 0, 100);
      st.reinhardt.weakened = true;
      st.reinhardt.system = 'odin';
      st.reinhardt.frozen = 3;
      st.reinhardt.rebuildAt = st.turn + 5;
      st.reinhardt.sieging = null;
      notes.push('雷因哈特敗走奧丁!議會支持度 +12');
    } else {
      st.rep = clamp(st.rep + 8, 0, 100);
    }
    if (st.owners[pb.systemId] === 'emp') {
      st.owners[pb.systemId] = 'fed';
      st.garrisons[pb.systemId] = 0;
      notes.push(`${SYS[pb.systemId].name} 光復!`);
    }
    if (pb.systemId === 'odin') {
      st.over = { win: true, reason: '帝國首都奧丁陷落——戰爭結束!' };
    }
  } else if (res.retreated) {
    st.rep = clamp(st.rep - 5, 0, 100);
    st.playerSystem = st.lastSystem;
    notes.push('有序撤退,議會支持度 -5');
  } else {
    st.rep = clamp(st.rep - 8, 0, 100);
    st.playerSystem = st.lastSystem;
    // 旗艦拖返嚟(戰役唔會一敗即死)
    if (!st.fleet.some(s => s.type === 'flagship')) {
      st.fleet.unshift({ type: 'flagship', hp: Math.round(SHIP_HP.flagship * 0.12), xp: 0 });
      notes.push('旗艦殘骸被拖返後方——需要大修');
    }
    notes.push('敗退,議會支持度 -8');
  }

  if (!st.fleet.some(s => s.type !== 'flagship') && st.credits < 120) {
    st.over = { win: false, reason: '艦隊全滅,議會解除你嘅指揮權。' };
  }
  return notes;
}

// ---------- 回合結束 ----------
export function endTurn(st) {
  const results = [];
  st.turn++;

  // 收入(經濟改革科技加成)
  const baseIncome = SYSTEMS.filter(s => st.owners[s.id] === 'fed').reduce((a, s) => a + s.econ, 0) * 30;
  const income = Math.round(baseIncome * (1 + 0.12 * st.tech.econ));
  st.credits += income;

  // 補給線:友方星域回補(後勤科技加成),敵境消耗
  if (st.owners[st.playerSystem] === 'fed') st.supplies = clamp(st.supplies + 12 + 4 * st.tech.logistics, 0, 100);
  else st.supplies = clamp(st.supplies - 5, 0, 100);
  if (st.supplies <= 0) results.push({ type: 'info', icon: '⚠️', title: '補給線斷絕', text: '艦隊補給耗盡!下場戰鬥士氣大減,盡快返回友方星域。' });

  // 傭兵合約到期
  const before = st.fleet.length;
  st.fleet = st.fleet.filter(s => !(s.merc && s.expires <= st.turn));
  if (st.fleet.length < before) results.push({ type: 'info', icon: '👻', title: '傭兵合約完結', text: '「幽靈」嘅驅逐艦脫離編隊。「合作愉快。」' });

  // 黑天鵝事件
  const ev = pickBlackSwan(st);
  if (ev) results.push({ type: 'event', ev });

  // 議會撥款(每 5 回合)
  if (st.turn % 5 === 0) {
    let grant = 0, text;
    if (st.rep >= 70) { grant = 600; text = '議會全票通過戰爭特別撥款!德里克・蘭恩:「繼續贏落去,錢唔係問題。」'; }
    else if (st.rep >= 40) { grant = 350; text = '議會通過常規軍費撥款。'; }
    else if (st.rep >= 20) { grant = 150; text = '議會勉強通過削減版撥款。反戰派聲勢漸大……'; }
    else { grant = 0; text = '議會否決全部撥款!你嘅指揮權岌岌可危。'; }
    st.credits += grant;
    results.push({ type: 'council', grant, text });
    if (st.rep < 15) {
      st.over = { win: false, reason: '議會通過不信任動議,你被解除艦隊指揮權。' };
    }
  }

  // 帝國行動
  if (!st.over && !st.reinhardt.destroyed) {
    if (st.reinhardt.weakened && st.turn >= st.reinhardt.rebuildAt && st.reinhardt.system === 'odin') {
      st.reinhardt.weakened = false;
      results.push({ type: 'info', icon: '👑', title: '情報', text: '雷因哈特喺奧丁完成艦隊重編,戰力恢復。' });
    }
    if (st.reinhardt.frozen > 0) {
      st.reinhardt.frozen--;
    } else if (st.turn % 3 === 0) {
      if (st.reinhardt.sieging && st.reinhardt.system === st.reinhardt.sieging) {
        // 圍城完成 → 陷落
        const step = st.reinhardt.sieging;
        st.reinhardt.sieging = null;
        if (st.playerSystem === step) {
          st.pendingBattle = { systemId: step, kind: 'reinhardt', defensive: true };
          results.push({ type: 'attack', text: `雷因哈特對${SYS[step].name}發動總攻!艦隊進入迎擊陣位!` });
        } else if (st.owners[step] === 'fed') {
          st.owners[step] = 'emp';
          st.garrisons[step] = Math.max(st.garrisons[step] || 0, 1);
          results.push({ type: 'info', icon: '🚨', title: '星域淪陷', text: `帝國艦隊攻陷咗 ${SYS[step].name}!` });
          if (SYS[step].capital === 'fed') st.over = { win: false, reason: '新特拉維夫陷落,聯邦投降。' };
        }
      } else {
        const step = nextHopTowardFed(st, st.reinhardt.system);
        if (step) {
          st.reinhardt.system = step;
          if (st.owners[step] === 'fed') {
            if (st.playerSystem === step) {
              st.pendingBattle = { systemId: step, kind: 'reinhardt', defensive: true };
              results.push({ type: 'attack', text: `雷因哈特艦隊突入${SYS[step].name}!艦隊進入迎擊陣位!` });
            } else {
              st.reinhardt.sieging = step;
              const cap = SYS[step].capital === 'fed';
              results.push({ type: 'info', icon: cap ? '🆘' : '⚠️', title: cap ? '首都危急!' : '星域被圍',
                text: `雷因哈特艦隊開始圍攻 ${SYS[step].name}!${cap ? '再唔返去救就完喇!' : '下次帝國行動就會陷落。'}趕返去可以同佢決戰。` });
            }
          }
        }
      }
    }
  }

  refreshIntel(st);
  if (st.over) results.push({ type: 'gameover' });
  return { results, income };
}

// BFS 搵最近聯邦星域嘅下一步
function nextHopTowardFed(st, from) {
  if (st.owners[from] === 'fed') return null;
  const visited = new Set([from]);
  const queue = [[from]];
  while (queue.length) {
    const path = queue.shift();
    const cur = path[path.length - 1];
    if (st.owners[cur] === 'fed') return path[1] || null;
    for (const nxt of SYS[cur].links) {
      if (!visited.has(nxt)) { visited.add(nxt); queue.push([...path, nxt]); }
    }
  }
  return null;
}

// ---------- 存檔 ----------
const SAVE_KEY = 'starHegemonyCampaign';
export function saveCampaign(st, storage) {
  try { (storage || globalThis.localStorage)?.setItem(SAVE_KEY, JSON.stringify(st)); } catch (e) { /* 私隱模式等 */ }
}
export function loadCampaign(storage) {
  try {
    const raw = (storage || globalThis.localStorage)?.getItem(SAVE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) { return null; }
}
export function clearSave(storage) {
  try { (storage || globalThis.localStorage)?.removeItem(SAVE_KEY); } catch (e) { /* noop */ }
}
