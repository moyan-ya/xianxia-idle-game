import Vue from 'vue';
import Vuex from 'vuex';
import * as api from '../api';

Vue.use(Vuex);

const TOKEN_KEY = 'xianxia_token';

/** 本地插值最多估算这么久，超出的部分等服务端对账，免得断线时数字无限膨胀 */
const MAX_INTERP_SECONDS = 12;

export default new Vuex.Store({
  state: {
    token: localStorage.getItem(TOKEN_KEY) || '',
    profile: null,   // { role, derived, equip, settle }
    config: null,    // 服务端配置表
    lastSyncAt: 0,   // 上次拿到档案的时间，用于本地插值
    tick: Date.now(),
    profileSeq: 0,   // 档案写入序号：用于丢弃"迟到"的旧响应
    profileLoading: false
  },

  getters: {
    role: (s) => (s.profile ? s.profile.role : null),
    derived: (s) => (s.profile ? s.profile.derived : null),
    equip: (s) => (s.profile ? s.profile.equip : { artifact: null, skill: null }),
    settle: (s) => (s.profile ? s.profile.settle : null),
    actions: (s) => (s.profile && s.profile.actions) || [],

    /**
     * 两次轮询之间的本地插值：
     * 服务端是唯一权威，但每 5 秒跳一次数字体验太差，
     * 所以按 stonePerSec 在本地平滑补给，下一次轮询再校正回来。
     */
    liveStone: (s) => {
      if (!s.profile) return 0;
      const elapsed = Math.min(Math.max(0, s.tick - s.lastSyncAt) / 1000, MAX_INTERP_SECONDS);
      return Math.floor(s.profile.role.spiritStone + s.profile.derived.stonePerSec * elapsed);
    },
    liveExp: (s) => {
      if (!s.profile) return 0;
      const rate = s.profile.derived.stonePerSec * ((s.profile.settle && s.profile.settle.expRate) || 0.6);
      const elapsed = Math.min(Math.max(0, s.tick - s.lastSyncAt) / 1000, MAX_INTERP_SECONDS);
      return Math.floor(s.profile.role.exp + rate * elapsed);
    }
  },

  mutations: {
    SET_TOKEN(state, token) {
      state.token = token || '';
      if (token) localStorage.setItem(TOKEN_KEY, token);
      else localStorage.removeItem(TOKEN_KEY);
    },
    SET_PROFILE(state, profile) {
      // derived 缺失时放行会导致模板报错、组件渲染不出 DOM 且不会自愈（整页空白），
      // 所以 role 和 derived 都要校验
      if (!profile || !profile.role || !profile.derived) return;
      state.profile = profile;
      state.lastSyncAt = Date.now();
      state.tick = Date.now();
      state.profileSeq += 1;
    },
    SET_CONFIG(state, config) {
      state.config = config;
    },
    TICK(state) {
      state.tick = Date.now();
    },
    CLEAR(state) {
      state.token = '';
      state.profile = null;
      localStorage.removeItem(TOKEN_KEY);
    }
  },

  actions: {
    /** 配置只在进游戏时拉一次；失败后靠轮询补拉，避免"塔层对手列永久未知、境界表永远空" */
    async ensureConfig({ commit, state }) {
      if (state.config) return;
      try {
        commit('SET_CONFIG', await api.apiGameConfig());
      } catch (e) { /* 下次轮询再试 */ }
    },

    async bootstrap({ commit, state, dispatch }) {
      await dispatch('ensureConfig');
      if (state.token) await dispatch('fetchProfile');
    },

    async fetchProfile({ commit, state, dispatch }, { silent = false } = {}) {
      if (!state.token) return null;
      if (!state.config) dispatch('ensureConfig'); // 不 await：别拖慢主轮询
      if (state.profileLoading) return null; // 防重入：慢响应时不要堆积并发轮询

      state.profileLoading = true;
      const tokenAtRequest = state.token;
      const seqAtRequest = state.profileSeq;
      try {
        const data = await api.apiProfile(silent);
        // 飞行期间可能已经登出/换号，或者某个操作已经写入了更新的档案 —— 迟到的旧响应必须丢掉
        if (state.token !== tokenAtRequest || state.profileSeq !== seqAtRequest) return null;
        commit('SET_PROFILE', data);
        return data;
      } finally {
        state.profileLoading = false;
      }
    },

    async login({ commit }, form) {
      const data = await api.apiLogin(form);
      commit('SET_TOKEN', data.token);
      commit('SET_PROFILE', data);
      return data;
    },

    async register({ commit }, form) {
      const data = await api.apiRegister(form);
      commit('SET_TOKEN', data.token);
      commit('SET_PROFILE', data);
      return data;
    },

    logout({ commit }) {
      commit('CLEAR');
    }
  }
});
