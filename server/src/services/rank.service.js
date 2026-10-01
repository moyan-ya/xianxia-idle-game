/**
 * 排行榜：修为榜（境界 → 层数 → 修为）
 */
const db = require('../config/db');
const dao = require('../dao');
const game = require('../game');
const { err } = require('../utils/http');

function decorate(row) {
  const realm = game.realms[row.realm] || game.realms[0];
  return {
    roleId: row.id,
    nickname: row.nickname,
    realm: row.realm,
    realmLevel: row.realm_level,
    realmName: realm.name,
    realmColor: realm.color,
    exp: Number(row.exp),
    totalBreak: row.total_break,
    caveLevel: row.cave_level
  };
}

async function list(accountId, limit = 50) {
  const size = Math.min(Math.max(Math.trunc(Number(limit)) || 50, 1), 100);

  const me = await dao.findRoleByAccount(db.pool, accountId);
  if (!me) throw err.notFound('角色不存在');

  const rows = await dao.listRank(db.pool, size);
  const total = await dao.countRankedRoles(db.pool);
  const myRank = await dao.countRankAbove(db.pool, me);

  const list = rows.map((row, idx) => Object.assign(decorate(row), {
    rank: idx + 1,
    isMe: row.id === me.id
  }));

  // 榜外时把我自己的成绩也带上，玩家才知道离上榜还差多少
  const inBoard = list.some((r) => r.isMe);
  const my = Object.assign(decorate(me), { rank: myRank, isMe: true });

  return { list, total, myRank, inBoard, my, size };
}

module.exports = { list };
