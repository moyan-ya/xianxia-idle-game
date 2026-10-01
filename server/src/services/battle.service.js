/**
 * 试炼塔：逐层解锁，服务端权威战斗 + 种子落库
 */
const db = require('../config/db');
const dao = require('../dao');
const game = require('../game');
const formula = require('../core/formula');
const battleCore = require('../core/battle');
const { computeSettle } = require('../core/settle');
const { randomSeed } = require('../core/random');
const roleService = require('./role.service');
const { err } = require('../utils/http');
const { formatDateTime } = require('../utils/time');

function stagePlayer(role, derived) {
  return {
    name: role.nickname,
    element: derived.element,
    rootTitle: derived.rootTitle,
    roots: formula.parseRoots(role.roots),
    atk: derived.atk,
    def: derived.def,
    hp: derived.hp,
    speed: derived.speed
  };
}

function stageMonster(stage) {
  return {
    name: stage.monster.name,
    element: stage.element,
    atk: stage.monster.atk,
    def: stage.monster.def,
    hp: stage.monster.hp,
    speed: stage.monster.speed
  };
}

/** 塔层列表：解锁状态 + 首通情况 */
async function list(accountId) {
  const role = await dao.findRoleByAccount(db.pool, accountId);
  if (!role) throw err.notFound('角色不存在');

  const progress = await dao.listStages(db.pool, role.id);
  const cleared = new Map(progress.map((p) => [p.stage_id, p.clear_count]));

  const stages = game.stages.map((s, idx) => {
    const prev = idx === 0 ? 1 : (cleared.get(game.stages[idx - 1].id) || 0);
    const count = cleared.get(s.id) || 0;
    return {
      stageId: s.id,
      name: s.name,
      element: s.element,
      elementColor: game.world.elementColors[s.element] || '#d8c27a',
      monsterName: s.monster.name,
      monster: s.monster,
      reward: s.reward,
      failExp: s.failExp || 0,
      locked: idx > 0 && prev <= 0,
      clearCount: count,
      firstCleared: count > 0,
      repeatRewardRate: game.repeatRewardRate
    };
  });

  return { stages, unlocked: stages.filter((s) => !s.locked).length };
}

/** 挑战：锁行 → 结算 → 纯函数战斗 → 发奖 → 落库 */
async function challenge(accountId, stageId) {
  const sid = Number(stageId);
  // 先分辨"参数不对"和"这层不存在"，别让客户端把参数错误当成资源不存在
  if (!Number.isInteger(sid) || sid <= 0) throw err.param('塔层参数不合法');
  const stage = game.stageMap.get(sid);
  if (!stage) throw err.notFound('该层不存在');

  const result = await db.transaction(async (conn) => {
    const role = await dao.lockRoleByAccount(conn, accountId);
    if (!role) throw err.notFound('角色不存在');

    const equipped = await roleService.equippedTemplates(conn, role.id);
    const settle = computeSettle(role, equipped);
    const derived = formula.derive(role, equipped);

    // 一次查询同时用于「解锁校验」和「首通判定」，避免重复查库
    const progress = await dao.listStages(conn, role.id);

    // 解锁校验：上一层必须已通关
    const idx = game.stages.findIndex((s) => s.id === sid);
    // idx < 0 说明 stage.json 的 id 不连续 —— 必须显式拦住，
    // 否则 `if (idx > 0)` 会把 -1 当成"第一层"，直接绕过解锁校验。
    if (idx < 0) throw err.notFound('该层不存在');
    if (idx > 0) {
      const prevCleared = progress.find((p) => p.stage_id === game.stages[idx - 1].id);
      if (!prevCleared || prevCleared.clear_count <= 0) {
        throw err.condition(`需先通关「${game.stages[idx - 1].name}」`);
      }
    }

    const seed = randomSeed();
    const report = battleCore.simulate(stagePlayer(role, derived), stageMonster(stage), seed);

    const firstClear = !progress.some((p) => p.stage_id === sid && p.clear_count > 0);
    const rate = firstClear ? 1 : game.repeatRewardRate;
    const reward = report.win
      ? { exp: Math.floor(stage.reward.exp * rate), stone: Math.floor(stage.reward.stone * rate) }
      : { exp: 0, stone: 0 };

    // 挑战失败要掉修为：每层掉的量不同（见 stage.json 的 failExp），但不会把修为扣成负数
    const expBefore = Number(role.exp) + settle.exp;
    const failLoss = report.win ? 0 : Math.min(Math.floor(stage.failExp || 0), expBefore);

    const stone = Number(role.spirit_stone) + settle.stone + reward.stone;
    const exp = expBefore + reward.exp - failLoss;

    await dao.updateRoleFields(conn, role.id, {
      spirit_stone: stone,
      exp,
      last_settle_at: formatDateTime(settle.now)
    });

    if (report.win) await dao.bumpStage(conn, role.id, sid);
    await dao.insertBattleLog(conn, {
      roleId: role.id,
      stageId: sid,
      seed,
      win: report.win,
      rounds: report.roundCount,
      // 只存"复算所需的输入 + 摘要"，不存整份逐回合战报：
      // 有了 seed 与双方属性就能完整重跑一遍，存储量却小一个量级
      detail: {
        seed,
        player: report.player,
        monster: report.monster,
        rootFormula: report.rootFormula,
        roundCount: report.roundCount,
        win: report.win,
        playerHp: report.playerHp,
        monsterHp: report.monsterHp
      }
    });

    const entries = [];
    if (reward.exp) entries.push({ kind: 'exp', delta: reward.exp, reason: 'battle', remark: `塔${sid}层` });
    if (reward.stone) entries.push({ kind: 'stone', delta: reward.stone, reason: 'battle', remark: `塔${sid}层` });
    if (failLoss) entries.push({ kind: 'exp', delta: -failLoss, reason: 'battle', remark: `塔${sid}层失败` });
    await dao.insertCurrencyLogs(conn, roleService.currencyLogs(role, { stone, exp, settle, entries }));
    await dao.insertActionLog(conn, role.id, 'battle', report.win
      ? `闯过「${stage.name}」${firstClear ? '（首通）' : ''}，${report.roundCount} 回合，得灵石 ${reward.stone}、修为 ${reward.exp}`
      : `挑战「${stage.name}」失利，${report.roundCount} 回合后被击退，损失修为 ${failLoss}`);

    return {
      stage: { id: stage.id, name: stage.name, element: stage.element, monsterName: stage.monster.name },
      firstClear,
      rewardRate: rate,
      reward,
      failLoss,
      report
    };
  });

  const view = await roleService.getProfile(accountId);
  return Object.assign({ challenge: result }, view);
}

/**
 * 战斗推演：不开打，只把伤害公式的推导过程算给玩家看。
 * 纯计算、无随机、不改任何数据，随便刷。
 */
async function preview(accountId, stageId) {
  const sid = Number(stageId);
  let stage = game.stageMap.get(sid);
  if (!Number.isInteger(sid) || sid <= 0 || !stage) stage = game.stages[0];

  const role = await dao.findRoleByAccount(db.pool, accountId);
  if (!role) throw err.notFound('角色不存在');

  const equipped = await roleService.equippedTemplates(db.pool, role.id);
  const derived = formula.derive(role, equipped);

  const data = battleCore.preview(stagePlayer(role, derived), stageMonster(stage));
  return Object.assign({ stage: { id: stage.id, name: stage.name, element: stage.element } }, data);
}

/** 一次把全部塔层的推演都算出来，供前端下拉快速切换 */
async function previewAll(accountId) {
  const role = await dao.findRoleByAccount(db.pool, accountId);
  if (!role) throw err.notFound('角色不存在');

  const equipped = await roleService.equippedTemplates(db.pool, role.id);
  const derived = formula.derive(role, equipped);
  const player = stagePlayer(role, derived);

  return {
    self: player,
    list: game.stages.map((stage) => {
      const p = battleCore.preview(player, stageMonster(stage));
      return {
        stageId: stage.id,
        name: stage.name,
        element: stage.element,
        monsterName: stage.monster.name,
        target: p.target,
        attack: p.attack,
        defend: p.defend,
        damage: p.damage,
        constants: p.constants
      };
    })
  };
}

module.exports = { list, challenge, preview, previewAll };
