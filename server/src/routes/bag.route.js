/**
 * 背包路由
 */
const express = require('express');
const bagService = require('../services/bag.service');
const auth = require('../middleware/auth');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();
router.use(auth);

router.get('/list', asyncHandler(async (req, res) => ok(res, await bagService.list(req.accountId))));

/** 使用道具：散灵丹需要额外指定 element（要散去哪条灵根） */
router.post('/use', asyncHandler(async (req, res) => {
  const { itemId, num, element } = req.body || {};
  return ok(res, await bagService.use(req.accountId, itemId, num, element));
}));

router.post('/equip', asyncHandler(async (req, res) => {
  const { itemId } = req.body || {};
  return ok(res, await bagService.equip(req.accountId, itemId));
}));

router.post('/unequip', asyncHandler(async (req, res) => {
  const { type } = req.body || {};
  return ok(res, await bagService.unequip(req.accountId, type));
}));

/** 出售：按市价 sellRate（7 成）回收灵石 */
router.post('/sell', asyncHandler(async (req, res) => {
  const { itemId, num } = req.body || {};
  return ok(res, await bagService.sell(req.accountId, itemId, num));
}));

module.exports = router;
