/**
 * 游戏配置表统一出口。
 * 改 JSON 即可调平衡，代码里不写死任何数值。
 */
const realmJson = require('./realm.json');
const itemJson = require('./item.json');
const stageJson = require('./stage.json');
const world = require('./world.json');

const realms = realmJson.realms;
const levelsPerRealm = realmJson.levelsPerRealm;
const levelGrowth = realmJson.levelGrowth;

const items = itemJson.items;
const itemMap = new Map(items.map((i) => [i.id, i]));

const stages = stageJson.stages;
const stageMap = new Map(stages.map((s) => [s.id, s]));

const maxRealm = realms.length - 1;

/** 深拷贝一份给前端，避免调用方误改配置 */
function publicConfig() {
  // 境界总表：每层所需修为由服务端算好，前端只负责展示，避免公式写两份
  const realmTable = realms.map((r) => ({
    id: r.id,
    name: r.name,
    color: r.color,
    desc: r.desc,
    stonePerSec: r.stonePerSec,
    breakBonus: r.breakBonus,
    totalExp: Math.round(r.expBase * (Math.pow(levelGrowth, levelsPerRealm) - 1) / (levelGrowth - 1)),
    levels: Array.from({ length: levelsPerRealm }, (_, k) => ({
      level: k + 1,
      expNeed: Math.round(r.expBase * Math.pow(levelGrowth, k))
    }))
  }));

  return {
    levelsPerRealm,
    levelGrowth,
    realms,
    realmTable,
    items,
    stages: stages.map((s) => ({ id: s.id, name: s.name, element: s.element, monsterName: s.monster.name, reward: s.reward })),
    world: {
      elements: world.elements,
      elementCycle: world.elementCycle,
      elementColors: world.elementColors,
      cave: world.cave,
      rerollRootsCost: world.rerollRootsCost,
      rootRoll: world.rootRoll,
      rootMainBonusPerPoint: world.rootMainBonusPerPoint,
      rootPityEvery: world.rootPityEvery,
      sellRate: world.sellRate,
      breakthrough: world.breakthrough,
      combat: world.combat
    }
  };
}

module.exports = {
  levelsPerRealm,
  levelGrowth,
  realms,
  maxRealm,
  items,
  itemMap,
  stages,
  stageMap,
  repeatRewardRate: stageJson.repeatRewardRate,
  world,
  publicConfig
};
