/**
 * 老库平滑升级（幂等，可反复执行，不会丢玩家数据）
 *
 *   node scripts/migrate.js
 *
 * 本次升级内容：
 *   1. 废除"灵气"：role.qi 合并进 role.spirit_stone，然后删除该列
 *   2. 新增 role.root_pity / role.root_pending（单条灵根洗练 + 保底）
 *   3. 新增 log_action 表（右侧行动记录）
 *   4. 历史流水的 kind='qi' 统一改成 'stone'
 *   5. 新增 role.break_bonus（悟道石带来的突破成功率加成）
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const mysql = require('mysql2/promise');
const config = require('../src/config');

const db = config.db.database;

async function main() {
  const conn = await mysql.createConnection({
    host: config.db.host,
    port: config.db.port,
    user: config.db.user,
    password: config.db.password,
    multipleStatements: true
  });

  console.log(`\n连接 ${config.db.user}@${config.db.host}:${config.db.port}`);

  const [dbRows] = await conn.query(
    'SELECT SCHEMA_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?', [db]);
  if (!dbRows.length) {
    await conn.end();
    console.error(`\n数据库 \`${db}\` 不存在，请先执行 npm run db:reset\n`);
    process.exit(1);
  }
  await conn.query(`USE \`${db}\``);

  const hasColumn = async (table, column) => {
    const [r] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?',
      [db, table, column]);
    return r[0].n > 0;
  };
  const hasTable = async (table) => {
    const [r] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.tables WHERE table_schema = ? AND table_name = ?',
      [db, table]);
    return r[0].n > 0;
  };
  const step = async (label, fn) => {
    const changed = await fn();
    console.log(`  ${changed ? '✔' : '·'} ${label}${changed ? '' : '（已是最新，跳过）'}`);
  };

  console.log('\n[1/4] 灵气 → 灵石');
  await step('把 role.qi 合并进 role.spirit_stone', async () => {
    if (!(await hasColumn('role', 'qi'))) return false;
    const [r] = await conn.query(
      'UPDATE `role` SET `spirit_stone` = `spirit_stone` + `qi` WHERE `qi` > 0');
    console.log(`      合并了 ${r.affectedRows} 个角色的灵气（合计不丢失）`);
    return true;
  });
  await step('删除 role.qi 列', async () => {
    if (!(await hasColumn('role', 'qi'))) return false;
    await conn.query('ALTER TABLE `role` DROP COLUMN `qi`');
    return true;
  });
  await step("历史流水 kind='qi' 改名为 'stone'", async () => {
    const [r] = await conn.query("UPDATE `log_currency` SET `kind` = 'stone' WHERE `kind` = 'qi'");
    return r.affectedRows > 0;
  });

  console.log('\n[2/4] 单条灵根洗练');
  await step('新增 role.root_pity 列', async () => {
    if (await hasColumn('role', 'root_pity')) return false;
    await conn.query('ALTER TABLE `role` ADD COLUMN `root_pity` JSON NULL AFTER `roots`');
    return true;
  });
  await step('新增 role.root_pending 列', async () => {
    if (await hasColumn('role', 'root_pending')) return false;
    await conn.query('ALTER TABLE `role` ADD COLUMN `root_pending` JSON NULL AFTER `root_pity`');
    return true;
  });
  await step('为老角色补齐 root_pity 初值', async () => {
    const [r] = await conn.query(
      "UPDATE `role` SET `root_pity` = JSON_OBJECT('金',0,'木',0,'水',0,'火',0,'土',0) " +
      'WHERE `root_pity` IS NULL');
    return r.affectedRows > 0;
  });

  console.log('\n[3/4] 行动记录表');
  await step('创建 log_action', async () => {
    if (await hasTable('log_action')) return false;
    await conn.query(`
      CREATE TABLE \`log_action\` (
        \`id\`         BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        \`role_id\`    BIGINT UNSIGNED NOT NULL,
        \`type\`       VARCHAR(24)     NOT NULL,
        \`text\`       VARCHAR(160)    NOT NULL,
        \`created_at\` DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (\`id\`),
        KEY \`idx_role_time\` (\`role_id\`,\`created_at\`),
        CONSTRAINT \`fk_action_role\` FOREIGN KEY (\`role_id\`) REFERENCES \`role\` (\`id\`) ON DELETE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci COMMENT='行动记录'`);
    return true;
  });

  console.log('\n[4/5] 悟道石加成列');
  await step('新增 role.break_bonus 列', async () => {
    if (await hasColumn('role', 'break_bonus')) return false;
    await conn.query(
      "ALTER TABLE `role` ADD COLUMN `break_bonus` INT NOT NULL DEFAULT 0 " +
      "COMMENT '悟道石突破加成，万分比' AFTER `break_pity`");
    return true;
  });

  console.log('\n[5/5] 收尾');
  await step('确认排行榜索引 idx_rank 存在', async () => {
    const [r] = await conn.query(
      'SELECT COUNT(*) AS n FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?',
      [db, 'role', 'idx_rank']);
    if (r[0].n > 0) return false;
    await conn.query('ALTER TABLE `role` ADD KEY `idx_rank` (`realm`,`realm_level`,`exp`)');
    return true;
  });

  const [[counts]] = await conn.query(
    'SELECT (SELECT COUNT(*) FROM `role`) AS roles, (SELECT COUNT(*) FROM `log_action`) AS actions');
  console.log(`\n当前：${counts.roles} 个角色，${counts.actions} 条行动记录`);
  console.log('迁移完成 ✔\n');

  await conn.end();
}

main().catch((e) => {
  console.error('\n迁移失败：', e.message);
  process.exit(1);
});
