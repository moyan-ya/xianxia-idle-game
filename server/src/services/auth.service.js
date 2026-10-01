/**
 * 账号服务：注册、登录
 */
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const db = require('../config/db');
const dao = require('../dao');
const game = require('../game');
const { createRng, randomSeed, rollRoots } = require('../core/random');
const { err } = require('../utils/http');

function signToken(accountId, roleId) {
  return jwt.sign({ aid: accountId, rid: roleId }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });
}

function validateCredentials(username, password) {
  if (!/^[a-zA-Z0-9_]{3,20}$/.test(String(username || ''))) {
    throw err.param('账号需为 3-20 位字母、数字或下划线');
  }
  if (String(password || '').length < 6 || String(password).length > 32) {
    throw err.param('密码需为 6-32 位');
  }
}

/** 新角色初始家当 */
async function createRole(exec, accountId, nickname) {
  const roots = rollRoots(createRng(randomSeed()), game.world.elements, game.world.rootRoll.min, game.world.rootRoll.max);
  const rootPity = {};
  game.world.elements.forEach((el) => { rootPity[el] = 0; });

  const roleId = await dao.insertRole(exec, accountId, nickname, roots, rootPity);

  // 开局赠礼：3 枚聚气丹 + 一柄已装备的青锋剑 + 启动灵石。
  // 剑必须给且自动装备：否则灵根抽到被克制的五行时，新手会在试炼塔第一层卡死。
  await dao.addItem(exec, roleId, 1, 3);
  await dao.addItem(exec, roleId, 21, 1);
  await dao.setEquipped(exec, roleId, 21, true);
  await dao.updateRoleFields(exec, roleId, { spirit_stone: 500 });
  await dao.insertCurrencyLogs(exec, [
    { roleId, kind: 'stone', delta: 500, balanceAfter: 500, reason: 'init', remark: '开局赠礼' }
  ]);
  await dao.insertActionLog(exec, roleId, 'init',
    `踏入修途，测出灵根 ${Object.entries(roots).map(([k, v]) => `${k}${v}`).join(' ')}，获赠青锋剑与灵石 500`);
  return roleId;
}

async function register({ username, password, nickname }) {
  validateCredentials(username, password);
  const nick = String(nickname || '').trim() || `道友${String(username).slice(-4)}`;
  if (nick.length < 2 || nick.length > 12) throw err.param('道号需为 2-12 个字符');

  // 先查一次给出友好提示；唯一索引仍是最终防线（并发下可能撞上，由 ER_DUP_ENTRY 兜底）
  const taken = await db.queryOne('SELECT `id` FROM `role` WHERE `nickname` = ?', [nick]);
  if (taken) throw err.conflict('这个道号已被人占了，换一个吧');

  const passwordHash = await bcrypt.hash(String(password), 10);

  const roleId = await db.transaction(async (conn) => {
    const exists = await dao.findAccountByUsername(conn, username);
    if (exists) throw err.conflict('该账号已被注册');
    const accountId = await dao.insertAccount(conn, username, passwordHash);
    return createRole(conn, accountId, nick);
  });

  const account = await dao.findAccountByUsername(db.pool, username);
  return { token: signToken(account.id, roleId), accountId: account.id, roleId };
}

async function login({ username, password }) {
  if (!username || !password) throw err.param('请输入账号与密码');

  const account = await dao.findAccountByUsername(db.pool, username);
  if (!account) throw err.param('账号或密码不正确');

  const matched = await bcrypt.compare(String(password), account.password_hash);
  if (!matched) throw err.param('账号或密码不正确');
  if (account.status !== 1) throw err.condition('此账号已被封禁');

  let role = await dao.findRoleByAccount(db.pool, account.id);
  if (!role) {
    await db.transaction((conn) => createRole(conn, account.id, `道友${String(username).slice(-4)}`));
    role = await dao.findRoleByAccount(db.pool, account.id);
  }

  await dao.touchLogin(db.pool, account.id);
  return { token: signToken(account.id, role.id), accountId: account.id, roleId: role.id };
}

module.exports = { register, login, signToken, createRole };
