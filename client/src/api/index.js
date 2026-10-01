import request from './request';

/* 账号 */
export const apiRegister = (data) => request.post('/auth/register', data);
export const apiLogin = (data) => request.post('/auth/login', data);

/* 角色 */
export const apiProfile = (silent = false) => request.get('/role/profile', { silent });
export const apiBreakthrough = () => request.post('/role/breakthrough');
export const apiUpgradeCave = () => request.post('/role/cave/upgrade');
export const apiLogs = (params = {}) => request.get('/role/logs', { params });
export const apiActions = (limit = 20) => request.get('/role/actions', { params: { limit } });

/* 灵根洗练（单条） */
export const apiRerollRoot = (element) => request.post('/role/roots/reroll', { element });
export const apiConfirmRoot = (save) => request.post('/role/roots/confirm', { save });

/* 背包 */
export const apiBagList = () => request.get('/bag/list');
export const apiBagUse = (itemId, num = 1, element = null) =>
  request.post('/bag/use', element ? { itemId, num, element } : { itemId, num });
export const apiBagEquip = (itemId) => request.post('/bag/equip', { itemId });
export const apiBagUnequip = (type) => request.post('/bag/unequip', { type });
export const apiBagSell = (itemId, num = 1) => request.post('/bag/sell', { itemId, num });

/* 坊市 */
export const apiShopList = () => request.get('/shop/list');
export const apiShopBuy = (itemId, num = 1) => request.post('/shop/buy', { itemId, num });

/* 试炼塔 */
export const apiStages = () => request.get('/battle/stages');
export const apiChallenge = (stageId) => request.post('/battle/challenge', { stageId });
export const apiPreview = (stageId) => request.get('/battle/preview', { params: { stageId } });
export const apiPreviewAll = () => request.get('/battle/preview/all');

/* 排行榜 */
export const apiRankList = (limit = 50) => request.get('/rank/list', { params: { limit } });

/* 配置 */
export const apiGameConfig = () => request.get('/game/config');
