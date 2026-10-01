/**
 * 坊市：灵石买卖
 *
 * 特例：悟道石与当前大境界相符时，购买即视为立即参悟（不进背包）。
 */
const db = require('../config/db');
const dao = require('../dao');
const game = require('../game');
const formula = require('../core/formula');
const { computeSettle } = require('../core/settle');
const roleService = require('./role.service');
const { err } = require('../utils/http');
const { formatDateTime } = require('../utils/time');

function annotate(t, role) {
  const isBreakStone = t.type === 'breakStone';
  // 法宝/功法/悟道石都标了对应大境界，丹药没有
  const hasRealm = t.realm !== undefined && t.realm !== null;
  const realmMatch = hasRealm ? t.realm === role.realm : true;
  const per = (t.effect && t.effect.breakBonus) || 0;
  // 与本境界相符时，实时算出「再买几颗就到 100%」，避免买超了浪费灵石
  const maxUseful = isBreakStone && realmMatch ? formula.maxUsefulBreakStones(role, per) : null;
  return {
    itemId: t.id,
    name: t.name,
    type: t.type,
    rarity: t.rarity,
    icon: t.icon,
    desc: t.desc,
    price: t.price,
    sellPrice: Math.max(1, Math.floor(t.price * game.world.sellRate)),
    effect: t.effect,
    realm: hasRealm ? t.realm : null,
    realmName: hasRealm ? game.realms[t.realm].name : null,
    realmMatch,
    breakBonusPer: isBreakStone ? per / 10000 : null,
    maxUseful,
    // 悟道石与本境界相符且还有提升空间 → 买入即刻生效
    immediate: isBreakStone && realmMatch && maxUseful > 0,
    usableNow: !isBreakStone || realmMatch
  };
}

async function list(accountId) {
  const role = await dao.findRoleByAccount(db.pool, accountId);
  if (!role) throw err.notFound('角色不存在');

  // 与购买时的扣款口径保持一致：都带上未落库的结算收益，
  // 否则"买得起吗"的判断会因为两个接口用不同的余额而打架。
  const equipped = await roleService.equippedTemplates(db.pool, role.id);
  const settle = computeSettle(role, equipped);

  const rows = await dao.listItems(db.pool, role.id);
  const owned = new Map(rows.map((r) => [r.item_id, r.num]));

  const items = game.items
    .slice()
    .sort((a, b) => a.rarity - b.rarity || a.price - b.price)
    .map((t) => Object.assign(annotate(t, role), { owned: owned.get(t.id) || 0 }));

  return {
    spiritStone: Number(role.spirit_stone) + settle.stone,
    realm: role.realm,
    realmName: game.realms[role.realm].name,
    items
  };
}

/** 购买：原子扣灵石，并发下不会扣成负数 */
async function buy(accountId, itemId, num = 1) {
  const id = Number(itemId);
  const count = Math.floor(Number(num) || 0);
  if (!id || count <= 0 || count > 99) throw err.param('购买数量不合法');

  const tpl = game.itemMap.get(id);
  if (!tpl) throw err.notFound('物品不存在');

  const result = await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');

    const equipped = await roleService.equippedTemplates(conn, role.id);
    const settle = computeSettle(role, equipped);
    const stone = Number(role.spirit_stone) + settle.stone;

    // 悟道石：境界相符则买下即参悟，不相符才进背包
    const per = (tpl.effect && tpl.effect.breakBonus) || 0;
    const realmMatch = tpl.type === 'breakStone' && tpl.realm === role.realm;
    const maxUseful = realmMatch ? formula.maxUsefulBreakStones(role, per) : null;
    if (realmMatch && maxUseful <= 0) {
      throw err.condition('突破成功率已达 100%，无需再买悟道石');
    }

    // 可叠加购买，但只按"真正用得上"的数量收钱 —— 多买不会浪费灵石
    const applied = realmMatch ? Math.min(count, maxUseful) : count;
    const clamped = realmMatch && applied < count;
    const total = tpl.price * applied;
    if (stone < total) throw err.notEnough(`灵石不足，尚需 ${total - stone} 枚`);

    const fields = {
      spirit_stone: stone - total,
      exp: Number(role.exp) + settle.exp,
      last_settle_at: formatDateTime(settle.now)
    };
    let rateBefore = null;
    let rateAfter = null;

    if (realmMatch) {
      rateBefore = formula.breakRate(role);
      const nextBonus = Math.min(10000, (Number(role.break_bonus) || 0) + per * applied);
      fields.break_bonus = nextBonus;
      rateAfter = formula.breakRate(Object.assign({}, role, { break_bonus: nextBonus }));
    } else {
      await dao.addItem(conn, role.id, id, applied);
    }

    await dao.updateRoleFields(conn, role.id, fields);
    await dao.insertCurrencyLogs(conn, roleService.currencyLogs(role, {
      stone: stone - total,
      exp: fields.exp,
      settle,
      entries: [{ kind: 'stone', delta: -total, reason: 'shop', remark: `${tpl.name}×${applied}` }]
    }));
    await dao.insertActionLog(conn, role.id, 'shop', realmMatch
      ? `购入 ${tpl.name} ×${applied}${clamped ? `（只收了用得上的 ${applied} 颗，其余退款）` : ''} 并即刻参悟，突破成功率 ${Math.round(rateBefore * 100)}% → ${Math.round(rateAfter * 100)}%，耗灵石 ${total}`
      : `在坊市购入 ${tpl.name} ×${applied}，耗灵石 ${total}`);

    return {
      itemId: id,
      num: applied,
      requested: count,
      clamped,
      name: tpl.name,
      cost: total,
      immediate: realmMatch,
      maxUseful,
      rateBefore,
      rateAfter
    };
  });

  const view = await roleService.getProfile(accountId);
  return Object.assign({ bought: result }, view);
}

module.exports = { list, buy };
