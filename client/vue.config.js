/**
 * Vue CLI 4.5.15 配置（webpack 4）
 * Node 16 不受 Node 17+ 的 OpenSSL 报错影响，这里无需额外配置
 */
module.exports = {
  publicPath: './',
  lintOnSave: false,
  productionSourceMap: false,
  // 关掉 thread-loader 多进程构建：本项目体量下单线程更快，
  // 且能兼容不允许 spawn 子进程的环境（受限 CI / 沙箱）。
  // 项目变大后可改回 true。
  parallel: false,
  devServer: {
    port: 8080,
    open: false,
    // 关掉 webpack 进度条，否则日志被刷爆
    progress: false,
    // 前端只管发 /api，转发到 Node 后端，避免开发期跨域
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:3000',
        changeOrigin: true
      }
    }
  },
  configureWebpack: {
    name: '仙侠放置'
  }
};
