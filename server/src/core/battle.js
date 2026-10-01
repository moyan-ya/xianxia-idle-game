/**
 * 战斗内核 —— 纯函数 + 种子随机。
 *
 * 为什么必须是纯函数：
 *   1) 服务端权威：客户端只发"我要打第 N 层"，结果由服务端算。
 *   2) 可复算：把 seed 存进 log_battle，任何时候都能重跑出同一场战斗，用于查作弊与客服补单。
 *   3) 将来升级成卡牌回合制，只需替换本文件的 simulate，前后端仍共用同一份逻辑。
 *
 * 伤害按「每条灵根分别判定克制」计算，规则见 core/formula.js 的 attackRootMul / defendRootMul。
 */
const { world } = require('../game');
const { createRng, randFloat, chance } = require('./random');
const formula = require('./formula');

const CB = world.combat;

function tagOf(mul, chaos) {
  if (chaos) return { tag: 'chaos', text: '（混沌灵根·五行归元）' };
  if (mul > 1) return { tag: 'advantage', text: '（灵根总体克制）' };
  if (mul < 1) return { tag: 'disadvantage', text: '（灵根总体受制）' };
  return { tag: 'normal', text: '' };
}

/**
 * @param {{name:string, element:string, atk:number, def:number, hp:number, speed:number, roots:object}} player
 * @param {{name:string, element:string, atk:number, def:number, hp:number, speed:number}} monster
 * @param {number} seed
 */
function simulate(player, monster, seed) {
  const rng = createRng(seed);

  // 攻方：每条灵根都对怪物五行判一次；守方：怪物五行对每条灵根判一次
  const attack = formula.attackRootMul(player.roots, monster.element);
  const defend = formula.defendRootMul(player.roots, monster.element);

  const p = Object.assign({}, player, {
    curHp: Math.round(player.hp), maxHp: Math.round(player.hp), side: 'player', mul: attack.mul
  });
  const m = Object.assign({}, monster, {
    curHp: Math.round(monster.hp), maxHp: Math.round(monster.hp), side: 'monster', mul: defend.mul
  });

  const rounds = [];
  let round = 0;

  while (round < CB.maxRounds && p.curHp > 0 && m.curHp > 0) {
    round += 1;
    const first = p.speed >= m.speed ? p : m;
    const second = first === p ? m : p;

    for (const actor of [first, second]) {
      const target = actor === p ? m : p;
      if (actor.curHp <= 0 || target.curHp <= 0) continue;

      const crit = chance(rng, CB.critRate);
      const variance = randFloat(rng, CB.varianceMin, CB.varianceMax);
      let damage = Math.round(
        (actor.atk * actor.mul * variance - target.def * CB.defFactor) * (crit ? CB.critMul : 1)
      );
      if (!Number.isFinite(damage) || damage < 1) damage = 1;

      target.curHp = Math.max(0, target.curHp - damage);
      const isPlayer = actor === p;
      const et = tagOf(actor.mul, isPlayer ? attack.chaos : false);

      rounds.push({
        round,
        side: actor.side,
        actorName: actor.name,
        targetName: target.name,
        element: actor.element,
        mul: actor.mul,
        damage,
        crit,
        effect: et.tag,
        targetHp: target.curHp,
        targetMaxHp: target.maxHp,
        text: `${actor.name} 出手，${target.name} 气血 -${damage}${crit ? '（暴击）' : ''}${et.text}`
      });

      if (target.curHp <= 0) break;
    }
  }

  const win = m.curHp <= 0 && p.curHp > 0;
  const timeout = round >= CB.maxRounds && p.curHp > 0 && m.curHp > 0;

  return {
    win,
    timeout,
    seed,
    rounds,
    roundCount: round,
    playerHp: p.curHp,
    playerMaxHp: p.maxHp,
    monsterHp: m.curHp,
    monsterMaxHp: m.maxHp,
    player: { name: p.name, element: p.element, atk: p.atk, def: p.def, hp: p.maxHp, speed: p.speed, mul: attack.mul },
    monster: { name: m.name, element: m.element, atk: m.atk, def: m.def, hp: m.maxHp, speed: m.speed, mul: defend.mul },
    // 供"战斗推演"页展示的完整判定过程
    rootFormula: { attack, defend, chaos: attack.chaos, empty: attack.empty }
  };
}

/**
 * 不开打，只算账：把伤害公式推导过程完整算出来，供玩家查看。
 * 纯函数，没有随机数（用期望值代替 0.95~1.05 的波动）。
 */
function preview(player, monster) {
  const attack = formula.attackRootMul(player.roots, monster.element);
  const defend = formula.defendRootMul(player.roots, monster.element);

  const critAvg = 1 + CB.critRate * (CB.critMul - 1);
  const playerHit = Math.max(1, Math.round((player.atk * attack.mul - monster.def * CB.defFactor) * critAvg));
  const monsterHit = Math.max(1, Math.round((monster.atk * defend.mul - player.def * CB.defFactor) * critAvg));

  const roundsToKill = Math.ceil(monster.hp / playerHit);
  const roundsToDie = Math.ceil(player.hp / monsterHit);
  const timeout = roundsToKill > CB.maxRounds;

  return {
    target: { name: monster.name, element: monster.element, hp: monster.hp, atk: monster.atk, def: monster.def, speed: monster.speed },
    self: {
      name: player.name,
      rootTitle: player.rootTitle,
      roots: player.roots,
      atk: player.atk,
      def: player.def,
      hp: player.hp,
      speed: player.speed
    },
    constants: {
      elementAdvantage: CB.elementAdvantage,
      elementDisadvantage: CB.elementDisadvantage,
      rootMulScale: CB.rootMulScale,
      minRootMul: CB.minRootMul,
      emptyRootMul: CB.emptyRootMul,
      chaosMul: CB.chaosMul,
      defFactor: CB.defFactor,
      critRate: CB.critRate,
      critMul: CB.critMul,
      maxRounds: CB.maxRounds,
      rootMax: world.rootRoll.max
    },
    attack,
    defend,
    damage: {
      playerHit,
      playerHitRange: [
        Math.max(1, Math.round((player.atk * attack.mul * CB.varianceMin - monster.def * CB.defFactor))),
        Math.max(1, Math.round((player.atk * attack.mul * CB.varianceMax - monster.def * CB.defFactor) * CB.critMul))
      ],
      monsterHit,
      roundsToKill,
      roundsToDie,
      timeout,
      verdict: timeout ? '打不动（超过回合上限）' : (roundsToKill < roundsToDie ? '优势' : '劣势')
    }
  };
}

module.exports = { simulate, preview };
