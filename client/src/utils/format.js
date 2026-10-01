/**
 * 数值展示：修仙游戏的数字会到亿级，必须压缩显示
 */
const UNITS = [
  { base: 1e16, suffix: '京' },
  { base: 1e12, suffix: '兆' },
  { base: 1e8, suffix: '亿' },
  { base: 1e4, suffix: '万' }
];

export function formatNum(value) {
  const n = Number(value) || 0;
  const abs = Math.abs(n);
  if (abs < 10000) return String(Math.floor(n));

  for (let i = 0; i < UNITS.length; i += 1) {
    const { base, suffix } = UNITS[i];
    if (abs < base) continue;
    const v = Number((n / base).toFixed(2));
    // 9999.9999万 会四舍五入成 10000.00万，看着像溢出，要进位到上一档
    if (Math.abs(v) >= 10000 && i > 0) {
      const up = UNITS[i - 1];
      return `${(n / up.base).toFixed(2)}${up.suffix}`;
    }
    return `${v.toFixed(2)}${suffix}`;
  }
  return String(Math.floor(n));
}

export function formatExact(value) {
  const n = Math.floor(Number(value) || 0);
  return n.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatPct(rate, digits = 1) {
  return `${(Number(rate || 0) * 100).toFixed(digits)}%`;
}

export function formatRate(value) {
  const n = Number(value) || 0;
  return n >= 100 ? formatNum(n) : n.toFixed(1);
}

/** 效果描述：把配置里的 effect 翻译成人话 */
export function effectText(effect) {
  if (!effect) return '';
  const parts = [];
  if (effect.expGain) parts.push(`修为 +${formatNum(effect.expGain)}`);
  if (effect.stoneBonus) parts.push(`灵石产出 +${Math.round(effect.stoneBonus * 100)}%`);
  if (effect.atk) parts.push(`攻击 +${effect.atk}`);
  if (effect.def) parts.push(`防御 +${effect.def}`);
  if (effect.hp) parts.push(`气血 +${effect.hp}`);
  if (effect.breakBonus) parts.push(`突破成功率 +${(effect.breakBonus / 100).toFixed(0)}%`);
  if (effect.resetRoot) parts.push('指定灵根归零');
  return parts.join(' · ');
}

export const RARITY_NAME = { 1: '凡品', 2: '灵品', 3: '宝品', 4: '仙品', 5: '神品', 6: '道品' };
export const TYPE_NAME = { pill: '丹药', artifact: '法宝', skill: '功法', breakStone: '悟道石', rootReset: '奇丹' };
