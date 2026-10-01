/**
 * 清理测试账号（排行榜会被这些账号污染）
 *
 *   node scripts/cleanup-test-data.js            # 预览
 *   node scripts/cleanup-test-data.js --apply    # 真删
 *
 * 只删用户名以 probe / smoke / dup / newbie 开头的账号，绝不碰真实账号。
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const config = require('../src/config');

const PREFIXES = ['probe', 'smoke', 'dup', 'newbie'];

/**
 * @param {import('mysql2/promise').Connection} conn
 * @param {string[]} prefixes
 * @returns {Promise<{accounts:number, roles:number}>}
 */
async function cleanup(conn, prefixes = PREFIXES) {
  const like = prefixes.map(() => '`username` LIKE ?').join(' OR ');
  const params = prefixes.map((p) => `${p}%`);

  const [accounts] = await conn.query(`SELECT \`id\` FROM \`account\` WHERE ${like}`, params);
  const accountIds = accounts.map((a) => a.id);
  if (!accountIds.length) return { accounts: 0, roles: 0 };

  const [roles] = await conn.query(
    `SELECT \`id\` FROM \`role\` WHERE \`account_id\` IN (${accountIds.map(() => '?').join(',')})`,
    accountIds
  );
  const roleIds = roles.map((r) => r.id);

  if (roleIds.length) {
    const ph = roleIds.map(() => '?').join(',');
    // 这两张表没有外键，必须手工清；role_item / role_stage / log_action 会随 role 级联删除
    await conn.query(`DELETE FROM \`log_currency\` WHERE \`role_id\` IN (${ph})`, roleIds);
    await conn.query(`DELETE FROM \`log_battle\` WHERE \`role_id\` IN (${ph})`, roleIds);
  }

  await conn.query(
    `DELETE FROM \`account\` WHERE \`id\` IN (${accountIds.map(() => '?').join(',')})`,
    accountIds
  );

  return { accounts: accountIds.length, roles: roleIds.length };
}

async function main() {
  const apply = process.argv.includes('--apply');

  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    database: config.db.database
  });

  const like = PREFIXES.map(() => '`username` LIKE ?').join(' OR ');
  const [preview] = await conn.query(
    `SELECT \`username\` FROM \`account\` WHERE ${like} ORDER BY \`id\` DESC LIMIT 10`,
    PREFIXES.map((p) => `${p}%`)
  );
  const [[count]] = await conn.query(
    `SELECT COUNT(*) AS n FROM \`account\` WHERE ${like}`,
    PREFIXES.map((p) => `${p}%`)
  );

  console.log(`\n匹配前缀 ${PREFIXES.join(' / ')} 的账号：${count.n} 个`);
  if (preview.length) {
    console.log('示例：' + preview.map((r) => r.username).join(', '));
  }

  if (!apply) {
    console.log('\n这是预览。确认清理请加 --apply\n');
    await conn.end();
    return;
  }

  const result = await cleanup(conn);
  const [[left]] = await conn.query('SELECT COUNT(*) AS n FROM `role`');
  console.log(`\n已删除 ${result.accounts} 个测试账号、${result.roles} 个角色`);
  console.log(`剩余真实角色：${left.n} 个\n`);

  await conn.end();
}

if (require.main === module) {
  main().catch((e) => {
    console.error('\n清理失败：', e.message);
    process.exit(1);
  });
}

module.exports = { cleanup, PREFIXES };
