/**
 * 404 与统一错误处理
 */
const { AppError, CODES } = require('../utils/http');

function notFound(req, res) {
  res.status(404).json({ code: CODES.NOT_FOUND, msg: `接口不存在: ${req.method} ${req.originalUrl}` });
}

// eslint-disable-next-line no-unused-vars
function errorHandler(e, req, res, next) {
  if (e instanceof AppError) {
    return res.status(e.status).json({ code: e.code, msg: e.message });
  }

  // body-parser 等中间件抛出的 4xx：畸形 JSON、体积超限等。
  // 这些是客户端的问题，不该报 500，也不该打印堆栈污染日志。
  if (e && e.type === 'entity.parse.failed') {
    return res.status(400).json({ code: CODES.PARAM, msg: '请求体不是合法的 JSON' });
  }
  if (e && e.type === 'entity.too.large') {
    return res.status(413).json({ code: CODES.PARAM, msg: '请求体过大' });
  }
  if (e && Number.isInteger(e.status) && e.status >= 400 && e.status < 500) {
    return res.status(e.status).json({ code: CODES.PARAM, msg: e.expose ? e.message : '请求不合法' });
  }

  if (e && e.code === 'ER_DUP_ENTRY') {
    return res.json({ code: CODES.CONFLICT, msg: '数据已存在，请重试' });
  }
  if (e && (e.code === 'ECONNREFUSED' || e.code === 'PROTOCOL_CONNECTION_LOST' || e.code === 'ER_ACCESS_DENIED_ERROR')) {
    console.error('[数据库异常]', e.message);
    return res.status(500).json({ code: CODES.SERVER, msg: '数据库连接异常，请检查 server/.env 配置' });
  }
  if (e && e.code === 'ER_WARN_DATA_OUT_OF_RANGE') {
    console.error('[数值越界]', e.message);
    return res.status(500).json({ code: CODES.SERVER, msg: '数值超出范围，请联系管理员' });
  }
  console.error('[未捕获异常]', e);
  return res.status(500).json({ code: CODES.SERVER, msg: '服务器开小差了，请稍后再试' });
}

module.exports = { notFound, errorHandler };
