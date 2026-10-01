/**
 * 角色路由：档案（惰性结算主入口）、突破、洞府、灵根洗练、流水分页、行动记录
 */
const express = require('express');
const roleService = require('../services/role.service');
const auth = require('../middleware/auth');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();

router.use(auth);

// 前端每 5~10 秒轮询这个接口，服务端按阈值节流落库
router.get('/profile', asyncHandler(async (req, res) => ok(res, await roleService.getProfile(req.accountId))));

router.post('/breakthrough', asyncHandler(async (req, res) =>
  ok(res, await roleService.breakthrough(req.accountId))));

router.post('/cave/upgrade', asyncHandler(async (req, res) =>
  ok(res, await roleService.upgradeCave(req.accountId))));

/** 单条灵根洗练：只出结果，不直接生效 */
router.post('/roots/reroll', asyncHandler(async (req, res) => {
  const { element } = req.body || {};
  return ok(res, await roleService.rerollRoot(req.accountId, element));
}));

/** 确认洗练结果：save=true 保存新值，否则保留原值 */
router.post('/roots/confirm', asyncHandler(async (req, res) => {
  const { save } = req.body || {};
  return ok(res, await roleService.confirmRoot(req.accountId, save));
}));

// 资源流水与战斗留档都走服务端分页：页码从 1 开始，每页条数夹在 1..50
// 页码也必须有上限：否则 ?page=4294967295 会算出天量 OFFSET，逼 InnoDB 全量扫描
const MAX_PAGE = 1000;
router.get('/logs', asyncHandler(async (req, res) => {
  const clamp = (raw, def) => {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), MAX_PAGE) : def;
  };
  const clampSize = (raw, def) => {
    const n = Number(raw);
    return Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 1), 50) : def;
  };
  const page = clamp(req.query.page, 1);
  const pageSize = clampSize(req.query.pageSize, 10);
  const battlePage = clamp(req.query.battlePage, 1);
  const battlePageSize = clampSize(req.query.battlePageSize, 10);
  return ok(res, await roleService.logs(req.accountId, { page, pageSize, battlePage, battlePageSize }));
}));

/** 行动记录（右侧行动区） */
router.get('/actions', asyncHandler(async (req, res) => {
  const raw = Number(req.query.limit);
  const limit = Number.isFinite(raw) ? Math.min(Math.max(Math.trunc(raw), 1), 50) : 20;
  return ok(res, await roleService.actions(req.accountId, limit));
}));

module.exports = router;
