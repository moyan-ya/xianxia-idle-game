/**
 * 试炼塔路由
 */
const express = require('express');
const battleService = require('../services/battle.service');
const auth = require('../middleware/auth');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();
router.use(auth);

router.get('/stages', asyncHandler(async (req, res) => ok(res, await battleService.list(req.accountId))));

/** 战斗推演：把伤害公式的推导过程算给玩家看，随便刷 */
router.get('/preview', asyncHandler(async (req, res) =>
  ok(res, await battleService.preview(req.accountId, req.query.stageId))));

/** 一次算完全部塔层的推演，供前端下拉快速切换 */
router.get('/preview/all', asyncHandler(async (req, res) =>
  ok(res, await battleService.previewAll(req.accountId))));

router.post('/challenge', asyncHandler(async (req, res) => {
  const { stageId } = req.body || {};
  return ok(res, await battleService.challenge(req.accountId, stageId));
}));

module.exports = router;
