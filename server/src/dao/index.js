/**
 * DAO 层：所有 SQL 集中在这里。
 * 每个函数第一个参数都是 exec（事务连接 conn 或连接池 pool），
 * 这样同一段逻辑既能走事务、也能走连接池，不用写两份。
 */

const db = require('../config/db');

/* ---------------- 账号 ---------------- */

const findAccountByUsername = async (exec, username) => {
  const [rows] = await exec.query('SELECT * FROM `account` WHERE `username` = ?', [username]);
  return rows[0] || null;
};

const insertAccount = async (exec, username, passwordHash) => {
  const [r] = await exec.query(
    'INSERT INTO `account` (`username`, `password_hash`, `last_login_at`) VALUES (?, ?, NOW())',
    [username, passwordHash]
  );
  return r.insertId;
};

const touchLogin = (exec, accountId) =>
  exec.query('UPDATE `account` SET `last_login_at` = NOW() WHERE `id` = ?', [accountId]);

/* ---------------- 角色 ---------------- */

const findRoleByAccount = async (exec, accountId) => {
  const [rows] = await exec.query('SELECT * FROM `role` WHERE `account_id` = ?', [accountId]);
  return rows[0] || null;
};

const lockRoleByAccount = async (exec, accountId) => {
  const [rows] = await exec.query('SELECT * FROM `role` WHERE `account_id` = ? FOR UPDATE', [accountId]);
  return rows[0] || null;
};

const insertRole = async (exec, accountId, nickname, roots, rootPity) => {
  const [r] = await exec.query(
    'INSERT INTO `role` (`account_id`, `nickname`, `roots`, `root_pity`, `last_settle_at`) VALUES (?, ?, ?, ?, NOW())',
    [accountId, nickname, JSON.stringify(roots), JSON.stringify(rootPity)]
  );
  return r.insertId;
};

const updateRoleFields = (exec, roleId, fields) => {
  const keys = Object.keys(fields);
  if (!keys.length) return Promise.resolve(null);
  const sets = keys.map((k) => `\`${k}\` = ?`).join(', ');
  const values = keys.map((k) => fields[k]);
  return exec.query(`UPDATE \`role\` SET ${sets}, \`version\` = \`version\` + 1 WHERE \`id\` = ?`, [...values, roleId]);
};

/**
 * 节流结算落库。
 *
 * 守卫只用 last_settle_at 做 CAS：并发轮询时只有一个请求能真正加钱，
 * 后到的请求 affectedRows = 0，直接放弃本次发放（不会重复发）。
 * 刻意不把 version 放进条件 —— version 是"整行任意字段"的版本号，
 * 换装备、改洞府之类的无关写入都会让它变化，加进来只会白白丢掉合法结算。
 *
 * @param {string} lastSettleAt 计算收益时所用的时刻（不是 NOW()，见 core/settle.js）
 */
const applySettle = async (exec, role, stone, exp, lastSettleAt) => {
  const [r] = await exec.query(
    'UPDATE `role` SET `spirit_stone` = `spirit_stone` + ?, `exp` = `exp` + ?, `last_settle_at` = ?, ' +
    '`version` = `version` + 1 WHERE `id` = ? AND `last_settle_at` = ?',
    [stone, exp, lastSettleAt, role.id, role.last_settle_at]
  );
  return r.affectedRows > 0;
};

/* ---------------- 背包 / 装备 ---------------- */

const listItems = async (exec, roleId) => {
  const [rows] = await exec.query('SELECT * FROM `role_item` WHERE `role_id` = ? ORDER BY `item_id`', [roleId]);
  return rows;
};

const addItem = (exec, roleId, itemId, num) =>
  exec.query(
    'INSERT INTO `role_item` (`role_id`, `item_id`, `num`) VALUES (?, ?, ?) ' +
    'ON DUPLICATE KEY UPDATE `num` = `num` + VALUES(`num`)',
    [roleId, itemId, num]
  );

/** 原子扣除：num 不足时 affectedRows = 0 */
const consumeItem = async (exec, roleId, itemId, num) => {
  const [r] = await exec.query(
    'UPDATE `role_item` SET `num` = `num` - ? WHERE `role_id` = ? AND `item_id` = ? AND `num` >= ?',
    [num, roleId, itemId, num]
  );
  return r.affectedRows > 0;
};

const setEquipped = (exec, roleId, itemId, equipped) =>
  exec.query('UPDATE `role_item` SET `equipped` = ? WHERE `role_id` = ? AND `item_id` = ?', [equipped ? 1 : 0, roleId, itemId]);

const unequipByType = async (exec, roleId, itemIds) => {
  if (!itemIds.length) return;
  await exec.query(
    `UPDATE \`role_item\` SET \`equipped\` = 0 WHERE \`role_id\` = ? AND \`item_id\` IN (${itemIds.map(() => '?').join(',')})`,
    [roleId, ...itemIds]
  );
};

/* ---------------- 试炼塔进度 ---------------- */

const listStages = async (exec, roleId) => {
  const [rows] = await exec.query('SELECT * FROM `role_stage` WHERE `role_id` = ?', [roleId]);
  return rows;
};

const bumpStage = (exec, roleId, stageId) =>
  exec.query(
    'INSERT INTO `role_stage` (`role_id`, `stage_id`, `clear_count`) VALUES (?, ?, 1) ' +
    'ON DUPLICATE KEY UPDATE `clear_count` = `clear_count` + 1',
    [roleId, stageId]
  );

/* ---------------- 日志 ---------------- */

const insertCurrencyLogs = async (exec, rows) => {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?, ?, ?, ?, ?, ?)').join(', ');
  const values = [];
  rows.forEach((r) => values.push(r.roleId, r.kind, r.delta, r.balanceAfter, r.reason, r.remark || null));
  await exec.query(
    'INSERT INTO `log_currency` (`role_id`, `kind`, `delta`, `balance_after`, `reason`, `remark`) VALUES ' + placeholders,
    values
  );
};

/** 分页读流水。排序与 idx_role_time(role_id, created_at) 对齐，避免深翻页 filesort */
const listCurrencyLogs = async (exec, roleId, { offset = 0, limit = 20 } = {}) => {
  const [rows] = await exec.query(
    'SELECT `kind`, `delta`, `balance_after`, `reason`, `remark`, `created_at` FROM `log_currency` ' +
    'WHERE `role_id` = ? ORDER BY `created_at` DESC, `id` DESC LIMIT ? OFFSET ?',
    [roleId, limit, offset]
  );
  return rows;
};

const countCurrencyLogs = async (exec, roleId) => {
  const [rows] = await exec.query('SELECT COUNT(*) AS n FROM `log_currency` WHERE `role_id` = ?', [roleId]);
  return Number(rows[0].n);
};

const insertBattleLog = (exec, { roleId, stageId, seed, win, rounds, detail }) =>
  exec.query(
    'INSERT INTO `log_battle` (`role_id`, `stage_id`, `seed`, `win`, `rounds`, `detail`) VALUES (?, ?, ?, ?, ?, ?)',
    [roleId, stageId, seed, win ? 1 : 0, rounds, JSON.stringify(detail)]
  );

/** 分页读战斗留档 */
const listBattleLogs = async (exec, roleId, { offset = 0, limit = 20 } = {}) => {
  const [rows] = await exec.query(
    'SELECT `stage_id`, `seed`, `win`, `rounds`, `created_at` FROM `log_battle` ' +
    'WHERE `role_id` = ? ORDER BY `created_at` DESC, `id` DESC LIMIT ? OFFSET ?',
    [roleId, limit, offset]
  );
  return rows;
};

const countBattleLogs = async (exec, roleId) => {
  const [rows] = await exec.query('SELECT COUNT(*) AS n FROM `log_battle` WHERE `role_id` = ?', [roleId]);
  return Number(rows[0].n);
};

/* ---------------- 行动记录（给玩家看的） ---------------- */

const insertActionLog = (exec, roleId, type, text) =>
  exec.query(
    'INSERT INTO `log_action` (`role_id`, `type`, `text`) VALUES (?, ?, ?)',
    [roleId, type, String(text).slice(0, 160)]
  );

/** 同一事务内可以一次写多条，减少往返 */
const insertActionLogs = async (exec, rows) => {
  if (!rows.length) return;
  const placeholders = rows.map(() => '(?, ?, ?)').join(', ');
  const values = [];
  rows.forEach((r) => values.push(r.roleId, r.type, String(r.text).slice(0, 160)));
  await exec.query('INSERT INTO `log_action` (`role_id`, `type`, `text`) VALUES ' + placeholders, values);
};

const listActionLogs = async (exec, roleId, limit = 15) => {
  const [rows] = await exec.query(
    'SELECT `type`, `text`, `created_at` FROM `log_action` WHERE `role_id` = ? ' +
    'ORDER BY `created_at` DESC, `id` DESC LIMIT ?',
    [roleId, Number(limit)]
  );
  return rows;
};

/* ---------------- 排行榜 ---------------- */

/**
 * 修为榜：境界 → 层数 → 修为，id 升序作为稳定并列规则。
 * 走 role.idx_rank 索引，反向扫描即可。
 */
const listRank = async (exec, limit = 50) => {
  const [rows] = await exec.query(
    'SELECT r.`id`, r.`nickname`, r.`realm`, r.`realm_level`, r.`exp`, r.`total_break`, r.`cave_level` ' +
    'FROM `role` r JOIN `account` a ON a.`id` = r.`account_id` ' +
    'WHERE a.`status` = 1 ' +
    'ORDER BY r.`realm` DESC, r.`realm_level` DESC, r.`exp` DESC, r.`id` ASC LIMIT ?',
    [limit]
  );
  return rows;
};

/** 我排第几：严格排在我前面的人数 + 1（并列规则与 listRank 完全一致） */
const countRankAbove = async (exec, role) => {
  const [rows] = await exec.query(
    'SELECT COUNT(*) AS n FROM `role` r JOIN `account` a ON a.`id` = r.`account_id` ' +
    'WHERE a.`status` = 1 AND (' +
    '  r.`realm` > ? OR ' +
    '  (r.`realm` = ? AND r.`realm_level` > ?) OR ' +
    '  (r.`realm` = ? AND r.`realm_level` = ? AND (r.`exp` > ? OR (r.`exp` = ? AND r.`id` < ?)))' +
    ')',
    [role.realm, role.realm, role.realm_level, role.realm, role.realm_level, role.exp, role.exp, role.id]
  );
  return Number(rows[0].n) + 1;
};

const countRankedRoles = async (exec) => {
  const [rows] = await exec.query(
    'SELECT COUNT(*) AS n FROM `role` r JOIN `account` a ON a.`id` = r.`account_id` WHERE a.`status` = 1');
  return Number(rows[0].n);
};

module.exports = {
  pool: db.pool,
  findAccountByUsername,
  insertAccount,
  touchLogin,
  findRoleByAccount,
  lockRoleByAccount,
  insertRole,
  updateRoleFields,
  applySettle,
  listItems,
  addItem,
  consumeItem,
  setEquipped,
  unequipByType,
  listStages,
  bumpStage,
  insertCurrencyLogs,
  listCurrencyLogs,
  countCurrencyLogs,
  insertBattleLog,
  listBattleLogs,
  countBattleLogs,
  insertActionLog,
  insertActionLogs,
  listActionLogs,
  listRank,
  countRankAbove,
  countRankedRoles
};
