// 六大戰術 — 定義來自 GDD 戰術表
export const TACTICS = [
  {
    id: 'breakthrough', key: '1', icon: '⚡',
    name: '中央突破', en: 'Central Breakthrough',
    cd: 25, dur: 12,
    desc: '集中火力打穿敵陣中央,分割敵艦隊',
    risk: '己方陣型變薄弱,受創 +25%',
  },
  {
    id: 'pincer', key: '2', icon: '🦂',
    name: '鉗形夾擊', en: 'Pincer Movement',
    cd: 30, dur: 22,
    desc: '兩翼包抄敵艦隊,形成交叉火網 (+30% 傷害)',
    risk: '分艦隊協調唔好會俾人各個擊破',
  },
  {
    id: 'feint', key: '3', icon: '🎣',
    name: '誘敵深入', en: 'Feigned Retreat',
    cd: 35, dur: 13,
    desc: '前鋒詐敗撤退,引敵追擊入伏擊圈',
    risk: '演技唔夠逼真,敵方可能睇穿',
  },
  {
    id: 'echelon', key: '4', icon: '🛡️',
    name: '梯次防禦', en: 'Echelon Defense',
    cd: 20, dur: 15,
    desc: '艦隊斜列排開,受創 -35%',
    risk: '移動速度大減,唔適合搶攻',
  },
  {
    id: 'decap', key: '5', icon: '🎯',
    name: '斬首行動', en: 'Decapitation Strike',
    cd: 40, dur: 12,
    desc: '派最快三艦直取敵方旗艦 (+50% 傷害)',
    risk: '突擊隊冇掩護,受創 +50%',
  },
  {
    id: 'scorch', key: '6', icon: '🔥',
    name: '焦土撤退', en: 'Scorched Withdrawal',
    cd: 35, dur: 10,
    desc: '撤退並沿路佈雷,阻延追兵',
    risk: '放棄陣地,犧牲空間換時間',
  },
];

export const TACTIC_BY_ID = Object.fromEntries(TACTICS.map(t => [t.id, t]));
