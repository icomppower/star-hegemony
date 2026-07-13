// 人物名冊 — 來自 GDD Character Roster
export const OFFICERS = [
  { id: 'maya', name: '瑪雅・霍克', role: '艦隊司令', icon: '🛡️',
    effect: '梯次防禦受創 -50%、冷卻 -25%' },
  { id: 'ray', name: '雷・莫拉萊斯', role: '突擊隊長', icon: '🎯',
    effect: '斬首行動傷害 +75%、突擊速度 +40%' },
  { id: 'phoebe', name: '菲比・克羅斯', role: '工程官', icon: '🔧',
    effect: '修理費 -20%、補給消耗 -20%' },
  { id: 'elsa', name: '艾莎・沃恩', role: '情報官', icon: '🕵️',
    effect: '戰鬥中可策反敵艦(每場一次)、星圖顯示敵軍力' },
];

// 玩家艦隊官方 mods (全員隨艦)
export const OFFICER_MODS = {
  echelonIn: 0.5,      // Maya
  echelonCdMult: 0.75, // Maya
  strikeOut: 1.75,     // Ray
  strikeSpeed: 1.4,    // Ray
};

export const REPAIR_DISCOUNT = 0.8;  // Phoebe
export const SUPPLY_DISCOUNT = 0.8;  // Phoebe

export const COMMANDER_INFO = {
  reinhardt: { name: '法爾肯・雷因哈特', title: '帝國天才提督', icon: '👑' },
  wolf:      { name: '卡西米爾・沃夫',   title: '中央突破專精・進攻狂', icon: '🐺' },
  garrison:  { name: '駐防艦隊司令',     title: '帝國正規軍', icon: '⚓' },
};
