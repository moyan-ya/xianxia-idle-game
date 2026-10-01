/**
 * MySQL 8 连接池（mysql2/promise）
 * 统一出口：query / queryOne / transaction
 */
const mysql = require('mysql2/promise');
const config = require('./index');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: config.db.connectionLimit,
  queueLimit: 0,
  charset: 'utf8mb4_0900_ai_ci',
  // 大整数按字符串返回会破坏 JSON，这里保持 Number（MVP 数量级安全）
  supportBigNumbers: true,
  bigNumberStrings: false,
  dateStrings: ['DATETIME'],
  timezone: 'local'
});

async function query(sql, params = []) {
  const [rows] = await pool.query(sql, params);
  return rows;
}

async function queryOne(sql, params = []) {
  const rows = await query(sql, params);
  return rows.length ? rows[0] : null;
}

/**
 * 事务包装：回调内抛错自动回滚
 * @param {(conn: import('mysql2/promise').PoolConnection) => Promise<any>} fn
 */
async function transaction(fn) {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const result = await fn(conn);
    await conn.commit();
    return result;
  } catch (err) {
    try { await conn.rollback(); } catch (_) { /* ignore */ }
    throw err;
  } finally {
    conn.release();
  }
}

/** 在事务连接上取角色行并加排他锁 */
async function lockRole(conn, roleId) {
  const [rows] = await conn.query('SELECT * FROM `role` WHERE `id` = ? FOR UPDATE', [roleId]);
  return rows.length ? rows[0] : null;
}

async function ping() {
  const conn = await pool.getConnection();
  try {
    await conn.ping();
    return true;
  } finally {
    conn.release();
  }
}

module.exports = { pool, query, queryOne, transaction, lockRole, ping };
