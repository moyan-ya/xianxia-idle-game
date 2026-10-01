/**
 * 仙侠放置游戏 · 后端入口
 * Node 16.20 + Express 4 + MySQL 8
 */
require('dotenv').config();

const express = require('express');
const cors = require('cors');

const config = require('./src/config');
const routes = require('./src/routes');
const { notFound, errorHandler } = require('./src/middleware/error');

const app = express();

config.assertJwtSecret();

app.disable('x-powered-by');
app.use(cors());
app.use(express.json({ limit: '256kb' }));

// 访问日志（MVP 用 console，上量后换 winston）
// profile 是前端每 5 秒一次的轮询，成功时不记，否则日志会被它刷满
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const isQuietPoll = req.method === 'GET' && req.path === '/api/role/profile' && res.statusCode === 200;
    if (isQuietPoll) return;
    console.log(
      `[${new Date().toISOString()}] ${req.method} ${req.originalUrl} ` +
      `${res.statusCode} ${Date.now() - start}ms`
    );
  });
  next();
});

app.get('/health', (req, res) => res.json({ code: 0, msg: 'ok', data: { uptime: process.uptime() } }));
app.use('/api', routes);

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log('');
  console.log('  ╔══════════════════════════════════════════╗');
  console.log('  ║   仙侠放置 · 后端已启动                   ║');
  console.log('  ╚══════════════════════════════════════════╝');
  console.log(`  接口地址 : http://127.0.0.1:${config.port}/api`);
  console.log(`  健康检查 : http://127.0.0.1:${config.port}/health`);
  console.log(`  数据库   : ${config.db.user}@${config.db.host}:${config.db.port}/${config.db.database}`);
  console.log('');
});

// 优雅退出：关闭连接池
const shutdown = (signal) => {
  console.log(`\n收到 ${signal}，正在关闭...`);
  server.close(() => {
    // 关闭连接池失败也不能让进程挂着，catch 掉避免 unhandledRejection
    require('./src/config/db').pool.end().catch(() => {}).finally(() => process.exit(0));
  });
  setTimeout(() => process.exit(0), 5000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

// 进程级兜底：至少把异常打出来，不要静默带走服务
process.on('unhandledRejection', (reason) => {
  console.error('[未处理的 Promise 拒绝]', reason);
});
process.on('uncaughtException', (e) => {
  console.error('[未捕获的进程异常]', e);
});

module.exports = app;
