/**
 * 账号路由：注册 / 登录 / 校验令牌
 */
const express = require('express');
const authService = require('../services/auth.service');
const roleService = require('../services/role.service');
const auth = require('../middleware/auth');
const { ok, asyncHandler } = require('../utils/http');

const router = express.Router();

router.post('/register', asyncHandler(async (req, res) => {
  const { username, password, nickname } = req.body || {};
  const result = await authService.register({ username, password, nickname });
  const profile = await roleService.getProfile(result.accountId);
  return ok(res, Object.assign({ token: result.token }, profile));
}));

router.post('/login', asyncHandler(async (req, res) => {
  const { username, password } = req.body || {};
  const result = await authService.login({ username, password });
  const profile = await roleService.getProfile(result.accountId);
  return ok(res, Object.assign({ token: result.token }, profile));
}));

router.get('/me', auth, asyncHandler(async (req, res) => ok(res, await roleService.getProfile(req.accountId))));

module.exports = router;
