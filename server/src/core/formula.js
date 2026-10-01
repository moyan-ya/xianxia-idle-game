/**
 * 数值公式：全部读配置表，改 JSON 即可调平衡。
 * 纯函数，不碰数据库 —— 方便单测、也方便前后端复用。
 *
 * 货币只有一种：灵石（spirit_stone）。挂机产出灵石与修为。
 * 伤害按「每条灵根分别判定克制」计算，见 attackRootMul / defendRootMul。
 */
const game = require('../game');

const { world, levelsPerRealm, levelGrowth, realms } = game;
const CB = world.combat;

function parseRoots(roots) {
  if (!roots) return {};
  if (typeof roots !== 'string') return roots;
  // mysql2 正常会把 JSON 列传成对象；这里只是兜底，
  // 一旦解析失败也不能让整个档案接口 500。
  try {
    return JSON.parse(roots);
  } catch (e) {
    console.error('[灵根数据异常]', roots);
    return {};
  }
}

/** 各灵根的洗练保底计数 */
function parseRootPity(pity) {
  const empty = {};
  world.elements.forEach((el) => { empty[el] = 0; });
  if (!pity) return empty;
  let obj = pity;
  if (typeof pity === 'string') {
    try { obj = JSON.parse(pity); } catch (e) { return empty; }
  }
  world.elements.forEach((el) => { empty[el] = Number(obj[el]) || 0; });
  return empty;
}

/** 有效灵根：值 > 0 的，按五行固定顺序排列 */
function activeRoots(roots) {
  const r = parseRoots(roots);
  return world.elements
    .map((el) => ({ element: el, value: Number(r[el]) || 0 }))
    .filter((x) => x.value > 0);
}

function isChaosRoots(roots) {
  const r = parseRoots(roots);
  const max = world.rootRoll.max;
  return world.elements.every((el) => (Number(r[el]) || 0) >= max);
}

/**
 * 主灵根命名 —— 完全由「值为 0 的灵根不计入」来判定：
 *   0 条       无灵根
 *   1 条       单X灵根；若该条已是满值 → 天X灵根
 *   2 条       金木双灵根
 *   3 / 4 条   金木水三灵根 / 金木水火四灵根
 *   5 条全满   混沌灵根
 *   5 条未满   金木水火土五灵根
 */
function rootTitle(roots) {
  if (isChaosRoots(roots)) return '混沌灵根';
  const list = activeRoots(roots);
  if (!list.length) return '无灵根';

  const names = world.rootCountName || {};
  if (list.length === 1) {
    const el = list[0].element;
    return list[0].value >= world.rootRoll.max ? `天${el}灵根` : `单${el}灵根`;
  }
  const prefix = list.map((x) => x.element).join('');
  return `${prefix}${names[String(list.length)] || list.length}灵根`;
}

/** 主灵根 = 数值最高的那一条（用于挂机加成、攻击加成与配色） */
function mainRoot(roots) {
  const r = parseRoots(roots);
  const elements = world.elements;
  let best = elements[0];
  elements.forEach((el) => { if ((r[el] || 0) > (r[best] || 0)) best = el; });
  return { element: best, value: r[best] || 0, all: r };
}

/** 全局等级：境界数 * 9 + 层数，用于线性战力成长 */
function totalLevel(role) {
  return role.realm * levelsPerRealm + (role.realm_level - 1);
}

function realmInfo(role) {
  return realms[role.realm] || realms[0];
}

/** 当前层突破到下一层所需修为 */
function expNeed(role) {
  const r = realmInfo(role);
  return Math.round(r.expBase * Math.pow(levelGrowth, role.realm_level - 1));
}

function caveInfo(level) {
  return world.cave.find((c) => c.level === level) || world.cave[0];
}

function nextCave(level) {
  return world.cave.find((c) => c.level === level + 1) || null;
}

/** 装备（法宝 + 功法）带来的加成合计 */
function equipBonus(templates = []) {
  const bonus = { stoneBonus: 0, atk: 0, def: 0, hp: 0 };
  templates.filter(Boolean).forEach((t) => {
    const e = t.effect || {};
    bonus.stoneBonus += e.stoneBonus || 0;
    bonus.atk += e.atk || 0;
    bonus.def += e.def || 0;
    bonus.hp += e.hp || 0;
  });
  return bonus;
}

/** 出售价：市价 × sellRate（向下取整，至少 1） */
function sellPrice(template, num = 1) {
  const unit = Math.max(1, Math.floor((template.price || 0) * world.sellRate));
  return { unit, total: unit * num };
}

/** 洗练一次的花费：随该灵根当前值递增（值越高越贵） */
function rerollCost(value) {
  const { base, factor } = world.rerollRootsCost;
  const ratio = Math.min(1, Math.max(0, Number(value) || 0) / world.rootRoll.max);
  return Math.round(base + base * factor * ratio * ratio);
}

/** 五行相克系数：金克木、木克土、土克水、水克火、火克金 */
function elementFactor(attacker, defender) {
  const c = world.elementCycle;
  if (c[attacker] === defender) return CB.elementAdvantage;
  if (c[defender] === attacker) return CB.elementDisadvantage;
  return 1;
}

/**
 * 攻方灵根系数（这套公式的核心）
 *
 *   score_e = 克制系数(e → 目标) × 灵根值(e) / 满值
 *   rootMul = Σ score_e / 有效灵根条数 × rootMulScale
 *
 * 由此得到三条设计意图：
 *   1) 灵根值越高 → score 越高 → 伤害越高；
 *   2) 灵根条数越少 → 不会被低值灵根拉低平均 → 单灵根有优势；
 *   3) 五条全部圆满 → 直接取 chaosMul，混沌灵根另有额外优势。
 */
function attackRootMul(roots, targetElement) {
  const max = world.rootRoll.max;
  const list = activeRoots(roots);
  const breakdown = list.map((x) => {
    const factor = elementFactor(x.element, targetElement);
    const weight = Number((x.value / max).toFixed(4));
    return {
      element: x.element,
      value: x.value,
      factor,
      weight,
      score: Number((factor * weight).toFixed(4))
    };
  });

  if (isChaosRoots(roots)) {
    // 混沌同样要乘平衡系数，才能保证「混沌 > 单灵根满值」：
    // 1.5 × 1.9 = 2.85 > 1.3 × 1.9 = 2.47
    return {
      mul: Number((CB.chaosMul * CB.rootMulScale).toFixed(4)),
      chaos: true,
      empty: false,
      count: list.length,
      sum: null,
      avg: CB.chaosMul,
      scale: CB.rootMulScale,
      breakdown
    };
  }

  if (!list.length) {
    return {
      mul: CB.emptyRootMul,
      chaos: false,
      empty: true,
      count: 0,
      sum: null,
      avg: null,
      scale: null,
      breakdown
    };
  }

  const sum = breakdown.reduce((acc, b) => acc + b.score, 0);
  const avg = Number((sum / list.length).toFixed(4));
  return {
    mul: Number(Math.max(CB.minRootMul, avg * CB.rootMulScale).toFixed(4)),
    chaos: false,
    empty: false,
    count: list.length,
    sum: Number(sum.toFixed(4)),
    avg,
    scale: CB.rootMulScale,
    breakdown
  };
}

/**
 * 守方灵根系数：对方五行对自己的平均克制系数。
 * 刻意不加权、不缩放 —— 灵根越多越接近 1.0（稳），
 * 单灵根则是把身家押在一种对抗关系上（可能扛揍，也可能被克）。
 */
function defendRootMul(roots, attackerElement) {
  const list = activeRoots(roots);
  const breakdown = list.map((x) => ({
    element: x.element,
    value: x.value,
    factor: elementFactor(attackerElement, x.element)
  }));
  if (!breakdown.length) return { mul: 1, count: 0, breakdown };
  const avg = breakdown.reduce((acc, b) => acc + b.factor, 0) / breakdown.length;
  return { mul: Number(avg.toFixed(4)), count: breakdown.length, breakdown };
}

/**
 * 派生属性：角色面板上能看到的一切
 * @param {object} role 数据库角色行
 * @param {Array} equippedTemplates 已装备物品的配置模板
 */
function derive(role, equippedTemplates = []) {
  const r = realmInfo(role);
  const mr = mainRoot(role.roots);
  const bonus = equipBonus(equippedTemplates);
  const cave = caveInfo(role.cave_level);
  const lv = totalLevel(role);

  const stonePerSec = r.stonePerSec
    * (1 + 0.1 * (role.realm_level - 1))
    * (1 + mr.value * world.rootMainBonusPerPoint)
    * (1 + cave.stoneBonus)
    * (1 + bonus.stoneBonus);

  const sb = world.statBase;
  const atk = Math.round((sb.atk + sb.atkPerLv * lv) * (1 + mr.value * sb.rootAtkFactor) + bonus.atk);
  const def = Math.round(sb.def + sb.defPerLv * lv + bonus.def);
  const hp = Math.round(sb.hp + sb.hpPerLv * lv + bonus.hp);
  const speed = sb.speedBase + r.id;
  const bonusRate = Number(role.break_bonus || 0) / 10000;

  // 产出构成（给"提升概览"逐项展示，公式只在这一处实现）
  const levelMul = 1 + 0.1 * (role.realm_level - 1);
  const rootMul = 1 + mr.value * world.rootMainBonusPerPoint;
  const caveMul = 1 + cave.stoneBonus;
  const equipMul = 1 + bonus.stoneBonus;

  return {
    totalLevel: lv,
    realm: { id: r.id, name: r.name, color: r.color, desc: r.desc },
    realmLevel: role.realm_level,
    maxLevel: levelsPerRealm,
    element: mr.element,
    elementColor: world.elementColors[mr.element] || '#d8c27a',
    mainRoot: { element: mr.element, value: mr.value, all: mr.all },
    rootTitle: rootTitle(role.roots),
    rootCount: activeRoots(role.roots).length,
    activeRoots: activeRoots(role.roots),
    chaos: isChaosRoots(role.roots),
    stonePerSec: Math.floor(stonePerSec * 100) / 100,
    stoneBreakdown: {
      base: r.stonePerSec,
      levelMul: Number(levelMul.toFixed(3)),
      rootMul: Number(rootMul.toFixed(3)),
      caveMul: Number(caveMul.toFixed(3)),
      equipMul: Number(equipMul.toFixed(3)),
      total: Math.floor(stonePerSec * 100) / 100
    },
    atk, def, hp, speed,
    bonus,
    cave: { level: cave.level, stoneBonus: cave.stoneBonus, next: nextCave(cave.level) },
    expNeed: expNeed(role),
    breakBonus: Number(bonusRate.toFixed(4)),
    breakDetail: {
      base: r.breakBonus,
      levelPenalty: Number((-world.breakthrough.levelPenalty * (role.realm_level - 1)).toFixed(4)),
      pityBonus: Number((world.breakthrough.pityBonus * (role.break_pity || 0)).toFixed(4)),
      stoneBonus: Number(bonusRate.toFixed(4)),
      baseCapped: Number(breakRateBase(role).toFixed(4)),
      total: breakRate(role),
      hardMax: 1,
      baseMax: world.breakthrough.maxRate
    },
    isMaxRealm: role.realm >= game.maxRealm && role.realm_level >= levelsPerRealm
  };
}

/** 不含悟道石加成的基础成功率（基线上限 maxRate） */
function breakRateBase(role) {
  const bt = world.breakthrough;
  const base = realmInfo(role).breakBonus;
  const raw = base - bt.levelPenalty * (role.realm_level - 1) + bt.pityBonus * (role.break_pity || 0);
  return Math.min(bt.maxRate, Math.max(bt.minRate, raw));
}

/**
 * 突破成功率 = 基础率 + 悟道石加成，硬上限 100%
 */
function breakRate(role) {
  const bonus = (Number(role.break_bonus) || 0) / 10000;
  return Number(Math.min(1, breakRateBase(role) + bonus).toFixed(4));
}

/**
 * 还需要几颗悟道石才到 100%（再多买就是浪费灵石）。
 * 基础率会随境界内层数下降、随失败保底上升，所以这个数要按当前状态实时算。
 * @param {number} perBonusBp 单颗加成，万分比
 */
function maxUsefulBreakStones(role, perBonusBp) {
  const per = Number(perBonusBp) || 0;
  if (per <= 0) return 0;
  const missingBp = Math.max(
    0,
    Math.round((1 - breakRateBase(role)) * 10000) - (Number(role.break_bonus) || 0)
  );
  return Math.ceil(missingBp / per);
}

module.exports = {
  parseRoots,
  parseRootPity,
  activeRoots,
  isChaosRoots,
  rootTitle,
  mainRoot,
  totalLevel,
  realmInfo,
  expNeed,
  caveInfo,
  nextCave,
  equipBonus,
  sellPrice,
  rerollCost,
  elementFactor,
  attackRootMul,
  defendRootMul,
  derive,
  breakRate,
  breakRateBase,
  maxUsefulBreakStones
};
