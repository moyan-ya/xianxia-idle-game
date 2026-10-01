import axios from 'axios';
import { Message } from 'element-ui';

/**
 * 统一请求层
 * 后端约定：{ code: 0, msg: 'ok', data }，业务错误 HTTP 仍是 200
 *
 * 请求配置支持 `silent: true` —— 后台轮询用静默模式，
 * 否则后端一挂，每 5 秒一次的轮询会把错误提示刷满屏。
 */
const service = axios.create({
  baseURL: '/api',
  timeout: 15000
});

/**
 * 令牌失效的统一出口。
 *
 * 顺序至关重要：必须**先清 token 再跳登录页**。
 * 路由守卫的判断是 `去 /login && store.state.token` → 弹回 /game，
 * 如果 token 还在，导航会被弹回，页面就永久卡在加载遮罩里（用户连退出按钮都看不到）。
 */
function handleUnauthorized(silent, msg) {
  const store = require('../store').default;
  store.commit('CLEAR');
  if (!silent) Message.error(msg || '登录已过期，请重新登录');
  if (window.location.hash !== '#/login') window.location.hash = '#/login';
}

service.interceptors.request.use((cfg) => {
  const token = localStorage.getItem('xianxia_token');
  if (token) cfg.headers.Authorization = `Bearer ${token}`;
  return cfg;
});

service.interceptors.response.use(
  (res) => {
    const body = res.data || {};
    if (body.code === 0) return body.data;

    const silent = !!(res.config && res.config.silent);

    if (body.code === 1002) {
      handleUnauthorized(silent, body.msg);
      return Promise.reject(new Error(body.msg || '未登录'));
    }

    if (!silent) Message.error(body.msg || '操作失败');
    return Promise.reject(new Error(body.msg || '操作失败'));
  },
  (error) => {
    const silent = !!(error.config && error.config.silent);
    const resp = error.response;
    const body = resp && resp.data;

    // 鉴权失败后端返回的是 HTTP 401（code 1002），axios 会走这个 error 分支，
    // 所以这里也必须处理一次 —— 只在成功分支处理等于没处理。
    if (resp && (resp.status === 401 || (body && body.code === 1002))) {
      handleUnauthorized(silent, body && body.msg);
      return Promise.reject(error);
    }

    if (!silent) {
      const msg = resp
        ? `请求失败（${resp.status}）`
        : '网络异常，请确认后端已启动（127.0.0.1:3000）';
      Message.error(msg);
    }
    return Promise.reject(error);
  }
);

export default service;
