/**
 * 坊市路由
 */
const express = require('express');
const shopService = require('../services/shop.service');
const auth = require('../middleware/auth');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();
router.use(auth);

router.get('/list', asyncHandler(async (req, res) => ok(res, await shopService.list(req.accountId))));

router.post('/buy', asyncHandler(async (req, res) => {
  const { itemId, num } = req.body || {};
  return ok(res, await shopService.buy(req.accountId, itemId, num));
}));

module.exports = router;
