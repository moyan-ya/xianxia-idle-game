/**
 * 统一响应格式与错误类型
 *   成功: { code: 0, msg: 'ok', data: ... }
 *   失败: { code: 1003, msg: '灵石不足' }
 * 业务错误一律 HTTP 200 + 非 0 code，鉴权失败才用 401
 */

const CODES = {
  OK: 0,
  PARAM: 1001,
  UNAUTHORIZED: 1002,
  NOT_ENOUGH: 1003,
  CONDITION: 1004,
  NOT_FOUND: 1005,
  CONFLICT: 1006,
  SERVER: 5000
};

class AppError extends Error {
  constructor(code, message, status = 200) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.status = status;
  }
}

const err = {
  param: (msg = '参数不合法') => new AppError(CODES.PARAM, msg),
  unauthorized: (msg = '登录状态已失效，请重新登录') => new AppError(CODES.UNAUTHORIZED, msg, 401),
  notEnough: (msg = '资源不足') => new AppError(CODES.NOT_ENOUGH, msg),
  condition: (msg = '条件不满足') => new AppError(CODES.CONDITION, msg),
  notFound: (msg = '数据不存在') => new AppError(CODES.NOT_FOUND, msg),
  conflict: (msg = '操作冲突，请重试') => new AppError(CODES.CONFLICT, msg)
};

function ok(res, data = null) {
  return res.json({ code: CODES.OK, msg: 'ok', data });
}

/** Express 4 不会自动捕获 async 异常，统一包一层 */
const asyncHandler = (fn) => (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);

module.exports = { CODES, AppError, err, ok, asyncHandler };
