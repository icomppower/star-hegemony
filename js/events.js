// 黑天鵝事件 + 戰後政治決策卡 — 全部 apply(st) 回傳結果文字
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

function damageRandomShip(st, pct) {
  const targets = st.fleet.filter(s => s.type !== 'flagship');
  if (!targets.length) return null;
  const s = targets[Math.floor(Math.random() * targets.length)];
  const t = { flagship: 800, cruiser: 340, destroyer: 200, frigate: 120 }[s.type];
  s.hp = Math.max(10, Math.round((s.hp ?? t) - t * pct));
  return s;
}

// ---------- 黑天鵝事件 ----------
export const BLACK_SWANS = [
  {
    id: 'plague', icon: '🦠', title: '艦內瘟疫爆發',
    desc: '一艘艦嘅艙內爆發不明病毒,大批船員入咗醫療艙。',
    weight: 2, condition: st => st.fleet.length > 2,
    choices: [
      { label: '隔離該艦(艦體受損 40%)', apply(st) {
        const s = damageRandomShip(st, 0.4);
        return s ? `疫情受控,但 ${zh(s.type)} 戰力大減。` : '疫情自然消退。';
      } },
      { label: '花 150 資金緊急醫療', apply(st) {
        if (st.credits >= 150) { st.credits -= 150; return '醫療隊連夜工作,疫情撲滅,冇損失。'; }
        st.supplies = clamp(st.supplies - 20, 0, 100);
        return '資金不足!只能消耗大量補給應急(補給 -20)。';
      } },
    ],
  },
  {
    id: 'traitor', icon: '🕳️', title: '叛徒洩密',
    desc: '有程式設計師將艦隊部署數據賣俾帝國情報部!',
    weight: 2, condition: () => true,
    choices: [
      { label: '交俾艾莎處理', apply(st) {
        st.flags.traitorCaught = true;
        st.reinhardt.frozen = Math.max(st.reinhardt.frozen, 1);
        return '艾莎・沃恩三日內揪出內鬼——反手餵咗假情報俾帝國。雷因哈特今個回合按兵不動。(敵方行動凍結 1 回合)';
      } },
      { label: '全艦隊通訊靜默(補給 -15)', apply(st) {
        st.supplies = clamp(st.supplies - 15, 0, 100);
        return '艦隊改用燈號通訊,行蹤保住,但補給調度大亂。';
      } },
    ],
  },
  {
    id: 'asteroid', icon: '☄️', title: '隕石帶意外',
    desc: '航線穿過未標記嘅隕石帶,一艘艦被碎片擊中。',
    weight: 2, condition: st => st.fleet.length > 2,
    choices: [
      { label: '唉,認命', apply(st) {
        const s = damageRandomShip(st, 0.3);
        return s ? `${zh(s.type)} 船殼受損 30%。導航官已被記過。` : '幸好只係虛驚一場。';
      } },
    ],
  },
  {
    id: 'ghost', icon: '👻', title: '傭兵頭子「幽靈」',
    desc: '惡名昭彰嘅傭兵艦隊出現,價高者得。「指揮官,做單生意?」',
    weight: 2, condition: st => !st.ghost.active && st.turn > 3,
    choices: [
      { label: '僱用(300 資金,兩艘驅逐艦助陣 5 回合)', apply(st) {
        if (st.credits < 300) return '資金不足,「幽靈」冷笑一聲斷開通訊。';
        st.credits -= 300;
        st.ghost.active = true;
        const exp = st.turn + 5;
        st.fleet.push({ type: 'destroyer', hp: 200, merc: true, expires: exp });
        st.fleet.push({ type: 'destroyer', hp: 200, merc: true, expires: exp });
        return '兩艘塗滿骷髏塗裝嘅驅逐艦加入編隊。「錢貨兩訖。」';
      } },
      { label: '拒絕', apply(st) {
        if (Math.random() < 0.5) { st.ghost.empireHired = true; return '「幽靈」聳聳肩。之後有情報指佢接咗帝國嘅單……(下場戰鬥敵方 +2 艦)'; }
        return '「幽靈」消失喺星雲深處。';
      } },
    ],
  },
  {
    id: 'governor', icon: '🏛️', title: '邊境總督嘅提案',
    desc: '中立星域統治者派密使嚟:「畀啲誠意,我可以考慮企你哋邊。」',
    weight: 2, condition: st => st.owners.governor === 'neutral' && st.credits >= 100,
    choices: [
      { label: '獻上 250 資金厚禮', apply(st) {
        if (st.credits < 250) return '資金不足,密使失望而回。';
        st.credits -= 250;
        st.owners.governor = 'fed';
        return '邊境總督府升起聯邦旗!你獲得咗一個中途補給站。';
      } },
      { label: '「聯邦唔賄賂任何人。」', apply(st) { st.rep = clamp(st.rep + 4, 0, 100); return '密使冷笑離開。議會欣賞你嘅骨氣(支持度 +4)。'; } },
    ],
  },
  {
    id: 'otto', icon: '🎖️', title: '帝國老將退役',
    desc: '情報:鉗形夾擊發明人奧圖・布萊克伍德正式退休,帝國艦隊指揮層動盪。',
    weight: 1, condition: st => !st.flags.otto && st.turn > 5,
    choices: [
      { label: '好消息', apply(st) { st.flags.otto = true; return '帝國艦隊失去定海神針,之後戰鬥敵方士氣 -10。'; } },
    ],
  },
  {
    id: 'scandal', icon: '📰', title: '議會醜聞',
    desc: '有議員爆料指第13艦隊「浪費軍費」,傳媒炒到飛起。',
    weight: 1.5, condition: st => st.turn > 2,
    choices: [
      { label: '由德里克・蘭恩議員擺平(100 資金)', apply(st) {
        if (st.credits < 100) { st.rep = clamp(st.rep - 8, 0, 100); return '資金不足公關,支持度 -8。'; }
        st.credits -= 100;
        return '蘭恩議員一場演說輕鬆化解。「你欠我一次,凱撒。」';
      } },
      { label: '唔理佢', apply(st) { st.rep = clamp(st.rep - 8, 0, 100); return '輿論發酵,議會支持度 -8。'; } },
    ],
  },
  {
    id: 'counterintel', icon: '🕶️', title: '帝國反情報行動',
    desc: '伊莉娜・佩卓娃嘅反情報部門滲透咗你哋嘅偵察網絡,情報渠道岌岌可危。',
    weight: 1.5, condition: st => st.turn > 4,
    choices: [
      { label: '艾莎全力反制(150 資金)', apply(st) {
        if (st.credits < 150) { st.intel.blackout = st.turn + 2; return '資金不足反制,偵察網絡癱瘓 2 回合。'; }
        st.credits -= 150;
        return '艾莎連夜重建加密頻道,偵察網絡冇受影響。「伊莉娜,下次仲未必咁好彩。」';
      } },
      { label: '暫時斷網自保', apply(st) { st.intel.blackout = st.turn + 2; return '主動斷網避險,偵察網絡 2 回合內無法使用。「伊莉娜・佩卓娃又贏一仗。」'; } },
    ],
  },
  {
    id: 'convoy', icon: '🚚', title: '補給船隊到達',
    desc: '菲比・克羅斯安排嘅補給船隊突破封鎖成功會合!',
    weight: 2, condition: st => st.supplies < 60,
    choices: [
      { label: '太好喇', apply(st) { st.supplies = clamp(st.supplies + 30, 0, 100); return '補給 +30。「下次唔好用到咁盡啦,指揮官。」'; } },
    ],
  },
];

// ---------- 戰後政治決策卡 ----------
export const DECISIONS = [
  {
    id: 'prisoners', icon: '⛓️', title: '戰俘處置',
    desc: '救生艙裏面撈返幾百個帝國船員。點處置?',
    choices: [
      { label: '全部釋放', apply(st) { st.rep = clamp(st.rep + 6, 0, 100); return '人道之舉傳遍兩國,議會支持度 +6。帝國宣傳機器一時語塞。'; } },
      { label: '移交軍事法庭', apply(st) { st.credits += 100; return '戰俘換咗筆情報獎金(+100 資金),但有官員私下皺眉。'; } },
    ],
  },
  {
    id: 'wreck', icon: '🛠️', title: '戰場打撈',
    desc: '一艘帝國護衛艦大致完好咁漂浮喺戰場。',
    choices: [
      { label: '收編入伍', apply(st) { st.fleet.push({ type: 'frigate', hp: 80 }); st.rep = clamp(st.rep - 3, 0, 100); return '塗掉帝國徽章,護衛艦入列!(議會嫌你「唔跟程序」,支持度 -3)'; } },
      { label: '拆件變賣', apply(st) { st.credits += 150; return '艦體部件賣出,+150 資金。'; } },
    ],
  },
  {
    id: 'press', icon: '🎙️', title: '戰地記者專訪',
    desc: '聯邦新聞網想做一集你嘅英雄專題。',
    choices: [
      { label: '高調宣傳勝利', apply(st) { st.rep = clamp(st.rep + 8, 0, 100); return '收視爆燈,議會支持度 +8。艾莎提醒:「太出風頭,帝國情報部會更落力搞你。」'; } },
      { label: '將功勞歸俾船員', apply(st) { st.rep = clamp(st.rep + 3, 0, 100); return '低調得體。艦隊上下士氣高漲,議會支持度 +3。'; } },
    ],
  },
  {
    id: 'refugees', icon: '🛟', title: '難民船隊求救',
    desc: '戰區邊緣有民用船隊燃料耗盡,請求護航物資。',
    choices: [
      { label: '分出補給救援(補給 -15)', apply(st) { st.supplies = clamp(st.supplies - 15, 0, 100); st.rep = clamp(st.rep + 7, 0, 100); return '難民獲救。呢單新聞令議會反戰派都無話可說(支持度 +7)。'; } },
      { label: '戰時冇餘力', apply(st) { st.rep = clamp(st.rep - 5, 0, 100); return '軍事上正確,政治上失分(支持度 -5)。'; } },
    ],
  },
];

export function pickBlackSwan(st) {
  if (Math.random() > 0.35) return null;
  const pool = BLACK_SWANS.filter(e => e.condition(st) && !st.usedEvents.includes(e.id));
  if (!pool.length) return null;
  const total = pool.reduce((a, e) => a + e.weight, 0);
  let r = Math.random() * total;
  for (const e of pool) { r -= e.weight; if (r <= 0) { if (e.id === 'otto' || e.id === 'governor') st.usedEvents.push(e.id); return e; } }
  return pool[0];
}

export function pickDecision(st) {
  const pool = DECISIONS.filter(d => !st.recentDecisions.includes(d.id));
  const pick = pool.length ? pool[Math.floor(Math.random() * pool.length)] : DECISIONS[Math.floor(Math.random() * DECISIONS.length)];
  st.recentDecisions.push(pick.id);
  if (st.recentDecisions.length > 2) st.recentDecisions.shift();
  return pick;
}

function zh(type) {
  return { flagship: '旗艦', cruiser: '巡洋艦', destroyer: '驅逐艦', frigate: '護衛艦' }[type];
}
