/**
 * 排行榜路由
 */
const express = require('express');
const rankService = require('../services/rank.service');
const auth = require('../middleware/auth');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();
router.use(auth);

router.get('/list', asyncHandler(async (req, res) =>
  ok(res, await rankService.list(req.accountId, req.query.limit))));

module.exports = router;
