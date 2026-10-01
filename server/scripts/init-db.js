/**
 * 数据库初始化脚本
 *
 *   node scripts/init-db.js          建库建表（幂等，会重建表结构）
 *   node scripts/init-db.js --reset  先 DROP DATABASE 再重建
 *
 * 建表完成后会创建一个演示账号：test / 123456（道号：凌尘）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const fs = require('fs');
const path = require('path');
const mysql = require('mysql2/promise');

const config = require('../src/config');

const DEMO = { username: 'test', password: '123456', nickname: '凌尘' };

async function main() {
  const reset = process.argv.includes('--reset');
  const schemaPath = path.join(__dirname, '..', 'sql', 'schema.sql');
  let sql = fs.readFileSync(schemaPath, 'utf8');

  // schema.sql 里写死了 xianxia，按 .env 的 DB_NAME 替换，保持单一数据源
  if (config.db.database !== 'xianxia') {
    sql = sql.replace(/`xianxia`/g, `\`${config.db.database}\``);
  }

  console.log(`\n[1/3] 连接 MySQL ${config.db.user}@${config.db.host}:${config.db.port} ...`);
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true,
    charset: 'utf8mb4'
  });
  console.log('      连接成功');

  if (reset) {
    console.log(`[2/3] DROP DATABASE \`${config.db.database}\` ...`);
    await conn.query(`DROP DATABASE IF EXISTS \`${config.db.database}\``);
  } else {
    // schema.sql 里的 DROP TABLE 会清空一切。
    // 不传 --reset 时必须先确认库里没有真实账号，否则拒绝执行 —— 避免手滑删档。
    const [tbl] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [config.db.database, 'account']
    );
    if (tbl[0].n > 0) {
      await conn.query(`USE \`${config.db.database}\``);
      const [acc] = await conn.query('SELECT COUNT(*) AS n FROM `account`');
      if (acc[0].n > 0) {
        await conn.end();
        console.error(`\n已中止：数据库 \`${config.db.database}\` 里已有 ${acc[0].n} 个账号。`);
        console.error('建表脚本会 DROP TABLE，为避免误删玩家数据，本次没有执行。');
        console.error('确认要清空重建，请改用： npm run db:reset\n');
        process.exit(1);
      }
    }
    console.log('[2/3] 跳过 DROP（库中无账号数据；彻底重来请加 --reset）');
  }

  console.log('      执行 schema.sql ...');
  await conn.query(sql);
  await conn.end();
  console.log('      建表完成');

  console.log('[3/3] 创建演示账号 ...');
  // 复用真实注册逻辑，顺带验证一遍业务代码
  const authService = require('../src/services/auth.service');
  const db = require('../src/config/db');
  const dao = require('../src/dao');

  const exists = await dao.findAccountByUsername(db.pool, DEMO.username);
  if (exists) {
    console.log(`      账号 ${DEMO.username} 已存在，跳过`);
  } else {
    await authService.register(DEMO);
    console.log(`      已创建：${DEMO.username} / ${DEMO.password}（道号 ${DEMO.nickname}）`);
  }

  const role = await dao.findRoleByAccount(db.pool, exists ? exists.id : (await dao.findAccountByUsername(db.pool, DEMO.username)).id);
  console.log(`      角色：${role.nickname} · 灵根 ${JSON.stringify(role.roots)}`);

  await db.pool.end();
  console.log('\n数据库初始化完成 ✔\n');
}

main().catch((e) => {
  console.error('\n初始化失败：', e.message);
  if (e.code === 'ER_ACCESS_DENIED_ERROR') {
    console.error('→ 请检查 server/.env 里的 DB_USER / DB_PASSWORD');
  }
  if (e.code === 'ECONNREFUSED') {
    console.error('→ 连不上 MySQL，请确认服务已启动、端口正确');
  }
  process.exit(1);
});
