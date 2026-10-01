/**
 * 运行时配置：全部来自 .env，带合理默认值
 */
const num = (v, def) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
};

const DEFAULT_JWT_SECRET = 'xianxia_dev_secret_change_me';

const config = {
  env: process.env.NODE_ENV || 'development',
  port: num(process.env.PORT, 3000),

  db: {
    host: process.env.DB_HOST || '127.0.0.1',
    port: num(process.env.DB_PORT, 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'xianxia',
    connectionLimit: num(process.env.DB_CONNECTION_LIMIT, 10)
  },

  jwt: {
    secret: process.env.JWT_SECRET || DEFAULT_JWT_SECRET,
    expiresIn: process.env.JWT_EXPIRES_IN || '7d'
  },

  settle: {
    // 离线收益上限（小时）
    maxHours: num(process.env.SETTLE_MAX_HOURS, 12),
    // 超出上限部分折算比例
    overflowRate: 0.2,
    // 轮询结算最小落库间隔（秒）
    minPersistSeconds: num(process.env.SETTLE_MIN_PERSIST_SECONDS, 60),
    // 流水最小落库间隔（秒）
    minLogSeconds: num(process.env.SETTLE_MIN_LOG_SECONDS, 300),
    // 灵气转化为修为的比例
    expRate: num(process.env.SETTLE_EXP_RATE, 0.6)
  }
};

module.exports = config;

/**
 * 密钥体检：默认密钥是公开的，任何人拿它就能签出任意账号的令牌。
 * 生产环境直接拒绝启动；开发环境只提醒。
 */
module.exports.assertJwtSecret = function assertJwtSecret() {
  if (config.jwt.secret !== DEFAULT_JWT_SECRET) return true;
  const msg = 'JWT_SECRET 仍是默认值（xianxia_dev_secret_change_me），任何人都能伪造登录令牌';
  if (config.env === 'production') {
    throw new Error(`${msg}。请在 server/.env 里改成一段随机字符串后再启动。`);
  }
  console.warn(`\n  ⚠ 警告：${msg}。上线前务必修改 server/.env 的 JWT_SECRET。\n`);
  return false;
};
