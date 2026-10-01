/**
 * 角色领域服务：档案、惰性结算落库、突破、洞府、单条灵根洗练
 *
 * 货币只有一种 —— 灵石（spirit_stone）。挂机产出灵石 + 修为。
 */
const config = require('../config');
const db = require('../config/db');
const dao = require('../dao');
const game = require('../game');
const formula = require('../core/formula');
const { computeSettle, projectRole } = require('../core/settle');
const { createRng, randomSeed, randInt } = require('../core/random');
const { err } = require('../utils/http');
const { formatDateTime, humanDuration } = require('../utils/time');

/** 取出已装备物品的配置模板 */
async function equippedTemplates(exec, roleId) {
  const rows = await dao.listItems(exec, roleId);
  return rows
    .filter((r) => r.equipped === 1)
    .map((r) => game.itemMap.get(r.item_id))
    .filter(Boolean);
}

/** JSON 列容错解析 */
function parseJsonColumn(value) {
  if (!value) return null;
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value);
  } catch (e) {
    console.error('[JSON 列解析失败]', value);
    return null;
  }
}

function toRoleDTO(role, derived) {
  const roots = formula.parseRoots(role.roots);
  const rootCosts = {};
  game.world.elements.forEach((el) => {
    rootCosts[el] = formula.rerollCost(roots[el] || 0);
  });
  return {
    id: role.id,
    nickname: role.nickname,
    realm: role.realm,
    realmLevel: role.realm_level,
    realmName: derived.realm.name,
    realmColor: derived.realm.color,
    realmDesc: derived.realm.desc,
    exp: Number(role.exp),
    expNeed: derived.expNeed,
    spiritStone: Number(role.spirit_stone),
    roots,
    rootTitle: derived.rootTitle,
    rootCount: derived.rootCount,
    rootPity: formula.parseRootPity(role.root_pity),
    rootPending: parseJsonColumn(role.root_pending),
    rootCosts,
    breakBonus: derived.breakBonus,
    caveLevel: role.cave_level,
    breakPity: role.break_pity,
    totalBreak: role.total_break,
    isMaxRealm: derived.isMaxRealm,
    createdAt: role.created_at
  };
}

/** 面板视图：角色 + 派生属性 + 装备 + 本次结算信息 + 行动记录 */
function buildView(role, equipped, settle, actions = []) {
  const derived = formula.derive(role, equipped);
  const byType = new Map();
  equipped.forEach((t) => byType.set(t.type, t));
  return {
    role: toRoleDTO(role, derived),
    derived: {
      totalLevel: derived.totalLevel,
      element: derived.element,
      elementColor: derived.elementColor,
      mainRoot: derived.mainRoot,
      rootTitle: derived.rootTitle,
      rootCount: derived.rootCount,
      activeRoots: derived.activeRoots,
      chaos: derived.chaos,
      stonePerSec: derived.stonePerSec,
      stoneBreakdown: derived.stoneBreakdown,
      atk: derived.atk,
      def: derived.def,
      hp: derived.hp,
      speed: derived.speed,
      bonus: derived.bonus,
      cave: derived.cave,
      expNeed: derived.expNeed,
      breakRate: formula.breakRate(role),
      breakBonus: derived.breakBonus,
      breakDetail: derived.breakDetail
    },
    equip: {
      artifact: byType.get('artifact') || null,
      skill: byType.get('skill') || null
    },
    settle,
    actions
  };
}

/**
 * 统一的流水构造器 —— 全项目只有这一处决定"结算记几条"。
 *
 * 契约：
 *   1) 每条流水的 delta 只反映它自己的 reason；
 *   2) 挂机结算永远单独记 reason='settle'（stone / exp 各一条）；
 *   3) 同一事务内的多条流水共享事务结束时的余额。
 */
function currencyLogs(role, { stone, exp, settle, entries = [] }) {
  const logs = entries.map((e) => Object.assign({}, e, {
    roleId: role.id,
    balanceAfter: e.kind === 'stone' ? stone : e.kind === 'exp' ? exp : e.balanceAfter
  }));

  if (settle && settle.stone > 0) {
    logs.push({ roleId: role.id, kind: 'stone', delta: settle.stone, balanceAfter: stone, reason: 'settle', remark: `${settle.seconds}s` });
  }
  if (settle && settle.exp > 0) {
    logs.push({ roleId: role.id, kind: 'exp', delta: settle.exp, balanceAfter: exp, reason: 'settle', remark: `${settle.seconds}s` });
  }
  return logs;
}

function settleView(settle, persisted) {
  if (!settle) return null;
  return {
    seconds: settle.seconds,
    sinceLabel: humanDuration(settle.seconds),
    rate: settle.rate,
    expRate: config.settle.expRate,
    gainedStone: settle.stone,
    gainedExp: settle.exp,
    capped: settle.capped,
    offline: settle.offline,
    maxHours: config.settle.maxHours,
    persisted: !!persisted
  };
}

/**
 * 读档 + 惰性结算（节流落库）+ 最近行动
 * 这是前端每 5~10 秒轮询的主接口，必须轻
 */
async function getProfile(accountId, { actionLimit = 15 } = {}) {
  const role = await dao.findRoleByAccount(db.pool, accountId);
  if (!role) throw err.notFound('角色不存在，请重新登录');

  const equipped = await equippedTemplates(db.pool, role.id);
  const settle = computeSettle(role, equipped);
  let view = projectRole(role, settle);
  let persisted = false;

  // 只有累计超过阈值才真正写库，避免每 5 秒一次 UPDATE
  if (settle.seconds >= config.settle.minPersistSeconds && (settle.stone > 0 || settle.exp > 0)) {
    persisted = await dao.applySettle(db.pool, role, settle.stone, settle.exp, formatDateTime(settle.now));
    if (persisted) {
      const before = { stone: Number(role.spirit_stone), exp: Number(role.exp) };
      view = Object.assign({}, view, { last_settle_at: formatDateTime(settle.now), version: role.version + 1 });
      if (settle.seconds >= config.settle.minLogSeconds) {
        await dao.insertCurrencyLogs(db.pool, [
          { roleId: role.id, kind: 'stone', delta: settle.stone, balanceAfter: before.stone + settle.stone, reason: 'settle', remark: `${settle.seconds}s` },
          { roleId: role.id, kind: 'exp', delta: settle.exp, balanceAfter: before.exp + settle.exp, reason: 'settle', remark: `${settle.seconds}s` }
        ]);
        await dao.insertActionLog(db.pool, role.id, 'settle',
          `闭关 ${humanDuration(settle.seconds)}，洞府产出灵石 ${settle.stone}、修为 ${settle.exp}`);
      }
    }
  }

  const actions = await dao.listActionLogs(db.pool, role.id, actionLimit);
  return buildView(view, equipped, settleView(settle, persisted), actions);
}

/** 突破：整段走事务 + 行锁，随机数用 seed 记录，可复算 */
async function breakthrough(accountId) {
  const seed = randomSeed();

  const result = await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');

    const equipped = await equippedTemplates(conn, role.id);
    const settle = computeSettle(role, equipped);
    const stone = Number(role.spirit_stone) + settle.stone;
    const current = Object.assign({}, role, { spirit_stone: stone, exp: Number(role.exp) + settle.exp });

    if (current.realm >= game.maxRealm && current.realm_level >= game.levelsPerRealm) {
      throw err.condition('已至大乘九层，此界再无可破之境');
    }

    const need = formula.expNeed(current);
    if (current.exp < need) {
      throw err.condition(`修为不足，尚需 ${need - current.exp} 点修为方可冲击`);
    }

    const bt = game.world.breakthrough;
    const rate = formula.breakRate(current);
    const rng = createRng(seed);
    const roll = rng();
    const success = roll < rate;

    let exp = current.exp;
    let cost = 0;
    const updates = { spirit_stone: stone, last_settle_at: formatDateTime(settle.now) };
    let message;
    let realmUp = false;
    const hadBonus = Number(current.break_bonus) || 0;

    if (success) {
      exp -= need;
      cost = need;
      let realm = current.realm;
      let level = current.realm_level + 1;
      if (level > game.levelsPerRealm) {
        realm += 1;
        level = 1;
        realmUp = true;
      }
      updates.realm = realm;
      updates.realm_level = level;
      updates.break_pity = 0;
      updates.total_break = current.total_break + 1;
      // 悟道石只保一次突破：成功一次加成即散，下次要重新买
      updates.break_bonus = 0;
      const realmName = game.realms[realm].name;
      message = level === 1
        ? `天雷滚滚，灵台清明 —— 你成功破境，晋入【${realmName}】！`
        : `气机贯通，周天圆满 —— 你突破至【${realmName}】${level}层。`;
    } else {
      cost = Math.floor(need * bt.failExpCostRate);
      exp -= cost;
      // 上限 100：break_pity 是 TINYINT（最大 127），写 128 以上会被 MySQL 拒绝
      updates.break_pity = Math.min(100, current.break_pity + 1);
      message = `冲击失败，气机反噬，损失修为 ${cost} 点。下次成功率 +${Math.round(bt.pityBonus * 100)}%`;
    }

    updates.exp = exp;
    await dao.updateRoleFields(conn, role.id, updates);

    // 记账契约：每条流水的 delta 只反映它自己的 reason，结算永远单独记一条。
    await dao.insertCurrencyLogs(conn, currencyLogs(role, {
      stone,
      exp,
      settle,
      entries: [{ kind: 'exp', delta: -cost, reason: 'breakthrough', remark: success ? '突破成功' : '突破失败' }]
    }));
    await dao.insertActionLog(conn, role.id, 'breakthrough',
      success
        ? `突破成功：${game.realms[updates.realm].name}${updates.realm_level}层（耗修为 ${cost}）${hadBonus ? '，悟道石加成已散去，下次需重新参悟' : ''}`
        : `冲击失败，气机反噬，损失修为 ${cost}`);

    return { success, rate, roll: Number(roll.toFixed(4)), seed, cost: need, message, realmUp, bonusCleared: hadBonus > 0 };
  });

  const view = await getProfile(accountId);
  return Object.assign({ breakthrough: result }, view);
}

/** 洞府升级：消耗灵石，提升挂机灵石产出 */
async function upgradeCave(accountId) {
  await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    const equipped = await equippedTemplates(conn, role.id);
    const settle = computeSettle(role, equipped);
    const stone = Number(role.spirit_stone);

    const next = formula.nextCave(role.cave_level);
    if (!next) throw err.condition('洞府已至满级');
    if (stone < next.costStone) throw err.notEnough(`灵石不足，尚需 ${next.costStone - stone} 枚`);

    const stoneAfter = Number(role.spirit_stone) + settle.stone;
    const exp = Number(role.exp) + settle.exp;
    const updates = {
      cave_level: next.level,
      spirit_stone: stoneAfter - next.costStone,
      exp,
      last_settle_at: formatDateTime(settle.now)
    };
    await dao.updateRoleFields(conn, role.id, updates);
    // 洞府升级也会顺带结算挂机收益，这笔同样要留痕，否则流水对不上余额
    await dao.insertCurrencyLogs(conn, currencyLogs(role, {
      stone: stoneAfter - next.costStone,
      exp,
      settle,
      entries: [{ kind: 'stone', delta: -next.costStone, reason: 'cave', remark: `洞府${next.level}级` }]
    }));
    await dao.insertActionLog(conn, role.id, 'cave',
      `洞府扩建至 ${next.level} 级（耗灵石 ${next.costStone}，产出加成 +${Math.round(next.stoneBonus * 100)}%）`);
  });
  return getProfile(accountId);
}

/**
 * 单条灵根洗练。
 *
 * 规则：
 *   - 每次只洗一条灵根，随机一个新数值（区间 rootRoll）；
 *   - 同一条灵根每洗 5 次保底一次，保底那次必定高于当前值；
 *   - 结果不直接生效，先存进 root_pending，由玩家决定保存还是放弃。
 */
async function rerollRoot(accountId, element) {
  const el = String(element || '').trim();
  if (!game.world.elements.includes(el)) throw err.param('请指定要洗练的五行灵根');

  const every = game.world.rootPityEvery;
  const { min, max } = game.world.rootRoll;
  const seed = randomSeed();

  const result = await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');

    if (parseJsonColumn(role.root_pending)) {
      throw err.condition('上一条洗练结果还没决定，请先选择保存或放弃');
    }

    const roots = formula.parseRoots(role.roots);
    const current = Number(roots[el]) || 0;
    if (current >= max) throw err.condition(`${el}灵根已至圆满（${max}），无需再洗`);

    // 花费随该灵根当前值递增：灵根越高越贵
    const cost = formula.rerollCost(current);
    const stone = Number(role.spirit_stone);
    if (stone < cost) throw err.notEnough(`灵石不足，洗练${el}灵根需 ${cost} 枚`);

    const pity = formula.parseRootPity(role.root_pity);
    const nextCount = pity[el] + 1;
    const guaranteed = nextCount % every === 0;

    const rng = createRng(seed);
    // 保底那次改用 [当前值+1, 上限] 区间，必定高于原值
    const value = guaranteed ? randInt(rng, current + 1, max) : randInt(rng, min, max);

    pity[el] = nextCount;
    const pending = { element: el, value, oldValue: current, guaranteed, cost, at: formatDateTime() };

    await dao.updateRoleFields(conn, role.id, {
      spirit_stone: stone - cost,
      root_pity: JSON.stringify(pity),
      root_pending: JSON.stringify(pending)
    });
    await dao.insertCurrencyLogs(conn, currencyLogs(role, {
      stone: stone - cost,
      exp: Number(role.exp),
      settle: null,
      entries: [{ kind: 'stone', delta: -cost, balanceAfter: stone - cost, reason: 'reroll', remark: `洗练${el}灵根` }]
    }));
    await dao.insertActionLog(conn, role.id, 'reroll',
      `洗练${el}灵根（${current} → ${value}${guaranteed ? '，保底触发' : ''}），耗灵石 ${cost}，待你定夺`);

    return {
      element: el,
      oldValue: current,
      value,
      guaranteed,
      cost,
      pity: pity[el],
      pityEvery: every,
      untilPity: (every - (nextCount % every)) % every || every,
      seed
    };
  });

  const view = await getProfile(accountId);
  return Object.assign({ reroll: result }, view);
}

/** 确认洗练结果：保存新值，或放弃保留原值 */
async function confirmRoot(accountId, save) {
  const keep = !!save;

  const result = await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');

    const pending = parseJsonColumn(role.root_pending);
    if (!pending) throw err.condition('没有待确认的洗练结果');

    const fields = { root_pending: null };
    if (keep) {
      const roots = formula.parseRoots(role.roots);
      roots[pending.element] = pending.value;
      fields.roots = JSON.stringify(roots);
      // 保底计数在"保存"之后重新计算：接受了新数值，就从 0 开始重新攒
      const pity = formula.parseRootPity(role.root_pity);
      pity[pending.element] = 0;
      fields.root_pity = JSON.stringify(pity);
    }
    await dao.updateRoleFields(conn, role.id, fields);
    await dao.insertActionLog(conn, role.id, 'reroll',
      keep
        ? `保留洗练结果：${pending.element}灵根 ${pending.oldValue} → ${pending.value}（该灵根的保底计数已重新计算）`
        : `放弃洗练结果，${pending.element}灵根维持 ${pending.oldValue}（保底计数保留，继续累积）`);
    // 确认动作只改灵根、不涉及货币，所以不写流水（写了只会是 delta=0 的噪声行）。
    // 灵石在洗练那一刻就已经扣掉并记过账了。

    return { saved: keep, element: pending.element, oldValue: pending.oldValue, value: pending.value };
  });

  const view = await getProfile(accountId);
  return Object.assign({ confirm: result }, view);
}

/** 资源流水与战斗留档：两者都走服务端分页 */
async function logs(accountId, { page = 1, pageSize = 20, battlePage = 1, battlePageSize = 20 } = {}) {
  const role = await dao.findRoleByAccount(db.pool, accountId);
  if (!role) throw err.notFound('角色不存在');

  const total = await dao.countCurrencyLogs(db.pool, role.id);
  const list = await dao.listCurrencyLogs(db.pool, role.id, {
    offset: (page - 1) * pageSize,
    limit: pageSize
  });

  const battleTotal = await dao.countBattleLogs(db.pool, role.id);
  const battles = await dao.listBattleLogs(db.pool, role.id, {
    offset: (battlePage - 1) * battlePageSize,
    limit: battlePageSize
  });

  return {
    currency: {
      list,
      total,
      page,
      pageSize,
      pages: Math.max(1, Math.ceil(total / pageSize))
    },
    battles: {
      list: battles,
      total: battleTotal,
      page: battlePage,
      pageSize: battlePageSize,
      pages: Math.max(1, Math.ceil(battleTotal / battlePageSize))
    }
  };
}

/** 行动记录（右侧行动区） */
async function actions(accountId, limit = 20) {
  const role = await dao.findRoleByAccount(db.pool, accountId);
  if (!role) throw err.notFound('角色不存在');
  return { list: await dao.listActionLogs(db.pool, role.id, limit) };
}

module.exports = {
  equippedTemplates,
  parseJsonColumn,
  buildView,
  toRoleDTO,
  currencyLogs,
  getProfile,
  breakthrough,
  upgradeCave,
  rerollRoot,
  confirmRoot,
  logs,
  actions
};
