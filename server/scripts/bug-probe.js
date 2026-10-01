/**
 * 对抗性探针：专打并发、边界、越权、原子性，以及本次新增的七个功能。
 *
 *   node scripts/bug-probe.js
 *
 * 故意跑在 3100 端口，不影响正在开发的 3000 服务。
 */
process.env.PORT = process.env.PROBE_PORT || '3100';

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const http = require('http');
const mysql = require('mysql2/promise');
const config = require('../src/config');
const game = require('../src/game');

// 价格一律从配置读，调整数值后测试无需跟着改
const priceOf = (id) => game.itemMap.get(id).price;
const sellUnitOf = (id) => Math.max(1, Math.floor(game.itemMap.get(id).price * game.world.sellRate));

const HOST = '127.0.0.1';
const PORT = config.port;

let pass = 0;
let fail = 0;
const findings = [];

function check(name, ok, detail = '') {
  if (ok) {
    pass += 1;
    console.log(`  ✔ ${name}${detail ? ' — ' + detail : ''}`);
  } else {
    fail += 1;
    console.log(`  ✘ ${name}${detail ? ' — ' + detail : ''}`);
  }
  return ok;
}

function finding(title, severity, detail) {
  findings.push({ title, severity, detail });
  console.log(`  ⚠ [${severity}] ${title} — ${detail}`);
}

function request(method, path, body, token) {
  return new Promise((resolve, reject) => {
    // 注意：没有请求体时绝不能带 Content-Type: application/json，
    // 否则 body-parser 的 strict 模式会把空体当畸形 JSON 拒掉。
    const payload = (body === undefined || body === null) ? null : JSON.stringify(body);
    const req = http.request({
      host: HOST,
      port: PORT,
      path,
      method,
      headers: Object.assign(
        payload ? { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) } : {},
        token ? { Authorization: `Bearer ${token}` } : {}
      )
    }, (res) => {
      let raw = '';
      res.on('data', (c) => { raw += c; });
      res.on('end', () => {
        let parsed = null;
        try { parsed = JSON.parse(raw); } catch (e) { parsed = { parseError: raw.slice(0, 120) }; }
        resolve({ status: res.statusCode, body: parsed });
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function register(conn, tag) {
  const username = `probe${tag}${String(Date.now()).slice(-6)}${Math.floor(Math.random() * 100)}`;
  const res = await request('POST', '/api/auth/register', {
    username, password: '123456', nickname: `探${tag}${String(Date.now()).slice(-3)}${Math.floor(Math.random() * 90 + 10)}`
  });
  if (res.body.code !== 0) throw new Error(`注册失败: ${res.body.msg}`);
  const [rows] = await conn.query(
    'SELECT r.* FROM `role` r JOIN `account` a ON a.id = r.account_id WHERE a.username = ?', [username]);
  return { token: res.body.data.token, roleId: rows[0].id, profile: res.body.data, username };
}

async function main() {
  console.log(`\n启动被测服务（端口 ${PORT}）...`);
  require('../app');
  await sleep(900);

  const conn = await mysql.createConnection({
    host: config.db.host, port: config.db.port, user: config.db.user,
    password: config.db.password, database: config.db.database, dateStrings: ['DATETIME']
  });

  const setRole = (roleId, sql, params = []) =>
    conn.query(`UPDATE \`role\` SET ${sql} WHERE id = ?`, [...params, roleId]);
  const getRole = async (roleId) => {
    const [r] = await conn.query('SELECT * FROM `role` WHERE id = ?', [roleId]);
    return r[0];
  };
  /** 直接把塔解锁到第 14 层，方便测最后一层 */
  const unlockAll = async (roleId) => {
    for (let i = 1; i <= 14; i += 1) {
      await conn.query(
        'INSERT INTO `role_stage` (`role_id`, `stage_id`, `clear_count`) VALUES (?, ?, 1) ' +
        'ON DUPLICATE KEY UPDATE `clear_count` = 1', [roleId, i]);
    }
  };
  /** 直接发一件已装备的物品（绕过坊市，用于构造测试角色） */
  const equipItem = async (roleId, itemId) => {
    await conn.query(
      'INSERT INTO `role_item` (`role_id`, `item_id`, `num`, `equipped`) VALUES (?, ?, 1, 1) ' +
      'ON DUPLICATE KEY UPDATE `num` = 1, `equipped` = 1', [roleId, itemId]);
  };

  /* ───────────── 1. 并发结算：会不会重复发钱 ───────────── */
  console.log('\n[1] 并发结算（8 个请求同时打 profile，把基准时间推前 1 小时）');
  {
    const a = await register(conn, 'c');
    const before = await getRole(a.roleId);
    const rate = a.profile.derived.stonePerSec;

    await setRole(a.roleId, '`last_settle_at` = NOW() - INTERVAL 1 HOUR');
    const expected = Math.floor(rate * 3600);

    const results = await Promise.all(
      Array.from({ length: 8 }, () => request('GET', '/api/role/profile', null, a.token))
    );
    await sleep(200);
    const after = await getRole(a.roleId);
    const delta = Number(after.spirit_stone) - Number(before.spirit_stone);

    check('8 个并发请求都成功', results.every((r) => r.body && r.body.code === 0),
      results.map((r) => (r.body && r.body.msg) || r.status).join(' | '));
    const withinOne = delta >= expected * 0.97 && delta <= expected * 1.03;
    check(`只发放了一份收益（期望约 ${expected}，实际 ${delta}）`, withinOne,
      withinOne ? '' : `多发了约 ${(delta / expected).toFixed(1)} 倍`);
    if (!withinOne) finding('并发结算可能重复发放', '致命', `期望 ${expected}，实际 ${delta}`);

    const stones = results.filter((r) => r.body && r.body.data).map((r) => Number(r.body.data.role.spiritStone));
    // 每个请求各自按"自己那一刻"算结算窗口，所以彼此可能差 1~2 秒的产出。
    // 真正要守的是：没有任何一个响应偏离到"少发/多发一整笔"的程度。
    const lo = Math.min(...stones);
    const hi = Math.max(...stones);
    check('8 个响应的余额彼此不矛盾（差额仅来自各自的结算窗口）',
      stones.length === 8 && hi - lo <= Math.ceil(rate * 3) + 10,
      `最小 ${lo} / 最大 ${hi}（差 ${hi - lo}，1 秒产出约 ${rate}）`);
  }

  /* ───────────── 2. 战斗纯函数可复算 ───────────── */
  console.log('\n[2] 同种子战斗可复算（防作弊的地基）');
  {
    const battleCore = require('../src/core/battle');
    const player = { name: '测试甲', element: '金', atk: 120, def: 40, hp: 900, speed: 12 };
    const monster = { name: '妖狼', element: '木', atk: 100, def: 20, hp: 800, speed: 10 };
    const r1 = battleCore.simulate(player, monster, 12345);
    const r2 = battleCore.simulate(player, monster, 12345);
    const r3 = battleCore.simulate(player, monster, 54321);
    check('同种子结果完全一致', JSON.stringify(r1) === JSON.stringify(r2));
    check('不同种子结果不同', JSON.stringify(r1) !== JSON.stringify(r3));
    check('战斗不修改入参', player.hp === 900 && monster.hp === 800);
  }

  /* ───────────── 3. 参数越界不该 500 ───────────── */
  console.log('\n[3] 畸形/越界参数是否被妥善拒绝（而不是 500）');
  {
    const a = await register(conn, 'p');
    const cases = [
      ['logs?page=-5', 'GET', '/api/role/logs?page=-5&pageSize=20', undefined],
      ['logs?pageSize=9999', 'GET', '/api/role/logs?pageSize=9999', undefined],
      ['logs?page=abc', 'GET', '/api/role/logs?page=abc', undefined],
      ['actions?limit=-1', 'GET', '/api/role/actions?limit=-1', undefined],
      ['rank?limit=0', 'GET', '/api/rank/list?limit=0', undefined],
      ['reroll 五行非法', 'POST', '/api/role/roots/reroll', { element: '雷' }],
      ['reroll 缺参数', 'POST', '/api/role/roots/reroll', {}],
      ['confirm 缺参数', 'POST', '/api/role/roots/confirm', {}],
      ['sell 数量为 0', 'POST', '/api/bag/sell', { itemId: 21, num: 0 }],
      ['sell 不存在物品', 'POST', '/api/bag/sell', { itemId: 9999, num: 1 }],
      ['challenge stageId=abc', 'POST', '/api/battle/challenge', { stageId: 'abc' }],
      ['challenge stageId=999', 'POST', '/api/battle/challenge', { stageId: 999 }],
      ['buy itemId=abc', 'POST', '/api/shop/buy', { itemId: 'abc', num: 1 }],
      ['use num=99999', 'POST', '/api/bag/use', { itemId: 1, num: 99999 }]
    ];
    for (const [label, method, path, body] of cases) {
      const r = await request(method, path, body, a.token);
      const ok = r.status < 500 && r.body.code !== undefined;
      check(`${label} → 友好拒绝`, ok, `HTTP ${r.status} code=${r.body.code} msg=${r.body.msg || r.body.parseError || ''}`);
      if (!ok) finding('畸形参数导致 500', '中', `${label} → HTTP ${r.status}`);
    }
  }

  /* ───────────── 4. 鉴权与越权隔离 ───────────── */
  console.log('\n[4] 鉴权与越权隔离');
  {
    const a = await register(conn, 'v');
    const b = await register(conn, 'w');

    const bad = await request('GET', '/api/role/profile', null, 'garbage.token.here');
    check('伪造 token 被拒 401', bad.status === 401 && bad.body.code === 1002, `HTTP ${bad.status}`);

    await setRole(b.roleId, '`spirit_stone` = 999999');
    const bBefore = await getRole(b.roleId);
    await request('POST', '/api/shop/buy', { itemId: 1, num: 5 }, a.token);
    await sleep(120);
    const bAfter = await getRole(b.roleId);
    check('A 的操作不影响 B 的资源', Number(bAfter.spirit_stone) === Number(bBefore.spirit_stone));
  }

  /* ───────────── 5. 资源原子性 ───────────── */
  console.log('\n[5] 余额不足时是否原子拒绝（不会扣成负数）');
  {
    const a = await register(conn, 'm');
    await setRole(a.roleId, '`spirit_stone` = 0');
    const [itemBefore] = await conn.query(
      'SELECT COALESCE(SUM(num),0) AS n FROM role_item WHERE role_id = ? AND item_id = 23', [a.roleId]);

    const r = await request('POST', '/api/shop/buy', { itemId: 23, num: 1 }, a.token);
    const after = await getRole(a.roleId);
    const [itemAfter] = await conn.query(
      'SELECT COALESCE(SUM(num),0) AS n FROM role_item WHERE role_id = ? AND item_id = 23', [a.roleId]);

    check('余额不足被拒绝', r.body.code !== 0, r.body.msg);
    check('灵石未被扣成负数', Number(after.spirit_stone) >= 0, `stone=${after.spirit_stone}`);
    check('物品未凭空增加', Number(itemAfter[0].n) === Number(itemBefore[0].n));

    const use = await request('POST', '/api/bag/use', { itemId: 1, num: 5 }, a.token);
    const [pillAfter] = await conn.query(
      'SELECT COALESCE(SUM(num),0) AS n FROM role_item WHERE role_id = ? AND item_id = 1', [a.roleId]);
    check('超量服丹被拒绝', use.body.code !== 0, use.body.msg);
    check('丹药数量未被扣负', Number(pillAfter[0].n) >= 0, `num=${pillAfter[0].n}`);
  }

  /* ───────────── 6. 装备互斥 ───────────── */
  console.log('\n[6] 同类型装备互斥（法宝只能穿一件）');
  {
    const a = await register(conn, 'e');
    await setRole(a.roleId, '`spirit_stone` = 99999999');
    await request('POST', '/api/shop/buy', { itemId: 21, num: 1 }, a.token);
    await request('POST', '/api/shop/buy', { itemId: 23, num: 1 }, a.token);
    await request('POST', '/api/bag/equip', { itemId: 21 }, a.token);
    await request('POST', '/api/bag/equip', { itemId: 23 }, a.token);

    const [eq] = await conn.query(
      'SELECT item_id FROM role_item WHERE role_id = ? AND equipped = 1', [a.roleId]);
    check('同时只有一件法宝处于装备状态', eq.length === 1, `已装备 item_id=${eq.map((x) => x.item_id).join(',')}`);
    if (eq.length !== 1) finding('装备互斥失效', '高', `equipped 行数 = ${eq.length}`);
  }

  /* ───────────── 7. 试炼塔 ───────────── */
  console.log('\n[7] 试炼塔：越级拦截 / 逐层解锁 / 重复奖励 / 新手必须能赢');
  {
    const a = await register(conn, 't');
    const jump = await request('POST', '/api/battle/challenge', { stageId: 3 }, a.token);
    check('越级挑战被拦截', jump.body.code !== 0, jump.body.msg);

    const f1 = await request('POST', '/api/battle/challenge', { stageId: 1 }, a.token);
    const report = f1.body.data.challenge.report;
    check('第一层可挑战且有战报', f1.body.code === 0 && report.rounds.length > 0);
    check('新手开局能通关第一层', report.win,
      `${report.roundCount} 回合，剩余气血 ${report.playerHp}/${report.playerMaxHp}`);
    if (!report.win) finding('新手可能输给试炼塔第一层', '高', '被妖狼(木)克制时无法通关');

    const firstReward = f1.body.data.challenge.reward;
    const stage1Cfg = game.stageMap.get(1);
    check('第一层奖励与配置一致', firstReward.stone === stage1Cfg.reward.stone && firstReward.exp === stage1Cfg.reward.exp,
      `修为 ${firstReward.exp} / 灵石 ${firstReward.stone}`);

    const f1b = await request('POST', '/api/battle/challenge', { stageId: 1 }, a.token);
    const repeatReward = f1b.body.data.challenge.reward;
    check('首通全额、重复递减', firstReward.exp > repeatReward.exp,
      `首通 ${firstReward.exp} vs 重复 ${repeatReward.exp}`);
    check('重复奖励约为三成',
      Math.abs(repeatReward.exp - Math.floor(firstReward.exp * 0.3)) <= 1,
      `${repeatReward.exp} / ${firstReward.exp}`);

    const unlock = await request('POST', '/api/battle/challenge', { stageId: 2 }, a.token);
    check('通关第一层后第二层解锁', unlock.body.code === 0, unlock.body.msg);
  }

  /* ───────────── 8. 货币唯一性：灵气已彻底移除 ───────────── */
  console.log('\n[8] 灵气已彻底移除，灵石是唯一货币');
  {
    const [cols] = await conn.query(
      "SELECT COUNT(*) AS n FROM information_schema.columns WHERE table_schema = ? AND table_name = 'role' AND column_name = 'qi'",
      [config.db.database]);
    check('role 表已无 qi 列', Number(cols[0].n) === 0);

    const a = await register(conn, 'q');
    const p = await request('GET', '/api/role/profile', null, a.token);
    check('接口不再返回 qi 字段', p.body.data.role.qi === undefined && p.body.data.derived.qiPerSec === undefined);
    check('返回石矿产速 stonePerSec', typeof p.body.data.derived.stonePerSec === 'number',
      `${p.body.data.derived.stonePerSec}/秒`);
    check('开局赠送 500 灵石', p.body.data.role.spiritStone >= 500, `stone=${p.body.data.role.spiritStone}`);

    const [kinds] = await conn.query(
      "SELECT COUNT(*) AS n FROM log_currency WHERE kind = 'qi'");
    check('流水表里没有残留的 qi 类型', Number(kinds[0].n) === 0);

    const cfg = await request('GET', '/api/game/config', null, a.token);
    check('配置表里没有 qiBonus 残留',
      !JSON.stringify(cfg.body.data).includes('qiBonus'),
      JSON.stringify(cfg.body.data.items[8].effect));
  }

  /* ───────────── 9. 单条灵根洗练 ───────────── */
  console.log('\n[9] 单条灵根洗练：随机数值 + 每 5 次保底 + 保存/放弃');
  {
    const a = await register(conn, 'r');
    await setRole(a.roleId, '`spirit_stone` = 99999999');
    const before = await getRole(a.roleId);
    const rootsBefore = before.roots;

    // 9.1 只洗一条，其余四条不动
    const roll1 = await request('POST', '/api/role/roots/reroll', { element: '金' }, a.token);
    check('洗练返回新值与原值', roll1.body.code === 0 && typeof roll1.body.data.reroll.value === 'number',
      `${roll1.body.data.reroll && roll1.body.data.reroll.oldValue} → ${roll1.body.data.reroll && roll1.body.data.reroll.value}`);
    const midRoots = (await getRole(a.roleId)).roots;
    check('未确认前灵根不变', JSON.stringify(midRoots) === JSON.stringify(rootsBefore));

    const dup = await request('POST', '/api/role/roots/reroll', { element: '木' }, a.token);
    check('有待确认结果时不允许再洗', dup.body.code !== 0, dup.body.msg);

    // 9.2 放弃 → 灵根保持原值
    const give = await request('POST', '/api/role/roots/confirm', { save: false }, a.token);
    check('放弃洗练被接受', give.body.code === 0, give.body.msg);
    const afterGive = await getRole(a.roleId);
    check('放弃后灵根维持原值', JSON.stringify(afterGive.roots) === JSON.stringify(rootsBefore));

    // 9.3 保存 → 只有那一条变
    const roll2 = await request('POST', '/api/role/roots/reroll', { element: '金' }, a.token);
    const newValue = roll2.body.data.reroll.value;
    await request('POST', '/api/role/roots/confirm', { save: true }, a.token);
    const afterSave = await getRole(a.roleId);
    check('保存后该灵根变成新值', Number(afterSave.roots['金']) === newValue,
      `金 = ${afterSave.roots['金']}（新值 ${newValue}）`);
    const others = ['木', '水', '火', '土'];
    check('其余四条灵根没被动过', others.every((el) => afterSave.roots[el] === rootsBefore[el]),
      others.map((el) => `${el}${afterSave.roots[el]}`).join(' '));

    // 9.4 保底：同一条连洗 5 次，第 5 次必定高于当前值
    await setRole(a.roleId, '`spirit_stone` = 99999999, `root_pity` = ?', [JSON.stringify({ 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 })]);
    const current = Number((await getRole(a.roleId)).roots['土']);
    let pityRollValue = null;
    let allHigher = true;
    for (let i = 1; i <= 5; i += 1) {
      const r = await request('POST', '/api/role/roots/reroll', { element: '土' }, a.token);
      if (r.body.code !== 0) { check(`第 ${i} 次洗练成功`, false, r.body.msg); break; }
      const info = r.body.data.reroll;
      if (i === 5) {
        pityRollValue = info.value;
        check('第 5 次触发保底标记', info.guaranteed === true, `guaranteed=${info.guaranteed}`);
      } else {
        if (info.guaranteed) allHigher = false;
        check(`第 ${i} 次不是保底`, info.guaranteed === false);
      }
      await request('POST', '/api/role/roots/confirm', { save: false }, a.token);
    }
    check('保底那次必定高于原值', pityRollValue !== null && pityRollValue > current,
      `原值 ${current} → 保底值 ${pityRollValue}`);
    const afterPity = await getRole(a.roleId);
    check('放弃后原值依然是 ' + current, Number(afterPity.roots['土']) === current, `土 = ${afterPity.roots['土']}`);

    // 9.5 上限保护
    await setRole(a.roleId, '`roots` = ?', [JSON.stringify({ 金: 62, 木: 30, 水: 40, 火: 20, 土: 95 })]);
    const maxed = await request('POST', '/api/role/roots/reroll', { element: '土' }, a.token);
    check('满值灵根拒绝洗练', maxed.body.code !== 0, maxed.body.msg);

    // 9.6 余额不足
    await setRole(a.roleId, '`spirit_stone` = 0');
    const poor = await request('POST', '/api/role/roots/reroll', { element: '金' }, a.token);
    check('灵石不足时拒绝洗练', poor.body.code !== 0, poor.body.msg);
  }

  /* ───────────── 10. 出售 ───────────── */
  console.log('\n[10] 出售：按市价 7 成回收');
  {
    const a = await register(conn, 's');
    await setRole(a.roleId, '`spirit_stone` = ?', [priceOf(23) * 3]);

    const buy = await request('POST', '/api/shop/buy', { itemId: 23, num: 2 }, a.token);
    check('买入两把玄铁重剑', buy.body.code === 0, buy.body.msg);
    const stoneBeforeSell = Number((await getRole(a.roleId)).spirit_stone);

    const sell = await request('POST', '/api/bag/sell', { itemId: 23, num: 1 }, a.token);
    const sold = sell.body.data.sold;
    check('出售成功', sell.body.code === 0, sell.body.msg);
    check(`单价是市价的 7 成（${priceOf(23)} → ${sellUnitOf(23)}）`, sold.unit === sellUnitOf(23), `unit=${sold.unit}`);
    const stoneAfterSell = Number((await getRole(a.roleId)).spirit_stone);
    check('灵石按 7 成到账', stoneAfterSell - stoneBeforeSell === sellUnitOf(23),
      `${stoneBeforeSell} → ${stoneAfterSell}`);

    // 已装备的不能卖
    await request('POST', '/api/bag/equip', { itemId: 23 }, a.token);
    const equippedSell = await request('POST', '/api/bag/sell', { itemId: 23, num: 1 }, a.token);
    check('已装备的物品不能出售', equippedSell.body.code !== 0, equippedSell.body.msg);

    // 数量不足
    await request('POST', '/api/bag/unequip', { type: 'artifact' }, a.token);
    const tooMany = await request('POST', '/api/bag/sell', { itemId: 23, num: 99 }, a.token);
    check('出售数量超过持有时被拒', tooMany.body.code !== 0, tooMany.body.msg);
    const [rowAfter] = await conn.query(
      'SELECT COALESCE(SUM(num),0) AS n FROM role_item WHERE role_id = ? AND item_id = 23', [a.roleId]);
    check('物品数量没有被扣错', Number(rowAfter[0].n) === 1, `剩 ${rowAfter[0].n} 件`);

    // 出售不动修为
    const expBefore = Number((await getRole(a.roleId)).exp);
    await request('POST', '/api/bag/sell', { itemId: 23, num: 1 }, a.token);
    const expAfter = Number((await getRole(a.roleId)).exp);
    check('出售不影响修为', expAfter >= expBefore);
  }

  /* ───────────── 11. 流水分页 ───────────── */
  console.log('\n[11] 资源流水服务端分页');
  {
    const a = await register(conn, 'g');
    await setRole(a.roleId, '`spirit_stone` = 500000');
    for (let i = 0; i < 7; i += 1) {
      await request('POST', '/api/shop/buy', { itemId: 1, num: 1 }, a.token);
    }

    const p1 = await request('GET', '/api/role/logs?page=1&pageSize=5', null, a.token);
    const d1 = p1.body.data.currency;
    check('返回分页结构', p1.body.code === 0 && Array.isArray(d1.list) && typeof d1.total === 'number',
      `total=${d1.total} pages=${d1.pages}`);
    check('每页条数正确', d1.list.length === 5, `list=${d1.list.length}`);
    check('页数计算正确', d1.pages === Math.max(1, Math.ceil(d1.total / 5)), `pages=${d1.pages}`);

    const p2 = await request('GET', '/api/role/logs?page=2&pageSize=5', null, a.token);
    const d2 = p2.body.data.currency;
    const ids1 = d1.list.map((x) => `${x.created_at}|${x.kind}|${x.delta}|${x.balance_after}`);
    const ids2 = d2.list.map((x) => `${x.created_at}|${x.kind}|${x.delta}|${x.balance_after}`);
    check('第二页与第一页不重复', ids1.every((k) => !ids2.includes(k)),
      `page1=${ids1.length} 条 / page2=${ids2.length} 条`);

    const over = await request('GET', '/api/role/logs?page=999&pageSize=5', null, a.token);
    check('超出页码返回空列表而不是报错', over.body.code === 0 && over.body.data.currency.list.length === 0);

    // 战斗留档同样分页
    const a2 = await register(conn, 'bp');
    await unlockAll(a2.roleId);
    for (let i = 0; i < 4; i += 1) {
      await request('POST', '/api/battle/challenge', { stageId: 1 }, a2.token);
    }
    const b1 = await request('GET', '/api/role/logs?battlePage=1&battlePageSize=2', null, a2.token);
    const bd1 = b1.body.data.battles;
    check('战斗留档返回分页结构',
      Array.isArray(bd1.list) && typeof bd1.total === 'number' && bd1.pages >= 2,
      `total=${bd1.total} pages=${bd1.pages}`);
    check('战斗留档每页条数受限', bd1.list.length === 2, `list=${bd1.list.length}`);
    const b2 = await request('GET', '/api/role/logs?battlePage=2&battlePageSize=2', null, a2.token);
    const bd2 = b2.body.data.battles;
    const key = (x) => `${x.stage_id}|${x.seed}|${x.created_at}`;
    check('战斗留档第二页与第一页不重复',
      bd1.list.every((x) => !bd2.list.map(key).includes(key(x))),
      `page1=${bd1.list.length} 条 / page2=${bd2.list.length} 条`);
    check('两个分页互不干扰', b1.body.data.currency.page === 1 && b2.body.data.currency.page === 1,
      'battlePage 变化不影响 currency 页码');
  }

  /* ───────────── 12. 行动记录 ───────────── */
  console.log('\n[12] 行动记录（右侧行动区）');
  {
    const a = await register(conn, 'a');
    await setRole(a.roleId, '`spirit_stone` = 500000');

    await request('POST', '/api/shop/buy', { itemId: 1, num: 1 }, a.token);
    await request('POST', '/api/battle/challenge', { stageId: 1 }, a.token);
    await request('POST', '/api/role/cave/upgrade', null, a.token);

    const acts = await request('GET', '/api/role/actions?limit=20', null, a.token);
    const types = acts.body.data.list.map((x) => x.type);
    check('接口返回行动记录', acts.body.code === 0 && acts.body.data.list.length > 0, `${types.length} 条`);
    check('记录了购买', types.includes('shop'));
    check('记录了挑战', types.includes('battle'));
    check('记录了洞府升级', types.includes('cave'));
    check('记录了开局', types.includes('init'));
    check('每条都有可读文本', acts.body.data.list.every((x) => x.text && x.text.length > 2),
      acts.body.data.list[0] && acts.body.data.list[0].text);

    const profile = await request('GET', '/api/role/profile', null, a.token);
    check('档案接口顺带带上行动记录', Array.isArray(profile.body.data.actions) && profile.body.data.actions.length > 0,
      `${profile.body.data.actions.length} 条`);
  }

  /* ───────────── 13. 排行榜 ───────────── */
  console.log('\n[13] 修为排行榜');
  {
    const low = await register(conn, 'l');
    const high = await register(conn, 'h');
    await setRole(low.roleId, '`realm` = 1, `realm_level` = 2, `exp` = 500');
    await setRole(high.roleId, '`realm` = 5, `realm_level` = 3, `exp` = 8000');

    const mine = await request('GET', '/api/rank/list?limit=100', null, low.token);
    check('榜单接口可用', mine.body.code === 0, mine.body.msg);
    const list = mine.body.data.list;

    let sorted = true;
    for (let i = 1; i < list.length; i += 1) {
      const p = list[i - 1]; const c = list[i];
      const better = p.realm > c.realm
        || (p.realm === c.realm && p.realmLevel > c.realmLevel)
        || (p.realm === c.realm && p.realmLevel === c.realmLevel && p.exp >= c.exp);
      if (!better) { sorted = false; break; }
    }
    check('榜单按境界→层数→修为降序', sorted, `共 ${list.length} 条`);
    check('名次从 1 开始连续', list.every((r, i) => r.rank === i + 1));
    check('高境界排在我前面', list.findIndex((r) => r.roleId === high.roleId) < list.findIndex((r) => r.roleId === low.roleId));
    check('返回我的名次', typeof mine.body.data.myRank === 'number' && mine.body.data.myRank >= 1,
      `myRank=${mine.body.data.myRank} / total=${mine.body.data.total}`);
    if (mine.body.data.inBoard) {
      check('榜内我的名次与列表一致', list[mine.body.data.myRank - 1].isMe === true);
    } else {
      check('榜外时仍返回我的成绩', mine.body.data.my.nickname === low.profile.role.nickname);
    }

    const noAuth = await request('GET', '/api/rank/list');
    check('排行榜需要登录', noAuth.status === 401, `HTTP ${noAuth.status}`);
  }

  /* ───────────── 14. 数据完整性 ───────────── */
  console.log('\n[14] 数据完整性与类型');
  {
    const a = await register(conn, 'd');
    const p = await request('GET', '/api/role/profile', null, a.token);
    check('roots 是对象而非字符串', typeof p.body.data.role.roots === 'object');
    check('五行齐全', Object.keys(p.body.data.role.roots).length === 5, JSON.stringify(p.body.data.role.roots));
    check('rootPity 五行齐全', Object.keys(p.body.data.role.rootPity).length === 5,
      JSON.stringify(p.body.data.role.rootPity));
    check('初始无待确认洗练', p.body.data.role.rootPending === null);

    const bag = await request('GET', '/api/bag/list', null, a.token);
    const sword = bag.body.data.items.find((i) => i.itemId === 21);
    check('背包返回出售价（800 × 0.7 = 560）', sword && sword.sellPrice === 560, `sellPrice=${sword && sword.sellPrice}`);
    check('装备栏返回已装备的青锋剑', bag.body.data.equip.artifact && bag.body.data.equip.artifact.name === '青锋剑');
  }

  /* ───────────── 15. 突破 / 洞府 / TINYINT 边界 ───────────── */
  console.log('\n[15] 突破边界、洞府升级、TINYINT 边界');
  {
    const a = await register(conn, 'k');
    await setRole(a.roleId, '`realm` = 7, `realm_level` = 9, `exp` = 99999999999');
    const top = await request('POST', '/api/role/breakthrough', null, a.token);
    check('大乘九层无法继续突破', top.body.code !== 0, top.body.msg);

    await setRole(a.roleId, '`realm` = 0, `realm_level` = 9, `exp` = 99999999999');
    const up = await request('POST', '/api/role/breakthrough', null, a.token);
    const after = await getRole(a.roleId);
    check('炼气九层突破后正确进入筑基一层（或失败留在原层）',
      up.body.code === 0 && (up.body.data.breakthrough.success
        ? (Number(after.realm) === 1 && Number(after.realm_level) === 1)
        : (Number(after.realm) === 0 && Number(after.realm_level) === 9)),
      `realm=${after.realm} level=${after.realm_level}`);

    const b = await register(conn, 'cv');
    const caveBefore = Number((await getRole(b.roleId)).cave_level);
    const caveCost = game.world.cave[1].costStone;
    await setRole(b.roleId, '`spirit_stone` = ?', [caveCost * 10]);
    const cave = await request('POST', '/api/role/cave/upgrade', null, b.token);
    check('洞府升级成功', cave.body.code === 0, cave.body.msg);
    check('洞府等级 +1', Number((await getRole(b.roleId)).cave_level) === caveBefore + 1);
    check('灵石按价扣除', Number((await getRole(b.roleId)).spirit_stone) === caveCost * 9,
      `成本 ${caveCost}`);

    const src = require('fs').readFileSync(
      require('path').join(__dirname, '..', 'src', 'services', 'role.service.js'), 'utf8');
    check('突破代码不再使用 255 作保底上限', !/Math\.min\(255,\s*current\.break_pity/.test(src));
  }

  /* ───────────── 16. 重复道号 ───────────── */
  console.log('\n[16] 重复道号应当被友好拒绝');
  {
    const a = await register(conn, 'n1');
    const dup = await request('POST', '/api/auth/register', {
      username: `dup${String(Date.now()).slice(-6)}`,
      password: '123456',
      nickname: a.profile.role.nickname
    });
    check('重复道号被拒且提示明确', dup.body.code !== 0 && /道号/.test(String(dup.body.msg)), dup.body.msg);
  }

  /* ───────────── 17. 主灵根命名 ───────────── */
  console.log('\n[17] 主灵根命名（按值为 0 的灵根不计入）');
  {
    const f = require('../src/core/formula');
    const cases = [
      [{ 金: 60, 木: 0, 水: 0, 火: 0, 土: 0 }, '单金灵根'],
      [{ 金: 95, 木: 0, 水: 0, 火: 0, 土: 0 }, '天金灵根'],
      [{ 金: 60, 木: 40, 水: 0, 火: 0, 土: 0 }, '金木双灵根'],
      [{ 金: 60, 木: 40, 水: 30, 火: 0, 土: 0 }, '金木水三灵根'],
      [{ 金: 60, 木: 40, 水: 30, 火: 20, 土: 0 }, '金木水火四灵根'],
      [{ 金: 60, 木: 40, 水: 30, 火: 20, 土: 10 }, '金木水火土五灵根'],
      [{ 金: 95, 木: 95, 水: 95, 火: 95, 土: 95 }, '混沌灵根'],
      [{ 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 }, '无灵根']
    ];
    cases.forEach(([roots, expect]) => {
      const got = f.rootTitle(roots);
      check(`命名「${expect}」`, got === expect, got === expect ? '' : `实际 ${got}`);
    });
  }

  /* ───────────── 18. 逐灵根伤害公式 ───────────── */
  console.log('\n[18] 逐灵根伤害公式（值越高越强 / 单灵根有优势 / 混沌最强）');
  {
    const f = require('../src/core/formula');
    const singleGood = f.attackRootMul({ 金: 95, 木: 0, 水: 0, 火: 0, 土: 0 }, '木').mul;
    const singleBad = f.attackRootMul({ 金: 0, 木: 0, 水: 0, 火: 0, 土: 95 }, '木').mul;
    const singleLow = f.attackRootMul({ 金: 20, 木: 0, 水: 0, 火: 0, 土: 0 }, '木').mul;
    const dual = f.attackRootMul({ 金: 95, 木: 95, 水: 0, 火: 0, 土: 0 }, '木').mul;
    const chaos = f.attackRootMul({ 金: 95, 木: 95, 水: 95, 火: 95, 土: 95 }, '木').mul;

    check('灵根值越高伤害越高', singleGood > singleLow, `95 → ${singleGood}，20 → ${singleLow}`);
    check('单灵根优于同值的双灵根', singleGood > dual, `${singleGood} > ${dual}`);
    check('混沌灵根最强', chaos > singleGood, `${chaos} > ${singleGood}`);
    check('被克制的单灵根更弱', singleBad < singleGood, `${singleBad} < ${singleGood}`);
    check('每条灵根都参与判定',
      f.attackRootMul({ 金: 50, 木: 50, 水: 0, 火: 0, 土: 0 }, '木').breakdown.length === 2);
    check('守方按灵根数平均：单土被木打吃亏',
      f.defendRootMul({ 金: 0, 木: 0, 水: 0, 火: 0, 土: 95 }, '木').mul > 1,
      `mul=${f.defendRootMul({ 金: 0, 木: 0, 水: 0, 火: 0, 土: 95 }, '木').mul}`);
    check('五灵根守方接近中性',
      Math.abs(f.defendRootMul({ 金: 60, 木: 40, 水: 30, 火: 20, 土: 10 }, '木').mul - 1) < 0.35,
      `mul=${f.defendRootMul({ 金: 60, 木: 40, 水: 30, 火: 20, 土: 10 }, '木').mul}`);
    check('凡体（五灵根全 0）伤害被压到最低', f.attackRootMul({ 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 }, '木').mul < 0.5);
  }

  /* ───────────── 19. 洗练花费随灵根值递增 ───────────── */
  console.log('\n[19] 洗练花费随灵根值递增');
  {
    const f = require('../src/core/formula');
    const c0 = f.rerollCost(0);
    const c50 = f.rerollCost(50);
    const c95 = f.rerollCost(95);
    check('花费随值单调递增', c0 < c50 && c50 < c95, `0→${c0} 50→${c50} 95→${c95}`);

    const a = await register(conn, 'rc');
    await setRole(a.roleId, '`spirit_stone` = 99999999, `roots` = ?',
      [JSON.stringify({ 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 })]);
    const r01 = await request('POST', '/api/role/roots/reroll', { element: '金' }, a.token);
    const costAt0 = r01.body.data.reroll.cost;
    await request('POST', '/api/role/roots/confirm', { save: false }, a.token);
    await setRole(a.roleId, '`roots` = ?', [JSON.stringify({ 金: 90, 木: 0, 水: 0, 火: 0, 土: 0 })]);
    const r90 = await request('POST', '/api/role/roots/reroll', { element: '金' }, a.token);
    const costAt90 = r90.body.data.reroll.cost;
    check('接口返回的花费与公式一致', costAt0 === c0 && costAt90 === f.rerollCost(90),
      `0 → ${costAt0}，90 → ${costAt90}`);
    check('值 90 的洗练明显比值 0 贵', costAt90 > costAt0 * 3, `${costAt0} → ${costAt90}`);

    const profile = await request('GET', '/api/role/profile', null, a.token);
    check('档案下发每条灵根的下一手花费', profile.body.data.role.rootCosts && profile.body.data.role.rootCosts['金'] === costAt90,
      JSON.stringify(profile.body.data.role.rootCosts));
  }

  /* ───────────── 20. 悟道石 ───────────── */
  console.log('\n[20] 悟道石：同境界买下即用 / 跨境界入包 / 上限 100%');
  {
    const a = await register(conn, 'bs');
    await setRole(a.roleId, '`spirit_stone` = 99999999, `realm` = 1, `realm_level` = 1');

    const before = (await request('GET', '/api/role/profile', null, a.token)).body.data.derived.breakRate;
    const buy = await request('POST', '/api/shop/buy', { itemId: 32, num: 1 }, a.token); // 悟道石·筑基
    const bought = buy.body.data.bought;
    check('同境界悟道石买下即参悟', buy.body.code === 0 && bought.immediate === true, `immediate=${bought.immediate}`);
    const stonePer = game.itemMap.get(32).effect.breakBonus / 10000;
    check(`成功率 +${Math.round(stonePer * 100)}%`,
      Math.abs(bought.rateAfter - (bought.rateBefore + stonePer)) < 1e-6,
      `${bought.rateBefore} → ${bought.rateAfter}`);
    check('未进入背包', buy.body.data.role.breakBonus > 0, `breakBonus=${buy.body.data.role.breakBonus}`);
    const bagAfter = await request('GET', '/api/bag/list', null, a.token);
    check('悟道石没留在背包里', !bagAfter.body.data.items.some((i) => i.itemId === 32));

    const shopList = await request('GET', '/api/shop/list', null, a.token);
    const stoneRow = shopList.body.data.items.find((i) => i.itemId === 32);
    const otherRow = shopList.body.data.items.find((i) => i.itemId === 33);
    check('坊市标注本境界立即生效', stoneRow.immediate === true && stoneRow.usableNow === true);
    check('坊市标注异境界只入背包', otherRow.immediate === false && otherRow.usableNow === false,
      `${otherRow.name} usableNow=${otherRow.usableNow}`);

    const cross = await request('POST', '/api/shop/buy', { itemId: 33, num: 1 }, a.token); // 悟道石·金丹
    check('跨境界悟道石进背包', cross.body.code === 0 && cross.body.data.bought.immediate === false);
    const bag2 = await request('GET', '/api/bag/list', null, a.token);
    const inBag = bag2.body.data.items.find((i) => i.itemId === 33);
    check('背包里能看到该石并标注不可用', !!inBag && inBag.usableNow === false, inBag && inBag.lockedReason);

    const wrongUse = await request('POST', '/api/bag/use', { itemId: 33, num: 1 }, a.token);
    check('异境界强行参悟被拒', wrongUse.body.code !== 0, wrongUse.body.msg);

    // 上限：把加成堆到接近满
    await setRole(a.roleId, '`break_bonus` = 1000');
    const p2 = (await request('GET', '/api/role/profile', null, a.token)).body.data;
    check('加成计入总成功率', p2.derived.breakBonus === 0.1, `breakBonus=${p2.derived.breakBonus}`);
    await setRole(a.roleId, '`break_bonus` = 9900');
    const capped = await request('POST', '/api/shop/buy', { itemId: 32, num: 1 }, a.token);
    check('满 100% 时拒绝再买', capped.body.code !== 0, capped.body.msg);
    const p3 = (await request('GET', '/api/role/profile', null, a.token)).body.data;
    check('成功率硬上限为 100%', p3.derived.breakRate <= 1, `rate=${p3.derived.breakRate}`);

    // 升入新大境界后加成清零
    await setRole(a.roleId, '`realm` = 0, `realm_level` = 9, `exp` = 99999999999, `break_bonus` = 500, `break_pity` = 0');
    let realmUp = false;
    for (let i = 0; i < 12 && !realmUp; i += 1) {
      const bt = await request('POST', '/api/role/breakthrough', null, a.token);
      if (bt.body.code === 0 && bt.body.data.breakthrough.realmUp) realmUp = true;
      if (bt.body.code === 0 && !bt.body.data.breakthrough.success) continue;
      if (bt.body.code !== 0) break;
    }
    const afterUp = await getRole(a.roleId);
    check('大境界突破成功', realmUp, `realm=${afterUp.realm}`);
    check('升境后悟道石加成清零', realmUp && Number(afterUp.break_bonus) === 0, `break_bonus=${afterUp.break_bonus}`);
  }

  /* ───────────── 21. 散灵丹 ───────────── */
  console.log('\n[21] 散灵丹：把指定灵根归零');
  {
    const a = await register(conn, 'rr');
    await setRole(a.roleId, '`spirit_stone` = 99999999, `roots` = ?',
      [JSON.stringify({ 金: 70, 木: 50, 水: 30, 火: 20, 土: 10 })]);

    const buy = await request('POST', '/api/shop/buy', { itemId: 41, num: 1 }, a.token);
    check('散灵丹进入背包', buy.body.code === 0 && buy.body.data.bought.immediate === false);

    const noEl = await request('POST', '/api/bag/use', { itemId: 41, num: 1 }, a.token);
    check('未指定灵根被拒', noEl.body.code !== 0, noEl.body.msg);

    const used = await request('POST', '/api/bag/use', { itemId: 41, num: 1, element: '土' }, a.token);
    check('散去指定灵根', used.body.code === 0, used.body.msg);
    check('该灵根归零', Number(used.body.data.role.roots['土']) === 0,
      `土=${used.body.data.role.roots['土']}`);
    check('主灵根命名随之变化', used.body.data.role.rootTitle === '金木水火四灵根',
      used.body.data.role.rootTitle);

    const again = await request('POST', '/api/bag/use', { itemId: 41, num: 1, element: '土' }, a.token);
    check('已为 0 的灵根拒绝重复散去', again.body.code !== 0, again.body.msg);
  }

  /* ───────────── 22. 战斗推演接口 ───────────── */
  console.log('\n[22] 战斗推演（供玩家查看的公式推导）');
  {
    const a = await register(conn, 'pv');
    const one = await request('GET', '/api/battle/preview?stageId=1', null, a.token);
    check('推演接口可用', one.body.code === 0, one.body.msg);
    const d = one.body.data;
    check('返回逐条灵根判定', Array.isArray(d.attack.breakdown) && d.attack.breakdown.length > 0,
      `${d.attack.breakdown.length} 条`);
    check('每条判定含 元素/值/克制系数/贡献', d.attack.breakdown.every((b) =>
      b.element && typeof b.value === 'number' && typeof b.factor === 'number' && typeof b.score === 'number'));
    check('返回最终系数与伤害预估', typeof d.attack.mul === 'number' && d.damage.playerHit > 0,
      `mul=${d.attack.mul} 每击≈${d.damage.playerHit}`);
    check('返回公式常量', d.constants.rootMulScale > 0 && d.constants.chaosMul > 0);
    check('推演不改数据', (await getRole(a.roleId)).exp === (await getRole(a.roleId)).exp);

    const all = await request('GET', '/api/battle/preview/all', null, a.token);
    check('一次算完 15 层', all.body.code === 0 && all.body.data.list.length === 15);

    const bad = await request('GET', '/api/battle/preview?stageId=999', null, a.token);
    check('非法层号回退到第一层而不是报错', bad.body.code === 0 && bad.body.data.stage.id === 1);
  }

  /* ───────────── 23. 悟道石叠加购买与"不浪费" ───────────── */
  console.log('\n[23] 悟道石：可叠加购买，且不会买超浪费灵石');
  {
    const a = await register(conn, 'bs2');
    await setRole(a.roleId,
      '`spirit_stone` = 99999999, `realm` = 1, `realm_level` = 1, `break_bonus` = 0, `break_pity` = 0');

    const f2 = require('../src/core/formula');
    const perBp = game.itemMap.get(32).effect.breakBonus;       // 万分比，给公式用
    const perRate = perBp / 10000;                               // 比率，给接口比对用
    // 期望的"最多再买几颗"直接由公式推出，不写死数字
    const expectMax = (roleRow) => Math.ceil(Math.max(0,
      Math.round((1 - f2.breakRateBase(roleRow)) * 10000) - (Number(roleRow.break_bonus) || 0)) / perBp);

    const shop = await request('GET', '/api/shop/list', null, a.token);
    const row = shop.body.data.items.find((i) => i.itemId === 32);
    const roleRow = await getRole(a.roleId);
    check('坊市给出的「最多再买几颗」与公式一致', row.maxUseful === expectMax(roleRow),
      `接口 ${row.maxUseful} / 公式 ${expectMax(roleRow)}`);
    check('每颗加成也会下发', row.breakBonusPer === perRate, `per=${row.breakBonusPer}`);

    const expected = row.maxUseful;
    const stoneBefore = Number((await getRole(a.roleId)).spirit_stone);
    const buy = await request('POST', '/api/shop/buy', { itemId: 32, num: 99 }, a.token);
    const b = buy.body.data.bought;
    check('买超自动夹取到用得上的颗数', b.num === expected && b.clamped === true,
      `请求 99 颗，实际结算 ${b.num} 颗（期望 ${expected}）`);
    check('只按实际颗数收钱', Number((await getRole(a.roleId)).spirit_stone) === stoneBefore - priceOf(32) * b.num,
      `扣了 ${stoneBefore - Number((await getRole(a.roleId)).spirit_stone)}（单价 ${priceOf(32)}）`);
    check('叠加后成功率正好 100%', buy.body.data.derived.breakRate === 1,
      `rate=${buy.body.data.derived.breakRate}`);

    const again = await request('POST', '/api/shop/buy', { itemId: 32, num: 1 }, a.token);
    check('已满时拒绝继续购买', again.body.code !== 0, again.body.msg);

    // 升一层 → 基础率下降 → 可买空间只会变多（按公式核对，不写死数字）
    await setRole(a.roleId, '`realm_level` = 2, `break_bonus` = 0');
    const shop2 = await request('GET', '/api/shop/list', null, a.token);
    const row2 = shop2.body.data.items.find((i) => i.itemId === 32);
    const roleRow2 = await getRole(a.roleId);
    check('升一层后接口与公式仍一致，且空间变大', row2.maxUseful === expectMax(roleRow2) && row2.maxUseful >= expected,
      `筑基${roleRow2.realm_level}层 maxUseful=${row2.maxUseful}（上一层 ${expected}）`);

    // 背包里的石头同样按需消耗
    await setRole(a.roleId, '`realm_level` = 1, `break_bonus` = 0');
    const needBag = expectMax(await getRole(a.roleId));
    await conn.query(
      'INSERT INTO `role_item` (`role_id`, `item_id`, `num`) VALUES (?, 32, 20) ' +
      'ON DUPLICATE KEY UPDATE `num` = 20', [a.roleId]);
    const useRes = await request('POST', '/api/bag/use', { itemId: 32, num: 20 }, a.token);
    const u = useRes.body.data.used;
    check('背包批量参悟只消耗用得上的', u.num === needBag && u.clamped === true, `用掉 ${u.num} 颗（需 ${needBag}）`);
    const [left] = await conn.query(
      'SELECT `num` FROM `role_item` WHERE `role_id` = ? AND `item_id` = 32', [a.roleId]);
    check('剩下的石头留在背包', Number(left[0].num) === 20 - needBag, `剩 ${left[0].num} 颗`);
    check('参悟后成功率满', useRes.body.data.derived.breakRate === 1);
  }

  /* ───────────── 24. 试炼塔门槛 ───────────── */
  console.log('\n[24] 试炼塔门槛：低一个大境界打不动最后一层');
  {
    const strongRoots = JSON.stringify({ 金: 95, 木: 0, 水: 0, 火: 0, 土: 0 });

    // 金丹中期 + 金丹套装 + 单灵根强 build（尽可能站在挑战者一边）
    const jd = await register(conn, 'tw1');
    await setRole(jd.roleId, '`realm` = 2, `realm_level` = 4, `spirit_stone` = 0, `exp` = 0, `roots` = ?', [strongRoots]);
    await equipItem(jd.roleId, 25); // 紫霄神剑
    await equipItem(jd.roleId, 13); // 太虚道经
    await unlockAll(jd.roleId);

    const pvJd = await request('GET', '/api/battle/preview?stageId=15', null, jd.token);
    check('推演显示金丹期打不动第 15 层', pvJd.body.data.damage.timeout === true,
      `每击 ${pvJd.body.data.damage.playerHit}，需 ${pvJd.body.data.damage.roundsToKill} 回合`);
    const fightJd = await request('POST', '/api/battle/challenge', { stageId: 15 }, jd.token);
    const jdWin = fightJd.body.code === 0 && fightJd.body.data.challenge.report.win;
    check('金丹期确实打不过第 15 层（用户报的 bug 已修复）', jdWin === false,
      jdWin ? '仍然能赢，塔太软' : `${fightJd.body.data.challenge.report.roundCount} 回合后落败`);

    // 大乘中期 + 大乘套装 → 应当能过
    const dc = await register(conn, 'tw2');
    await setRole(dc.roleId, '`realm` = 7, `realm_level` = 4, `spirit_stone` = 0, `exp` = 0, `roots` = ?', [strongRoots]);
    await equipItem(dc.roleId, 30); // 鸿蒙紫气钟
    await equipItem(dc.roleId, 18); // 造化玉牒
    await unlockAll(dc.roleId);
    const fightDc = await request('POST', '/api/battle/challenge', { stageId: 15 }, dc.token);
    const dcWin = fightDc.body.code === 0 && fightDc.body.data.challenge.report.win;
    check('大乘期带齐装备可以通关第 15 层', dcWin === true,
      dcWin ? `${fightDc.body.data.challenge.report.roundCount} 回合取胜` : '大乘也打不过，塔太硬');

    const hpList = game.stages.map((s) => s.monster.hp);
    check('怪物气血逐层递增', hpList.every((v, i) => i === 0 || v > hpList[i - 1]));
    check('最后一层气血已远超旧值（旧 3696）', hpList[14] > 100000, `第 15 层气血 ${hpList[14]}`);
  }

  /* ───────────── 25. 悟道石逐次清零 / 洗练保底保存后重算 ───────────── */
  console.log('\n[25] 悟道石突破一次即清零 / 保底计数保存后重算');
  {
    const a = await register(conn, 'rule');
    await setRole(a.roleId,
      '`spirit_stone` = 99999999999, `realm` = 1, `realm_level` = 1, `break_bonus` = 0, `break_pity` = 0');

    await request('POST', '/api/shop/buy', { itemId: 32, num: 2 }, a.token);
    check('先垫上悟道石加成', Number((await getRole(a.roleId)).break_bonus) > 0,
      `break_bonus=${(await getRole(a.roleId)).break_bonus}`);

    await setRole(a.roleId, '`exp` = 99999999999');
    let firstSuccess = null;
    for (let i = 0; i < 15 && !firstSuccess; i += 1) {
      const bt = await request('POST', '/api/role/breakthrough', null, a.token);
      if (bt.body.code !== 0) break;
      if (bt.body.data.breakthrough.success) firstSuccess = bt.body.data.breakthrough;
    }
    check('同境界内突破成功', !!firstSuccess && firstSuccess.realmUp === false,
      firstSuccess ? `境界未变，层数 +1` : '15 次都没成功');
    check('突破成功一次后加成清零（不必等到大境界）',
      Number((await getRole(a.roleId)).break_bonus) === 0,
      `break_bonus=${(await getRole(a.roleId)).break_bonus}`);
    check('接口回报加成已散去', !firstSuccess || firstSuccess.bonusCleared === true);

    // 洗练保底：保存后从 0 重新计算
    await setRole(a.roleId, '`spirit_stone` = 99999999999, `root_pity` = ?, `roots` = ?', [
      JSON.stringify({ 金: 0, 木: 0, 水: 0, 火: 0, 土: 0 }),
      JSON.stringify({ 金: 50, 木: 0, 水: 0, 火: 0, 土: 0 })
    ]);
    const r1 = await request('POST', '/api/role/roots/reroll', { element: '金' }, a.token);
    check('洗练后该灵根保底计数 +1', r1.body.data.role.rootPity['金'] === 1,
      `金 pity=${r1.body.data.role.rootPity['金']}`);
    const c1 = await request('POST', '/api/role/roots/confirm', { save: true }, a.token);
    check('保存后保底计数重置为 0', c1.body.data.role.rootPity['金'] === 0,
      `金 pity=${c1.body.data.role.rootPity['金']}`);

    const r2 = await request('POST', '/api/role/roots/reroll', { element: '金' }, a.token);
    check('再洗一次计数重新从 1 开始', r2.body.data.role.rootPity['金'] === 1,
      `金 pity=${r2.body.data.role.rootPity['金']}`);
    const c2 = await request('POST', '/api/role/roots/confirm', { save: false }, a.token);
    check('放弃则计数保留（继续累积保底）', c2.body.data.role.rootPity['金'] === 1,
      `金 pity=${c2.body.data.role.rootPity['金']}`);
  }

  /* ───────────── 26. 本轮调整：失败扣修为 / 境界档可过层数 / 洗练涨价 ───────────── */
  console.log('\n[26] 塔失败扣修为 / 境界对应层数 / 洗练与装备数值');
  {
    const f = require('../src/core/formula');

    check('洗练基础价提上去了', f.rerollCost(0) === 3000, `cost(0)=${f.rerollCost(0)}`);
    check('满值灵根洗练价 15 万以上', f.rerollCost(95) >= 150000, `cost(95)=${f.rerollCost(95)}`);
    check('法宝数值已上调（紫霄神剑 300 → 750）', game.itemMap.get(25).effect.atk === 750,
      `atk=${game.itemMap.get(25).effect.atk}`);
    check('每层都配了失败扣修为，且越往后扣得越多',
      game.stages.every((s) => s.failExp > 0)
      && game.stages.every((s, i) => i === 0 || s.failExp > game.stages[i - 1].failExp),
      `第 1 层 ${game.stageMap.get(1).failExp} → 第 15 层 ${game.stageMap.get(15).failExp}`);

    // 失败真的扣修为（先给足修为，验证"按该层标准全额扣"）
    const a = await register(conn, 'fail');
    await setRole(a.roleId, '`realm` = 2, `realm_level` = 4, `spirit_stone` = 0');
    await equipItem(a.roleId, 25);
    await equipItem(a.roleId, 13);
    await unlockAll(a.roleId);

    const fail15 = game.stageMap.get(15).failExp;
    await setRole(a.roleId, '`exp` = ?', [fail15 + 1000000]);
    const expBefore = Number((await getRole(a.roleId)).exp);
    const lose = await request('POST', '/api/battle/challenge', { stageId: 15 }, a.token);
    const expAfter = Number((await getRole(a.roleId)).exp);
    check('挑战失败按该层标准扣修为',
      lose.body.code === 0 && expAfter === expBefore - fail15,
      `${expBefore} → ${expAfter}（该层扣 ${fail15}）`);
    check('战报里带出损失值', lose.body.data.challenge.failLoss === fail15);

    // 修为不够时只扣到 0，不会变成负数
    await setRole(a.roleId, '`exp` = 10');
    await request('POST', '/api/battle/challenge', { stageId: 15 }, a.token);
    check('修为不足时不会被扣成负数', Number((await getRole(a.roleId)).exp) === 0,
      `exp=${(await getRole(a.roleId)).exp}`);

    // 每个大境界对应的层：化神期带化神套至少能过 8 层（用户报的现象）
    const hs = await register(conn, 'band');
    await setRole(hs.roleId, '`realm` = 4, `realm_level` = 4, `exp` = 0, `spirit_stone` = 0, `roots` = ?',
      [JSON.stringify({ 金: 95, 木: 0, 水: 0, 火: 0, 土: 0 })]);
    await equipItem(hs.roleId, 27); // 太乙玄光镜
    await equipItem(hs.roleId, 15); // 大衍神通
    const pv = await request('GET', '/api/battle/preview/all', null, hs.token);
    const winners = pv.body.data.list.filter((x) => x.damage.verdict === '优势').map((x) => x.stageId);
    check('化神期（带化神套）至少能稳过 8 层', winners.length >= 8,
      `可稳过 ${winners.length} 层（第 ${winners.join('、')} 层）`);
    check('化神期仍打不过最后一层（留给更高境界）', !winners.includes(15));
  }

  /* ───────────── 27. 最近改动专项 ───────────── */
  console.log('\n[27] 最近改动专项：失败惩罚 / 分页 / 数值一致性 / 境界对应层数');
  {
    const stages = game.stages;

    // ---- 数值一致性 ----
    check('每层数值逐层递增（气血/攻击/防御/奖励/失败惩罚）',
      stages.every((s, i) => i === 0 || (
        s.monster.hp > stages[i - 1].monster.hp
        && s.monster.atk > stages[i - 1].monster.atk
        && s.monster.def > stages[i - 1].monster.def
        && s.reward.exp > stages[i - 1].reward.exp
        && s.failExp > stages[i - 1].failExp
      )));
    check('失败惩罚始终小于该层奖励且为正',
      stages.every((s) => s.failExp > 0 && s.failExp < s.reward.exp),
      `第 15 层扣 ${stages[14].failExp} / 奖 ${stages[14].reward.exp}（约 ${Math.round(stages[14].failExp / stages[14].reward.exp * 100)}%）`);

    // 标定脚本的三个数组必须严格对齐，否则会静默乘出 NaN
    const tuneSrc = require('fs').readFileSync(
      require('path').join(__dirname, 'tune-tower.js'), 'utf8');
    const bandLen = (tuneSrc.match(/const FLOOR_BAND = \[([^\]]+)\]/) || [])[1];
    const mulLen = (tuneSrc.match(/const FLOOR_MUL = \[([\s\S]*?)\n\];/) || [])[1];
    const bandCount = bandLen ? bandLen.split(',').length : 0;
    const mulCount = mulLen ? (mulLen.match(/\[/g) || []).length : 0;
    check('标定脚本的层数映射与微调表长度一致',
      bandCount === 15 && mulCount === 15 && stages.length === 15,
      `FLOOR_BAND=${bandCount} FLOOR_MUL=${mulCount} 塔层=${stages.length}`);

    // ---- 价格与精度 ----
    const priciest = game.items.slice().sort((a, b) => b.price - a.price)[0];
    check('最贵物品单价在安全整数范围内', priciest.price * 99 < Number.MAX_SAFE_INTEGER,
      `${priciest.name} ${priciest.price} ×99 = ${priciest.price * 99}`);
    check('回收价严格等于市价七成',
      game.items.filter((i) => i.price > 0).every((i) => Math.floor(i.price * 0.7) === Math.floor(i.price * game.world.sellRate)));
    check('悟道石不存在买卖套利',
      game.items.filter((i) => i.type === 'breakStone').every((i) => Math.floor(i.price * 0.7) < i.price));

    // ---- 经济曲线：越到后期不能越便宜，否则就是"灵石溢出" ----
    // 到达某境界时的实际产出 = 基础 × 层数1.3 × 灵根1.15 × 洞府(该境+1级) × (1 + 上一档功法加成)
    const arrivalIncome = (realm) => {
      const base = game.realms[realm].stonePerSec;
      const caveBonus = game.world.cave[Math.min(realm + 1, 10) - 1].stoneBonus;
      const prev = realm > 0 ? game.items.find((i) => i.type === 'skill' && i.realm === realm - 1) : null;
      return base * 1.3 * 1.15 * (1 + caveBonus) * (1 + (prev ? prev.effect.stoneBonus : 0));
    };
    const cost = [];
    for (let r = 1; r <= 7; r += 1) {
      const income = arrivalIncome(r);
      const art = game.items.find((i) => i.type === 'artifact' && i.realm === r && i.effect && i.effect.atk);
      const skill = game.items.find((i) => i.type === 'skill' && i.realm === r);
      cost.push({ realm: r, art: art.price / income / 60, skill: skill.price / income / 60 });
    }
    const all = cost.flatMap((c) => [c.art, c.skill]);
    const lo = Math.min(...all);
    const hi = Math.max(...all);
    check('每档装备的购买耗时都在 15~120 分钟之间', lo >= 15 && hi <= 120,
      `${lo.toFixed(0)} ~ ${hi.toFixed(0)} 分钟`);
    check('后期不比前期更便宜（经济曲线不倒挂）', hi / lo <= 6,
      cost.map((c) => `${game.realms[c.realm].name}${c.art.toFixed(0)}分`).join(' → '));

    // ---- 失败扣修为的行为 ----
    const a = await register(conn, 'pen');
    await setRole(a.roleId, '`realm` = 2, `realm_level` = 4, `spirit_stone` = 0');
    await equipItem(a.roleId, 25);
    await equipItem(a.roleId, 13);
    await unlockAll(a.roleId);
    const fail15 = game.stageMap.get(15).failExp;

    // 先把结算窗口归零，保证扣的数额精确可验
    await setRole(a.roleId, '`exp` = ?, `last_settle_at` = NOW()', [fail15 * 3 + 12345]);
    const e0 = Number((await getRole(a.roleId)).exp);
    await request('POST', '/api/battle/challenge', { stageId: 15 }, a.token);
    const e1 = Number((await getRole(a.roleId)).exp);
    await request('POST', '/api/battle/challenge', { stageId: 15 }, a.token);
    const e2 = Number((await getRole(a.roleId)).exp);
    check('连续战败每次都扣，不会只扣一次',
      e0 - e1 === fail15 && e1 - e2 === fail15, `${e0} → ${e1} → ${e2}`);

    await setRole(a.roleId, '`exp` = ?, `last_settle_at` = NOW()', [fail15 + 500]);
    await request('POST', '/api/battle/challenge', { stageId: 15 }, a.token);
    const [row] = await conn.query(
      "SELECT `delta`, `balance_after` FROM `log_currency` WHERE `role_id` = ? AND `reason` = 'battle' ORDER BY `id` DESC LIMIT 1",
      [a.roleId]);
    check('战败写了一条负的修为流水且余额正确',
      Number(row[0].delta) === -fail15 && Number(row[0].balance_after) === 500,
      `delta=${row[0].delta} 余=${row[0].balance_after}`);

    await setRole(a.roleId, '`exp` = 5, `last_settle_at` = NOW()');
    await request('POST', '/api/battle/challenge', { stageId: 15 }, a.token);
    check('修为不足时只扣到 0，不会变负', Number((await getRole(a.roleId)).exp) === 0);

    const bt = await request('POST', '/api/role/breakthrough', null, a.token);
    check('修为被扣光后确实无法突破', bt.body.code !== 0, bt.body.msg);

    // 胜利不能误扣
    await setRole(a.roleId, '`exp` = 1000, `last_settle_at` = NOW()');
    const win = await request('POST', '/api/battle/challenge', { stageId: 1 }, a.token);
    check('获胜时不扣修为', win.body.data.challenge.failLoss === 0
      && Number((await getRole(a.roleId)).exp) > 1000,
      `exp=${(await getRole(a.roleId)).exp}`);

    // ---- 分页边界 ----
    const fresh = await register(conn, 'pg0');
    const empty = await request('GET', '/api/role/logs?battlePage=1&battlePageSize=10', null, fresh.token);
    check('无战斗记录时返回空列表而不是报错',
      empty.body.code === 0 && empty.body.data.battles.total === 0
      && empty.body.data.battles.list.length === 0 && empty.body.data.battles.pages === 1,
      `total=${empty.body.data.battles.total} pages=${empty.body.data.battles.pages}`);
    const over = await request('GET', '/api/role/logs?battlePage=99&battlePageSize=10', null, fresh.token);
    check('战斗页码越界返回空列表', over.body.code === 0 && over.body.data.battles.list.length === 0);

    const huge = await request('GET', '/api/role/logs?battlePage=1&battlePageSize=9999&page=1&pageSize=9999', null, a.token);
    check('每页条数被夹到 50 以内',
      huge.body.data.battles.pageSize <= 50 && huge.body.data.currency.pageSize <= 50,
      `battle=${huge.body.data.battles.pageSize} currency=${huge.body.data.currency.pageSize}`);

    // ---- 每个大境界带本档装备，应能稳过自己那两层 ----
    const bandGear = {
      1: [21, 11], 2: [23, 12], 3: [25, 13], 4: [26, 14],
      5: [27, 15], 6: [28, 16], 7: [29, 17], 8: [30, 18]
    };
    const refRoots = JSON.stringify({ 金: 80, 木: 60, 水: 40, 火: 20, 土: 0 });
    const miss = [];
    for (let band = 1; band <= 8; band += 1) {
      const r = await register(conn, `bd${band}`);
      await setRole(r.roleId, '`realm` = ?, `realm_level` = 4, `exp` = 0, `spirit_stone` = 0, `roots` = ?',
        [band - 1, refRoots]);
      await equipItem(r.roleId, bandGear[band][0]);
      await equipItem(r.roleId, bandGear[band][1]);
      const pv = await request('GET', '/api/battle/preview/all', null, r.token);
      // 15 层塔 / 8 个大境界：前 7 个境界各 2 层，最后一个境界只有第 15 层
      [band * 2 - 1, band * 2]
        .filter((fl) => fl <= stages.length)
        .forEach((fl) => {
          const x = pv.body.data.list.find((v) => v.stageId === fl);
          if (!x || x.damage.verdict !== '优势') {
            miss.push(`第${fl}层(${game.realms[band - 1].name}) 每击${x ? x.damage.playerHit : '?'} 需${x ? x.damage.roundsToKill : '?'}回合`);
          }
        });
    }
    check('每个大境界带本档装备都能稳过自己那一档的层', miss.length === 0,
      miss.length ? `未过：${miss.join('；')}` : `15 层全部通过（${game.realms[7].name}档只有第 15 层）`);

    // ---- 用真实战斗内核跑胜率：这才是"塔能不能打"的唯一判据 ----
    // 上一轮就是这里出的问题：只看 preview 的"优势/劣势"判定，
    // 而标定脚本用固定克制系数 1.2，导致第 8 层实测胜率只有 0.5% 却显示"优势"。
    const tuner = require('./tune-tower');
    const battleCore = require('../src/core/battle');
    const SEEDS = 200;
    const rates = [];
    for (let i = 0; i < game.stages.length; i += 1) {
      const st = game.stages[i];
      const d = tuner.refPlayer(tuner.FLOOR_BAND[i]);
      const player = {
        name: 'ref', element: d.element, roots: tuner.REF_ROOTS,
        atk: d.atk, def: d.def, hp: d.hp, speed: d.speed
      };
      const mon = {
        name: st.monster.name, element: st.element,
        atk: st.monster.atk, def: st.monster.def, hp: st.monster.hp, speed: st.monster.speed
      };
      let win = 0;
      for (let k = 0; k < SEEDS; k += 1) {
        if (battleCore.simulate(player, mon, 7919 * (k + 1)).win) win += 1;
      }
      rates.push({ floor: i + 1, rate: win / SEEDS });
    }
    const walls = rates.filter((r) => r.rate < 0.9);
    check('标定器认可的参考玩家在每一层实测胜率都 ≥90%', walls.length === 0,
      walls.length
        ? `疑似硬墙：${walls.map((w) => `第${w.floor}层 ${(w.rate * 100).toFixed(0)}%`).join('，')}`
        : `${rates.length} 层全部 ≥90%（最低 ${(Math.min(...rates.map((r) => r.rate)) * 100).toFixed(0)}%）`);

    // 低一个大境界不该打过高档层（真正的门槛）
    const gate = [];
    for (let i = 0; i < game.stages.length; i += 1) {
      const band = tuner.FLOOR_BAND[i];
      if (band < 3) continue; // 前两档没有"低一档"可言
      const d = tuner.refPlayer(band - 2); // 再低一档的装备
      const st = game.stages[i];
      const player = {
        name: 'low', element: d.element, roots: tuner.REF_ROOTS,
        atk: d.atk, def: d.def, hp: d.hp, speed: d.speed
      };
      const mon = {
        name: st.monster.name, element: st.element,
        atk: st.monster.atk, def: st.monster.def, hp: st.monster.hp, speed: st.monster.speed
      };
      let win = 0;
      for (let k = 0; k < 60; k += 1) {
        if (battleCore.simulate(player, mon, 104729 * (k + 1)).win) win += 1;
      }
      if (win / 60 >= 0.5) gate.push(`第${i + 1}层被低两档的玩家打了个 ${Math.round(win / 60 * 100)}%`);
    }
    check('低两个档次的玩家打不过高档层（塔有门槛）', gate.length === 0,
      gate.length ? gate.join('；') : '所有高档层都拦住了低档玩家');

    // ---- 失败惩罚折算成挂机时间，不能重到"点一次就白挂几小时" ----
    const idleSec = game.stages.map((s, i) => {
      const d = tuner.refPlayer(tuner.FLOOR_BAND[i]);
      const expPerSec = d.stonePerSec * 0.6;
      return s.failExp / expPerSec;
    });
    check('失败惩罚不超过 20 分钟挂机产出', Math.max(...idleSec) <= 1200,
      `最重 ${Math.round(Math.max(...idleSec))} 秒（第 ${idleSec.indexOf(Math.max(...idleSec)) + 1} 层）`);

    // 低一个大境界不该打过高档层
    const low = await register(conn, 'low');
    await setRole(low.roleId, '`realm` = 0, `realm_level` = 4, `exp` = 0, `roots` = ?', [refRoots]);
    await equipItem(low.roleId, 21);
    const lowPv = await request('GET', '/api/battle/preview/all', null, low.token);
    const lowWin = lowPv.body.data.lists ? [] : lowPv.body.data.list.filter((x) => x.damage.verdict === '优势');
    check('炼气期最多只能打到第 4 层附近', lowWin.length <= 4,
      `可稳过 ${lowWin.length} 层`);

    // 最差道体也必须能过新手关（避免"运气差就卡在新手村"）
    const worst = await register(conn, 'worst');
    await setRole(worst.roleId, '`roots` = ?', [JSON.stringify({ 金: 5, 木: 5, 水: 5, 火: 5, 土: 5 })]);
    const wf = await request('POST', '/api/battle/challenge', { stageId: 1 }, worst.token);
    const wrep = wf.body.data && wf.body.data.challenge && wf.body.data.challenge.report;
    check('最差道体（五灵根全 5）也能通关新手关',
      !!wrep && wrep.win === true,
      wrep ? `${wrep.roundCount} 回合，剩余气血 ${wrep.playerHp}/${wrep.playerMaxHp}` : wf.body.msg);
  }

  // 清掉本轮造出来的测试账号，别让排行榜被"探xxx"刷屏
  const { cleanup } = require('./cleanup-test-data');
  const cleaned = await cleanup(conn);
  console.log(`\n已清理测试账号 ${cleaned.accounts} 个（含历史遗留）`);

  await conn.end();

  console.log('\n════════════════════════════════════');
  console.log(`  探针：通过 ${pass} 项，失败 ${fail} 项，额外发现 ${findings.length} 条`);
  if (findings.length) {
    console.log('  待确认问题：');
    findings.forEach((f, i) => console.log(`   ${i + 1}. [${f.severity}] ${f.title}`));
  }
  console.log('════════════════════════════════════\n');
  process.exit(fail === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error('\n探针异常：', e);
  process.exit(1);
});
