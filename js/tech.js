// 科技樹 — 經濟資源系統深化(GDD 待辦項)。三條分支,各 3 級,永久生效。
export const TECH_TREE = [
  {
    id: 'hull', icon: '🛠️', name: '船塢強化 Hull Engineering',
    desc: '維修效率提升,艦體損傷修復更快更平。',
    costs: [400, 700, 1100], perTier: 0.08,
    tierDesc: n => `維修費用 -${n * 8}%`,
  },
  {
    id: 'logistics', icon: '🚚', name: '後勤網絡 Logistics Network',
    desc: '優化補給航線,移動消耗更少,友方星域回補更快。',
    costs: [400, 700, 1100], perTier: 0.1,
    tierDesc: n => `移動補給消耗 -${n * 10}%、友方星域回補 +${n * 4}`,
  },
  {
    id: 'econ', icon: '💰', name: '經濟改革 Economic Reform',
    desc: '星域稅制改革,聯邦稅收顯著提升。',
    costs: [450, 800, 1250], perTier: 0.12,
    tierDesc: n => `星域收入 +${n * 12}%`,
  },
];

export const TECH_BY_ID = Object.fromEntries(TECH_TREE.map(t => [t.id, t]));
export const TECH_MAX_TIER = 3;

export function techCost(st, id) {
  const t = TECH_BY_ID[id];
  const tier = st.tech[id] || 0;
  return tier >= TECH_MAX_TIER ? null : t.costs[tier];
}

export function canResearch(st, id) {
  const cost = techCost(st, id);
  return cost !== null && st.credits >= cost;
}

export function applyResearch(st, id) {
  const cost = techCost(st, id);
  if (cost === null) return { error: '已經研發到最高級' };
  if (st.credits < cost) return { error: '資金不足' };
  st.credits -= cost;
  st.tech[id] = (st.tech[id] || 0) + 1;
  const t = TECH_BY_ID[id];
  return { text: `${t.icon} ${t.name} 升級至 Lv.${st.tech[id]}(${t.tierDesc(st.tech[id])})` };
}
