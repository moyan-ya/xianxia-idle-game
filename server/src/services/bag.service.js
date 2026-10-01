/**
 * 背包、装备、出售，以及特殊道具的使用
 *
 * 道具类型：
 *   pill        丹药 —— 直接转修为
 *   breakStone  悟道石 —— 只能在与自身境界相符时参悟，提升突破成功率（上限 100%）
 *   rootReset   散灵丹 —— 指定一条灵根，其值归零
 */
const db = require('../config/db');
const dao = require('../dao');
const game = require('../game');
const formula = require('../core/formula');
const { computeSettle } = require('../core/settle');
const roleService = require('./role.service');
const { err } = require('../utils/http');
const { formatDateTime } = require('../utils/time');

const EQUIP_TYPES = ['artifact', 'skill'];

/** 把 role_item 行 + 配置模板合成前端要的物件 */
function toItemDTO(row, role) {
  const tpl = game.itemMap.get(row.item_id);
  if (!tpl) return null;
  const unitSell = Math.max(1, Math.floor((tpl.price || 0) * game.world.sellRate));
  const isBreakStone = tpl.type === 'breakStone';
  const matchesRealm = isBreakStone && tpl.realm === role.realm;
  return {
    itemId: row.item_id,
    num: row.num,
    equipped: row.equipped === 1,
    name: tpl.name,
    type: tpl.type,
    rarity: tpl.rarity,
    icon: tpl.icon,
    desc: tpl.desc,
    price: tpl.price,
    sellPrice: unitSell,
    sellTotal: unitSell * row.num,
    canSell: (tpl.price || 0) > 0,
    sellRate: game.world.sellRate,
    effect: tpl.effect,
    realm: isBreakStone ? tpl.realm : null,
    realmName: isBreakStone ? game.realms[tpl.realm].name : null,
    usableNow: !isBreakStone || matchesRealm,
    lockedReason: isBreakStone && !matchesRealm
      ? `${tpl.name} 需在${game.realms[tpl.realm].name}期参悟`
      : null,
    needElement: tpl.type === 'rootReset'
  };
}

async function list(accountId) {
  const role = await dao.findRoleByAccount(db.pool, accountId);
  if (!role) throw err.notFound('角色不存在');

  const rows = await dao.listItems(db.pool, role.id);
  const items = rows
    .filter((r) => r.num > 0)
    .map((r) => toItemDTO(r, role))
    .filter(Boolean)
    .sort((a, b) => b.rarity - a.rarity || a.itemId - b.itemId);

  const equipped = await roleService.equippedTemplates(db.pool, role.id);
  const byType = new Map(equipped.map((t) => [t.type, t]));
  return {
    items,
    realm: role.realm,
    realmName: game.realms[role.realm].name,
    equip: { artifact: byType.get('artifact') || null, skill: byType.get('skill') || null }
  };
}

/** 使用道具的统一入口 */
async function use(accountId, itemId, num = 1, element = null) {
  const id = Number(itemId);
  const count = Math.floor(Number(num) || 0);
  if (!id || count <= 0 || count > 999) throw err.param('使用数量不合法');

  const tpl = game.itemMap.get(id);
  if (!tpl) throw err.notFound('物品不存在');

  if (tpl.type === 'rootReset') return useRootReset(accountId, tpl, element);
  if (tpl.type === 'breakStone') return useBreakStone(accountId, tpl, count);
  if (tpl.type !== 'pill') throw err.condition('该物品不能直接使用');

  await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');

    const equipped = await roleService.equippedTemplates(conn, role.id);
    const settle = computeSettle(role, equipped);

    const okConsume = await dao.consumeItem(conn, role.id, id, count);
    if (!okConsume) throw err.notEnough('丹药数量不足');

    const expGain = (tpl.effect.expGain || 0) * count;
    const stone = Number(role.spirit_stone) + settle.stone;
    const exp = Number(role.exp) + settle.exp + expGain;

    await dao.updateRoleFields(conn, role.id, { spirit_stone: stone, exp, last_settle_at: formatDateTime(settle.now) });
    await dao.insertCurrencyLogs(conn, roleService.currencyLogs(role, {
      stone,
      exp,
      settle,
      entries: [{ kind: 'exp', delta: expGain, reason: 'use', remark: `${tpl.name}×${count}` }]
    }));
    await dao.insertActionLog(conn, role.id, 'use', `服下 ${tpl.name} ×${count}，修为 +${expGain}`);
  });

  const view = await roleService.getProfile(accountId);
  return Object.assign({ used: { itemId: id, num: count, name: tpl.name, kind: 'pill' } }, view);
}

/** 参悟悟道石（只能在与自身境界相符时用）；可一次用多颗，但只消耗用得上的部分 */
async function useBreakStone(accountId, tpl, count) {
  const per = (tpl.effect && tpl.effect.breakBonus) || 0;

  const result = await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');
    if (role.realm !== tpl.realm) {
      throw err.condition(
        `${tpl.name} 只能在${game.realms[tpl.realm].name}期参悟，你如今是${game.realms[role.realm].name}期`
      );
    }

    const maxUseful = formula.maxUsefulBreakStones(role, per);
    if (maxUseful <= 0) throw err.condition('突破成功率已达 100%，无需再参悟');

    const rows = await dao.listItems(conn, role.id);
    const owned = Number((rows.find((r) => r.item_id === tpl.id) || {}).num) || 0;
    if (owned <= 0) throw err.notEnough('悟道石数量不足');

    // 只消耗用得上的部分，剩下的留在背包里，不会白白浪费
    const applied = Math.min(count, maxUseful, owned);
    const okConsume = await dao.consumeItem(conn, role.id, tpl.id, applied);
    if (!okConsume) throw err.notEnough('悟道石数量不足');

    const before = formula.breakRate(role);
    const nextBonus = Math.min(10000, (Number(role.break_bonus) || 0) + per * applied);
    await dao.updateRoleFields(conn, role.id, { break_bonus: nextBonus });
    const after = formula.breakRate(Object.assign({}, role, { break_bonus: nextBonus }));

    await dao.insertActionLog(conn, role.id, 'use',
      `参悟 ${tpl.name} ×${applied}${applied < count ? `（只需 ${applied} 颗即满，其余留在包里）` : ''}，突破成功率 ${Math.round(before * 100)}% → ${Math.round(after * 100)}%`);

    return {
      itemId: tpl.id,
      num: applied,
      requested: count,
      clamped: applied < count,
      name: tpl.name,
      kind: 'breakStone',
      rateBefore: before,
      rateAfter: after
    };
  });

  const view = await roleService.getProfile(accountId);
  return Object.assign({ used: result }, view);
}

/** 散灵丹：把指定的一条灵根归零 */
async function useRootReset(accountId, tpl, element) {
  const el = String(element || '').trim();
  if (!game.world.elements.includes(el)) throw err.param('请指定要散去的五行灵根');

  const result = await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');
    if (roleService.parseJsonColumn(role.root_pending)) {
      throw err.condition('请先处理待确认的洗练结果');
    }

    const roots = formula.parseRoots(role.roots);
    const current = Number(roots[el]) || 0;
    if (current <= 0) throw err.condition(`${el}灵根已为 0，无需散去`);

    const okConsume = await dao.consumeItem(conn, role.id, tpl.id, 1);
    if (!okConsume) throw err.notEnough('散灵丹数量不足');

    roots[el] = 0;
    const beforeTitle = formula.rootTitle(role.roots);
    const afterTitle = formula.rootTitle(roots);

    await dao.updateRoleFields(conn, role.id, { roots: JSON.stringify(roots) });
    await dao.insertActionLog(conn, role.id, 'reroll',
      `服下 ${tpl.name}，散去${el}灵根（${current} → 0），道体自「${beforeTitle}」变为「${afterTitle}」`);

    return { itemId: tpl.id, num: 1, name: tpl.name, kind: 'rootReset', element: el, oldValue: current, beforeTitle, afterTitle };
  });

  const view = await roleService.getProfile(accountId);
  return Object.assign({ used: result }, view);
}

/** 装备：同类型只能装一件（法宝 1 格 + 功法 1 格） */
async function equip(accountId, itemId) {
  const id = Number(itemId);
  const tpl = game.itemMap.get(id);
  if (!tpl) throw err.notFound('物品不存在');
  if (!EQUIP_TYPES.includes(tpl.type)) throw err.condition('该物品不可装备');

  await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');

    const rows = await dao.listItems(conn, role.id);
    const target = rows.find((r) => r.item_id === id && r.num > 0);
    if (!target) throw err.notEnough('尚未拥有该物品');

    // 先卸下同类型的其它装备
    const sameType = rows
      .filter((r) => r.equipped === 1 && r.item_id !== id)
      .filter((r) => {
        const t = game.itemMap.get(r.item_id);
        return t && t.type === tpl.type;
      })
      .map((r) => r.item_id);
    await dao.unequipByType(conn, role.id, sameType);
    await dao.setEquipped(conn, role.id, id, true);
    await dao.insertActionLog(conn, role.id, 'equip', `装备了 ${tpl.name}`);
  });

  return Object.assign({ equipped: { itemId: id, name: tpl.name } }, await roleService.getProfile(accountId));
}

/** 卸下某类型装备 */
async function unequip(accountId, type) {
  if (!EQUIP_TYPES.includes(type)) throw err.param('装备类型不合法');

  await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');
    const rows = await dao.listItems(conn, role.id);
    const ids = rows
      .filter((r) => r.equipped === 1)
      .filter((r) => {
        const t = game.itemMap.get(r.item_id);
        return t && t.type === type;
      })
      .map((r) => r.item_id);
    if (!ids.length) throw err.condition('该位置没有装备');
    await dao.unequipByType(conn, role.id, ids);
    const name = ids.map((i) => (game.itemMap.get(i) || {}).name).filter(Boolean).join('、');
    await dao.insertActionLog(conn, role.id, 'equip', `卸下了 ${name}`);
  });

  return roleService.getProfile(accountId);
}

/**
 * 出售：按市价 sellRate（默认 7 成）回收灵石。
 * 已装备的必须先卸下，避免"卖了还穿着"。
 */
async function sell(accountId, itemId, num = 1) {
  const id = Number(itemId);
  const count = Math.floor(Number(num) || 0);
  if (!id || count <= 0 || count > 999) throw err.param('出售数量不合法');

  const tpl = game.itemMap.get(id);
  if (!tpl) throw err.notFound('物品不存在');
  if (!tpl.price || tpl.price <= 0) throw err.condition('该物品无法出售');

  const result = await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');

    const rows = await dao.listItems(conn, role.id);
    const row = rows.find((r) => r.item_id === id);
    if (!row || row.num <= 0) throw err.notEnough('背包里没有这件物品');
    if (row.equipped === 1) throw err.condition('请先卸下装备再出售');
    if (row.num < count) throw err.notEnough(`数量不足，你只有 ${row.num} 件`);

    const { unit, total } = formula.sellPrice(tpl, count);
    const okConsume = await dao.consumeItem(conn, role.id, id, count);
    if (!okConsume) throw err.notEnough('数量不足');

    const stone = Number(role.spirit_stone) + total;
    // 出售不动修为，也不推进结算基准：挂机窗口留给下一次结算照常计算，不会丢失
    await dao.updateRoleFields(conn, role.id, { spirit_stone: stone });
    await dao.insertCurrencyLogs(conn, roleService.currencyLogs(role, {
      stone,
      exp: Number(role.exp),
      settle: null,
      entries: [{
        kind: 'stone',
        delta: total,
        reason: 'sell',
        remark: `${tpl.name}×${count}（${Math.round(game.world.sellRate * 100)}% 回收）`
      }]
    }));
    await dao.insertActionLog(conn, role.id, 'sell',
      `出售 ${tpl.name} ×${count}，回收灵石 ${total}（单价 ${unit}）`);

    return { itemId: id, name: tpl.name, num: count, unit, total, sellRate: game.world.sellRate };
  });

  const view = await roleService.getProfile(accountId);
  return Object.assign({ sold: result }, view);
}

module.exports = { list, use, equip, unequip, sell, EQUIP_TYPES };
