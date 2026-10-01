/**
 * 惰性离线结算 —— 本项目的性能地基。
 *
 * 核心思想：不遍历全服玩家、不跑定时器。
 * 玩家每次请求时，用 (now - last_settle_at) 算出这段时间该给多少。
 *
 * 产出：灵石（唯一货币）+ 修为（突破消耗）。
 * 离线收益上限：超过 SETTLE_MAX_HOURS 的部分按 overflowRate(20%) 折算。
 */
const config = require('../config');
const { parseDateTime } = require('../utils/time');
const formula = require('./formula');

/**
 * 计算应发收益（纯函数，不改任何状态）
 * @param {object} role 数据库角色行
 * @param {Array} equippedTemplates 已装备物品模板
 * @param {number} now 当前时间戳
 */
function computeSettle(role, equippedTemplates = [], now = Date.now()) {
  const derived = formula.derive(role, equippedTemplates);
  const last = parseDateTime(role.last_settle_at);
  const seconds = Math.floor((now - last) / 1000);

  if (seconds <= 0) {
    return {
      seconds: 0, effectiveSeconds: 0, stone: 0, exp: 0, capped: false,
      rate: derived.stonePerSec, derived, lastSettleAt: role.last_settle_at, offline: false, now
    };
  }

  const capSeconds = config.settle.maxHours * 3600;
  const capped = seconds > capSeconds;
  const effectiveSeconds = capped
    ? capSeconds + (seconds - capSeconds) * config.settle.overflowRate
    : seconds;

  const stone = Math.floor(derived.stonePerSec * effectiveSeconds);
  const exp = Math.floor(stone * config.settle.expRate);

  return {
    seconds,
    effectiveSeconds: Math.round(effectiveSeconds * 100) / 100,
    stone,
    exp,
    capped,
    rate: derived.stonePerSec,
    derived,
    lastSettleAt: role.last_settle_at,
    offline: seconds >= 300,
    // 计算这一笔收益时所用的时刻。落库时必须把 last_settle_at 写成它，
    // 而不是 NOW()：否则「发放的区间」与「推进的基准」会有偏差，
    // 每次结算都悄悄少发一点点（写库延迟 + 应用与数据库时钟差）。
    now
  };
}

/** 把未落库的收益叠加到角色视图上（返回新对象，不改原对象） */
function projectRole(role, settle) {
  return Object.assign({}, role, {
    spirit_stone: Number(role.spirit_stone) + settle.stone,
    exp: Number(role.exp) + settle.exp
  });
}

module.exports = { computeSettle, projectRole };
