/**
 * JWT 鉴权中间件
 * 通过后挂载 req.accountId / req.roleId
 */
const jwt = require('jsonwebtoken');
const config = require('../config');
const { err } = require('../utils/http');

module.exports = function auth(req, res, next) {
  const header = req.headers.authorization || '';
  const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
  if (!token) return next(err.unauthorized('未登录'));

  try {
    const payload = jwt.verify(token, config.jwt.secret);
    req.accountId = payload.aid;
    req.roleId = payload.rid;
    return next();
  } catch (e) {
    return next(err.unauthorized(e.name === 'TokenExpiredError' ? '登录已过期，请重新登录' : '登录凭证无效'));
  }
};
