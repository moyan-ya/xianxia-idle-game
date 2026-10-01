/**
 * 试炼塔数值标定器
 *
 *   node scripts/tune-tower.js            # 打印标定结果与平衡体检表
 *   node scripts/tune-tower.js --write    # 直接写回 src/game/stage.json
 *
 * 设计目标（每层按"预期境界档"标定）：
 *   - 参考玩家 = 该档境界中期 + **上一档**的法宝与功法
 *     （刻意只按上一档装备标定：这样刚升入本境界的人，不必先攒够本档装备就能清掉
 *       上一档的层，符合"每个大境界对应约 2 层"的预期）
 *   - 克制系数必须按"这层怪物的五行"用 formula 真实算出来，不能用固定常数
 *     —— 同一个道体打不同五行，攻方系数能在 0.75~1.30 浮动，守方同理；
 *        用常数会把某些层（例如攻 0.975 / 守 1.075 的第 8 层）标成必败墙
 *   - 让参考玩家约 ROUNDS 回合击杀，期间损失约 HP_LOSS 比例的气血
 *   - 失败惩罚：每层扣的修为 = 该层奖励修为 × failExpRate（层数越高扣得越多）
 *   - 灵石奖励沿用原来的口径：exp / 20
 *
 * 这个文件同时被 scripts/bug-probe.js 引用（导出参考玩家与映射表），
 * 保证"标定用的参考玩家"和"测试用的参考玩家"永远是同一个。
 */
const fs = require('fs');
const path = require('path');
const game = require('../src/game');
const formula = require('../src/core/formula');

/** 每层对应的预期境界档（1..8 → 八个大境界） */
const FLOOR_BAND = [1, 1, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7, 7, 8];

/**
 * 每档的参考配置：境界、境界内层数、法宝、功法。
 * 装备刻意取"上一档"：band 2（筑基）用炼气装备，band 8（大乘）用合体装备。
 */
const BANDS = {
  1: { realm: 0, level: 1, artifact: 21, skill: null },
  2: { realm: 1, level: 4, artifact: 21, skill: 11 },
  3: { realm: 2, level: 4, artifact: 23, skill: 12 },
  4: { realm: 3, level: 4, artifact: 25, skill: 13 },
  5: { realm: 4, level: 4, artifact: 26, skill: 14 },
  6: { realm: 5, level: 4, artifact: 27, skill: 15 },
  7: { realm: 6, level: 4, artifact: 28, skill: 16 },
  8: { realm: 7, level: 4, artifact: 29, skill: 17 }
};

/** 每层的微调：[气血倍率, 攻击倍率]。同档第二层比第一层更硬一点。 */
const FLOOR_MUL = [
  [0.55, 0.50], // 1  新手关：按"最差道体"压过 —— 五灵根全是 5 也必过，不会有人卡在新手村
  [1.00, 1.05], // 2
  [1.00, 1.00], [1.15, 1.08],
  [1.00, 1.00], [1.15, 1.08],
  [1.00, 1.00], [1.15, 1.08],
  [1.00, 1.00], [1.15, 1.08],
  [1.00, 1.00], [1.15, 1.08],
  [1.00, 1.00], [1.15, 1.08],
  [1.00, 1.00]
];

/** 参考灵根：一条主灵根偏高的中等 build */
const REF_ROOTS = { 金: 80, 木: 60, 水: 40, 火: 20, 土: 0 };
const ROUNDS = 8;          // 目标回合数
const HP_LOSS = 0.40;      // 目标气血损失比例
const FAIL_EXP_RATE = 0.35;
const DEF_FACTOR = game.world.combat.defFactor;

/** 该档的参考玩家（含装备加成后的面板） */
function refPlayer(band) {
  const cfg = BANDS[band];
  const equipped = [cfg.artifact, cfg.skill]
    .filter(Boolean)
    .map((id) => game.itemMap.get(id))
    .filter(Boolean);
  return formula.derive({
    realm: cfg.realm,
    realm_level: cfg.level,
    roots: REF_ROOTS,
    cave_level: 1,
    break_pity: 0,
    break_bonus: 0
  }, equipped);
}

/** 该境界"练满一层需要多少修为"的总量，用来定奖励 */
function realmTotalExp(band) {
  const realms = game.realms;
  const expBase = realms[Math.min(band - 1, realms.length - 1)].expBase;
  const g = game.levelGrowth;
  const n = game.levelsPerRealm;
  return Math.round(expBase * (Math.pow(g, n) - 1) / (g - 1));
}

/** 按设计规则算出 15 层的完整数值 */
function buildStages() {
  const stages = [];
  for (let i = 0; i < FLOOR_BAND.length; i += 1) {
    const floor = i + 1;
    const band = FLOOR_BAND[i];
    const d = refPlayer(band);
    const src = game.stages[i]; // 沿用原来的名字与五行
    const [hpMul, atkMul] = FLOOR_MUL[i];

    const atkCoef = formula.attackRootMul(REF_ROOTS, src.element).mul;
    const defCoef = formula.defendRootMul(REF_ROOTS, src.element).mul;

    const effAtk = d.atk * atkCoef;
    // 同档第二层整体更强：气血/攻击/防御都乘上该层的微调倍率，保证每层数值两两不同
    const mdef = Math.max(1, Math.round(0.12 * effAtk * atkMul));
    const playerHit = Math.max(1, effAtk - DEF_FACTOR * mdef);
    const mhp = Math.max(1, Math.round(ROUNDS * playerHit * hpMul));

    // 让参考玩家在击杀所需回合内损失约 HP_LOSS 比例的气血
    const roundsToKill = mhp / playerHit;
    const wantTaken = (HP_LOSS * d.hp * (roundsToKill / ROUNDS)) / roundsToKill;
    const matk = Math.max(1, Math.round(((wantTaken + DEF_FACTOR * d.def) / defCoef) * atkMul));

    const totalExp = realmTotalExp(band);
    // 同档第二层更硬 → 奖励与失败惩罚同步更高，保证每一层的数值都不相同
    const exp = Math.round(totalExp * 0.12 * hpMul);
    const stone = Math.max(1, Math.round(exp / 20));
    const failExp = Math.round(exp * FAIL_EXP_RATE);

    stages.push({
      id: floor,
      name: src.name,
      element: src.element,
      band,
      monster: { name: src.monster.name, hp: mhp, atk: matk, def: mdef, speed: 8 + band },
      reward: { exp, stone },
      failExp,
      _ref: { atk: d.atk, def: d.def, hp: d.hp, playerHit, roundsToKill }
    });
  }

  // 单调修正：五行克制会让某些层换算出的数值反而变小
  // （例如第 6 层对参考道体不利，算出来的怪比第 5 层还弱），
  // 这里只升不降地捋一遍，保证"层数越高越强"这条直觉始终成立。
  for (let i = 1; i < stages.length; i += 1) {
    const prev = stages[i - 1].monster;
    const cur = stages[i].monster;
    cur.hp = Math.max(cur.hp, Math.ceil(prev.hp * 1.02));
    cur.atk = Math.max(cur.atk, Math.ceil(prev.atk * 1.02));
    cur.def = Math.max(cur.def, Math.ceil(prev.def * 1.02));
  }

  return stages;
}

function main() {
  const stages = buildStages();

  if (process.argv.includes('--write')) {
    const out = {
      _comment: '试炼塔：逐层解锁，首通全额奖励，重复挑战 30% 奖励，挑战失败按 failExp 扣修为。数值由 scripts/tune-tower.js 标定，改平衡请改那个脚本再重跑。',
      repeatRewardRate: game.repeatRewardRate,
      stages: stages.map((s) => ({
        id: s.id, name: s.name, element: s.element,
        monster: s.monster, reward: s.reward, failExp: s.failExp
      }))
    };
    fs.writeFileSync(path.join(__dirname, '..', 'src', 'game', 'stage.json'), JSON.stringify(out, null, 2) + '\n', 'utf8');
    console.log('已写回 src/game/stage.json');
    return;
  }

  console.log('\n层  档  预期境界      怪物气血        怪物攻击    怪物防御  攻方系数 守方系数  奖励修为     失败扣修为');
  stages.forEach((s, i) => {
    const ele = s.element;
    const ac = formula.attackRootMul(REF_ROOTS, ele).mul.toFixed(3);
    const dc = formula.defendRootMul(REF_ROOTS, ele).mul.toFixed(3);
    console.log(
      `${String(s.id).padStart(2)}  ${s.band}  ${game.realms[BANDS[s.band].realm].name.padEnd(6)}  ` +
      `${String(s.monster.hp).padStart(12)}  ${String(s.monster.atk).padStart(10)}  ` +
      `${String(s.monster.def).padStart(8)}  ${ac.padStart(8)} ${dc.padStart(8)}  ` +
      `${String(s.reward.exp).padStart(10)}  ${String(s.failExp).padStart(12)}`
    );
  });
  console.log('\n加 --write 可写回 src/game/stage.json\n');
}

if (require.main === module) main();

module.exports = {
  FLOOR_BAND,
  FLOOR_MUL,
  BANDS,
  REF_ROOTS,
  ROUNDS,
  HP_LOSS,
  refPlayer,
  realmTotalExp,
  buildStages
};
