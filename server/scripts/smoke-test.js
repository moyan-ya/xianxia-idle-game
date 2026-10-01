/**
 * 端到端冒烟测试：真启动服务、真连数据库，把闭环跑一遍。
 *
 *   node scripts/smoke-test.js
 *
 * 覆盖：注册 → 读档 → 坊市购买 → 换装 → 服丹 → 试炼塔 → 突破
 *       → 单条灵根洗练 → 出售 → 排行榜 → 流水分页 → 行动记录
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const net = require('net');
const config = require('../src/config');
const game = require('../src/game');

// 价格从配置读，调数值后测试无需跟着改
const sellUnitOf = (id) => Math.max(1, Math.floor(game.itemMap.get(id).price * game.world.sellRate));

/**
 * 端口占用检查 —— 必须有。
 * 否则本进程 listen 失败被吞掉，请求会打到已经在跑的开发服务器上，
 * 测出来的是那份"旧代码/旧配置"，回归会被悄悄掩盖。
 */
function assertPortFree(port) {
  return new Promise((resolve, reject) => {
    const probe = net.createConnection({ host: '127.0.0.1', port });
    probe.setTimeout(800);
    probe.on('connect', () => {
      probe.destroy();
      reject(new Error(`端口 ${port} 已被占用（多半是开发服务器还开着）。请先停掉它再跑冒烟测试，否则测的是旧进程。`));
    });
    probe.on('timeout', () => { probe.destroy(); resolve(); });
    probe.on('error', () => resolve());
  });
}

const BASE = { host: '127.0.0.1', port: config.port };

let passed = 0;
let failed = 0;

function request(method, urlPath, body, token) {
  return new Promise((resolve, reject) => {
    const payload = (body === undefined || body === null) ? null : JSON.stringify(body);
    const req = http.request({
      host: BASE.host,
      port: BASE.port,
      path: urlPath,
      method,
      headers: Object.assign(
        payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
        token ? { Authorization: `Bearer ${token}` } : {}
      )
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        try {
          resolve({ status: res.statusCode, body: JSON.parse(raw) });
        } catch (e) {
          reject(new Error(`响应不是 JSON: ${raw.slice(0, 200)}`));
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function check(name, condition, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✔ ${name}${extra ? ' — ' + extra : ''}`);
  } else {
    failed += 1;
    console.log(`  ✘ ${name}${extra ? ' — ' + extra : ''}`);
  }
}

async function main() {
  await assertPortFree(config.port);
  console.log(`\n启动服务（端口 ${config.port}）...`);
  require('../app');
  await new Promise((r) => setTimeout(r, 800));

  const uniq = String(Date.now()).slice(-7);
  const username = `smoke${uniq}`;
  const nickname = `试剑${uniq.slice(-3)}`;

  console.log('\n[1] 注册与鉴权');
  const reg = await request('POST', '/api/auth/register', { username, password: '123456', nickname });
  check('注册返回 code=0', reg.body.code === 0, `msg=${reg.body.msg}`);
  const token = reg.body.data && reg.body.data.token;
  check('拿到 JWT', !!token);

  const noAuth = await request('GET', '/api/role/profile');
  check('未带令牌被拒', noAuth.status === 401, `status=${noAuth.status}`);

  const profile = await request('GET', '/api/role/profile', null, token);
  const p0 = profile.body.data;
  check('读到角色档案', profile.body.code === 0 && p0.role.nickname === nickname);
  check('灵根已生成（五行）', p0.role.roots && Object.keys(p0.role.roots).length === 5, JSON.stringify(p0.role.roots));
  check('灵石产出速率 > 0', p0.derived.stonePerSec > 0, `${p0.derived.stonePerSec} 灵石/秒`);
  check('开局赠礼到账', p0.role.spiritStone >= 500, `灵石 ${p0.role.spiritStone}`);
  check('已无灵气字段', p0.role.qi === undefined && p0.derived.qiPerSec === undefined);

  console.log('\n[2] 惰性结算（把 last_settle_at 往前推 1 小时）');
  const mysql = require('mysql2/promise');
  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database
  });
  const where = '`account_id` = (SELECT `id` FROM `account` WHERE `username` = ?)';
  await conn.query(`UPDATE \`role\` SET \`last_settle_at\` = NOW() - INTERVAL 1 HOUR WHERE ${where}`, [username]);
  const after = await request('GET', '/api/role/profile', null, token);
  const p1 = after.body.data;
  check('结算出收益', p1.settle.gainedStone > 0, `+${p1.settle.gainedStone} 灵石 / +${p1.settle.gainedExp} 修为`);
  check('灵石已入账', p1.role.spiritStone > p0.role.spiritStone, `${p0.role.spiritStone} → ${p1.role.spiritStone}`);

  console.log('\n[3] 坊市与背包');
  // 测试用注资：新号只有几万灵石，买不起筑基档装备
  await conn.query(`UPDATE \`role\` SET \`spirit_stone\` = \`spirit_stone\` + 5000000 WHERE ${where}`, [username]);
  const shop = await request('GET', '/api/shop/list', null, token);
  check('坊市列表非空', shop.body.code === 0 && shop.body.data.items.length > 0, `${shop.body.data.items.length} 件`);
  check('坊市以灵石计价', typeof shop.body.data.spiritStone === 'number' && shop.body.data.qi === undefined,
    `spiritStone=${shop.body.data.spiritStone}`);

  const bag0 = await request('GET', '/api/bag/list', null, token);
  check('开局自带青锋剑且已装备',
    bag0.body.code === 0 && bag0.body.data.equip.artifact && bag0.body.data.equip.artifact.name === '青锋剑',
    bag0.body.data.equip.artifact && bag0.body.data.equip.artifact.name);

  const buy = await request('POST', '/api/shop/buy', { itemId: 23, num: 1 }, token);
  check('买下玄铁重剑', buy.body.code === 0, buy.body.msg);
  const equipRes = await request('POST', '/api/bag/equip', { itemId: 23 }, token);
  check('换装法宝后攻击提升', equipRes.body.code === 0 && equipRes.body.data.derived.atk > p1.derived.atk,
    `攻击 ${p1.derived.atk} → ${equipRes.body.data.derived.atk}`);
  const usePill = await request('POST', '/api/bag/use', { itemId: 1, num: 1 }, token);
  check('服下聚气丹', usePill.body.code === 0, usePill.body.msg);

  console.log('\n[4] 试炼塔（服务端权威 + 种子战斗）');
  const stages = await request('GET', '/api/battle/stages', null, token);
  check('塔层列表返回', stages.body.code === 0 && stages.body.data.stages.length === 15);
  check('每层都标注了失败扣修为', stages.body.data.stages.every((s) => s.failExp > 0),
    `第 1 层扣 ${stages.body.data.stages[0].failExp}，第 15 层扣 ${stages.body.data.stages[14].failExp}`);
  check('仅第一层解锁', stages.body.data.unlocked === 1);
  const locked = await request('POST', '/api/battle/challenge', { stageId: 5 }, token);
  check('越级挑战被拦截', locked.body.code !== 0, locked.body.msg);
  const fight = await request('POST', '/api/battle/challenge', { stageId: 1 }, token);
  const rep = fight.body.data && fight.body.data.challenge;
  check('第一层有战报', fight.body.code === 0 && rep.report.rounds.length > 0,
    `${rep.report.rounds.length} 回合 / ${rep.report.win ? '胜' : '败'}`);
  check('战斗 seed 已记录', typeof rep.report.seed === 'number', `seed=${rep.report.seed}`);
  check('胜利后解锁第二层', rep.report.win && (await request('GET', '/api/battle/stages', null, token)).body.data.unlocked >= 2);

  console.log('\n[5] 突破（含保底）');
  await conn.query(`UPDATE \`role\` SET \`exp\` = \`exp\` + 100000 WHERE ${where}`, [username]);
  const bt = await request('POST', '/api/role/breakthrough', null, token);
  const b = bt.body.data && bt.body.data.breakthrough;
  check('突破接口可用', bt.body.code === 0, bt.body.msg);
  if (b) {
    check('返回成功率与 roll', typeof b.rate === 'number' && typeof b.roll === 'number', `rate=${b.rate} roll=${b.roll}`);
    check('结果自洽', b.success === (b.roll < b.rate), b.message);
    check('成功后层数提升', !b.success || bt.body.data.role.realmLevel === 2,
      `境界 ${bt.body.data.role.realmName}${bt.body.data.role.realmLevel}层`);
  }

  console.log('\n[6] 单条灵根洗练');
  await conn.query(`UPDATE \`role\` SET \`spirit_stone\` = \`spirit_stone\` + 100000 WHERE ${where}`, [username]);
  const before = (await request('GET', '/api/role/profile', null, token)).body.data.role;
  const reroll = await request('POST', '/api/role/roots/reroll', { element: '火' }, token);
  const rr = reroll.body.data && reroll.body.data.reroll;
  check('洗练出结果', reroll.body.code === 0 && rr && typeof rr.value === 'number',
    rr && `火 ${rr.oldValue} → ${rr.value}`);
  check('未确认前不生效', reroll.body.data.role.roots['火'] === before.roots['火'],
    `火仍是 ${reroll.body.data.role.roots['火']}`);
  const keep = await request('POST', '/api/role/roots/confirm', { save: true }, token);
  check('保存后生效', keep.body.data.role.roots['火'] === rr.value,
    `火 = ${keep.body.data.role.roots['火']}`);
  const otherEl = ['金', '木', '水', '土'];
  check('其余灵根未变', otherEl.every((el) => keep.body.data.role.roots[el] === before.roots[el]));

  console.log('\n[7] 出售（市价 7 成）');
  // 玄铁重剑在 [3] 里已装备，卖之前必须先卸下
  const equippedSell = await request('POST', '/api/bag/sell', { itemId: 23, num: 1 }, token);
  check('已装备的物品不可出售', equippedSell.body.code !== 0, equippedSell.body.msg);
  await request('POST', '/api/bag/unequip', { type: 'artifact' }, token);
  const stoneBeforeSell = keep.body.data.role.spiritStone;
  const sold = await request('POST', '/api/bag/sell', { itemId: 23, num: 1 }, token);
  check('卸下后可出售', sold.body.code === 0, sold.body.msg);
  if (sold.body.code === 0) {
    check(`单价为市价 7 成（${game.itemMap.get(23).price} → ${sellUnitOf(23)}）`,
      sold.body.data.sold.unit === sellUnitOf(23), `unit=${sold.body.data.sold.unit}`);
    check('灵石到账', sold.body.data.role.spiritStone - stoneBeforeSell === sellUnitOf(23),
      `${stoneBeforeSell} → ${sold.body.data.role.spiritStone}`);
  }

  console.log('\n[8] 排行榜');
  const rank = await request('GET', '/api/rank/list?limit=20', null, token);
  check('榜单可用', rank.body.code === 0, rank.body.msg);
  check('返回名次与我', typeof rank.body.data.myRank === 'number' && !!rank.body.data.my,
    `第 ${rank.body.data.myRank} 名 / 共 ${rank.body.data.total} 人`);
  check('榜内名次连续', rank.body.data.list.every((r, i) => r.rank === i + 1));

  console.log('\n[9] 流水分页与行动记录');
  const logs = await request('GET', '/api/role/logs?page=1&pageSize=5', null, token);
  check('流水返回分页结构', logs.body.code === 0 && Array.isArray(logs.body.data.currency.list),
    `total=${logs.body.data.currency.total} pages=${logs.body.data.currency.pages}`);
  check('每页条数受限', logs.body.data.currency.list.length <= 5);
  check('战斗记录有留档', logs.body.data.battles.list.length > 0);
  check('战斗留档也走分页', typeof logs.body.data.battles.total === 'number'
    && logs.body.data.battles.list.length <= logs.body.data.battles.pageSize,
    `共 ${logs.body.data.battles.total} 条`);

  const acts = await request('GET', '/api/role/actions', null, token);
  const types = acts.body.data.list.map((x) => x.type);
  check('行动记录有条目', acts.body.code === 0 && types.length > 0, `${types.length} 条`);
  check('行动记录覆盖购买与挑战', types.includes('shop') && types.includes('battle'), types.join(','));
  check('档案接口也带行动记录', Array.isArray((await request('GET', '/api/role/profile', null, token)).body.data.actions));

  console.log('\n[10] 悟道石：同境界买下即参悟');
  const rate0 = (await request('GET', '/api/role/profile', null, token)).body.data.derived.breakRate;

  // 买之前先看坊市标注（买满 100% 之后 immediate 会变成 false，所以顺序不能反）
  const shopBefore = await request('GET', '/api/shop/list', null, token);
  const rowBefore = shopBefore.body.data.items.find((i) => i.itemId === 31);
  check('坊市标注本境界可参悟与剩余可买颗数',
    rowBefore.realmMatch === true && rowBefore.immediate === true && rowBefore.maxUseful > 0,
    `每颗 +${Math.round(rowBefore.breakBonusPer * 100)}%，最多再买 ${rowBefore.maxUseful} 颗即满`);

  const bs = await request('POST', '/api/shop/buy', { itemId: 31, num: 1 }, token); // 悟道石·炼气
  check('买入即生效', bs.body.code === 0 && bs.body.data.bought.immediate === true, bs.body.msg);
  if (bs.body.code === 0) {
    const per = rowBefore.breakBonusPer;
    check(`突破成功率 +${Math.round(per * 100)}%`,
      Math.abs(bs.body.data.bought.rateAfter - (rate0 + per)) < 1e-6,
      `${rate0} → ${bs.body.data.bought.rateAfter}`);
  }
  const bagStone = await request('GET', '/api/bag/list', null, token);
  check('悟道石没进背包', !bagStone.body.data.items.some((i) => i.itemId === 31));
  const cross = await request('POST', '/api/shop/buy', { itemId: 32, num: 1 }, token); // 悟道石·筑基
  check('异境界悟道石进背包', cross.body.code === 0 && cross.body.data.bought.immediate === false);
  const bagStone2 = await request('GET', '/api/bag/list', null, token);
  check('背包标注需在对应境界参悟',
    bagStone2.body.data.items.some((i) => i.itemId === 32 && i.usableNow === false),
    (bagStone2.body.data.items.find((i) => i.itemId === 32) || {}).lockedReason);

  console.log('\n[11] 散灵丹与主灵根命名');
  await conn.query(`UPDATE \`role\` SET \`spirit_stone\` = \`spirit_stone\` + 2000000 WHERE ${where}`, [username]);
  const beforeTitle = (await request('GET', '/api/role/profile', null, token)).body.data.role.rootTitle;
  await request('POST', '/api/shop/buy', { itemId: 41, num: 1 }, token); // 散灵丹
  const rr2 = await request('POST', '/api/bag/use', { itemId: 41, num: 1, element: '木' }, token);
  check('散去指定灵根', rr2.body.code === 0 && Number(rr2.body.data.role.roots['木']) === 0, rr2.body.msg);
  check('主灵根命名随之变化',
    rr2.body.data.role.rootTitle !== beforeTitle && /灵根$/.test(rr2.body.data.role.rootTitle),
    `${beforeTitle} → ${rr2.body.data.role.rootTitle}`);

  console.log('\n[12] 战斗推演（公式推导）');
  const pv = await request('GET', '/api/battle/preview?stageId=1', null, token);
  check('推演接口可用', pv.body.code === 0, pv.body.msg);
  check('逐条灵根判定', Array.isArray(pv.body.data.attack.breakdown) && pv.body.data.attack.breakdown.length > 0,
    `${pv.body.data.attack.breakdown.length} 条`);
  check('给出攻击灵根系数', typeof pv.body.data.attack.mul === 'number', `mul=${pv.body.data.attack.mul}`);
  check('给出每击伤害与回合预估', pv.body.data.damage.playerHit > 0 && pv.body.data.damage.roundsToKill > 0,
    `每击≈${pv.body.data.damage.playerHit}，${pv.body.data.damage.roundsToKill} 回合击杀`);

  console.log('\n[13] 演示账号可登录');
  const demo = await request('POST', '/api/auth/login', { username: 'test', password: '123456' });
  check('test/123456 登录成功', demo.body.code === 0, demo.body.msg);
  if (demo.body.code === 0) {
    check('演示账号数据已随迁移保留', demo.body.data.role.spiritStone > 0,
      `灵石 ${demo.body.data.role.spiritStone}`);
  }

  // 清掉本轮测试账号，保持排行榜干净
  const { cleanup } = require('./cleanup-test-data');
  const cleaned = await cleanup(conn);
  console.log(`\n已清理测试账号 ${cleaned.accounts} 个`);

  await conn.end();

  console.log('\n─────────────────────────────');
  console.log(`  通过 ${passed} 项，失败 ${failed} 项`);
  console.log('─────────────────────────────\n');

  process.exit(failed === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n冒烟测试异常：', e);
  process.exit(1);
});
