/**
 * 配置路由：前端启动时拉一次，用于显示境界名、物品、塔层
 */
const express = require('express');
const game = require('../game');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();

router.get('/config', asyncHandler(async (req, res) => ok(res, game.publicConfig())));

module.exports = router;
