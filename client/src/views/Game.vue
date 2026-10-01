<template>
  <div class="game-root">
    <!-- profile 未就绪时不能渲染主界面：模板里到处是 role.xxx / derived.xxx，
         首屏直接访问会触发 render 错误（Vue 只会打日志并渲染空白） -->
    <div v-if="profile" class="game-page">
      <header class="topbar">
        <div class="brand">仙 · 侠 · 放 · 置</div>

        <div class="res">
          <span class="res-item">灵石 <b class="jade">{{ $num(liveStone) }}</b></span>
          <span class="res-item">修为 <b class="gold">{{ $num(liveExp) }}</b></span>
          <span class="res-item rate">+{{ $rate(derived.stonePerSec) }}/秒</span>
        </div>

        <div class="who">
          <span class="nick">{{ role.nickname }}</span>
          <span class="realm">{{ role.realmName }} · {{ role.realmLevel }}层</span>
          <el-button type="text" @click="logout">退出</el-button>
        </div>
      </header>

      <div v-if="disconnected" class="offline-bar">
        与服务器失联，正在重连……（数字已停止估算，恢复后会自动对齐）
      </div>

      <div class="layout">
        <aside class="side">
          <RolePanel />
        </aside>

        <main class="main">
          <el-tabs v-model="tab">
            <el-tab-pane label="修炼" name="cultivate">
              <CultivatePanel />
            </el-tab-pane>
            <el-tab-pane label="灵根" name="roots">
              <RootPanel v-if="tab === 'roots'" />
            </el-tab-pane>
            <el-tab-pane label="背包" name="bag">
              <BagPanel v-if="tab === 'bag'" />
            </el-tab-pane>
            <el-tab-pane label="坊市" name="shop">
              <ShopPanel v-if="tab === 'shop'" />
            </el-tab-pane>
            <el-tab-pane label="试炼塔" name="tower">
              <TowerPanel v-if="tab === 'tower'" />
            </el-tab-pane>
            <el-tab-pane label="天榜" name="rank">
              <RankPanel v-if="tab === 'rank'" />
            </el-tab-pane>
            <el-tab-pane label="见闻录" name="log">
              <LogPanel v-if="tab === 'log'" />
            </el-tab-pane>
          </el-tabs>
        </main>

        <aside class="side-right">
          <ActionFeed />
        </aside>
      </div>

      <footer class="site-footer">本页面为deepseek生成</footer>
    </div>

    <div v-else class="boot-mask">
      <template v-if="bootFailed">
        <span>没能读到你的道途档案</span>
        <el-button type="primary" size="small" @click="forceLogin">重新登录</el-button>
      </template>
      <template v-else>
        <i class="el-icon-loading"></i>
        <span>正在推演天机...</span>
      </template>
    </div>
  </div>
</template>

<script>
import { mapGetters, mapState } from 'vuex';
import RolePanel from '../components/RolePanel.vue';
import CultivatePanel from '../components/CultivatePanel.vue';
import RootPanel from '../components/RootPanel.vue';
import BagPanel from '../components/BagPanel.vue';
import ShopPanel from '../components/ShopPanel.vue';
import TowerPanel from '../components/TowerPanel.vue';
import RankPanel from '../components/RankPanel.vue';
import LogPanel from '../components/LogPanel.vue';
import ActionFeed from '../components/ActionFeed.vue';

const POLL_MS = 5000;

export default {
  name: 'GameView',
  components: {
    RolePanel, CultivatePanel, RootPanel, BagPanel,
    ShopPanel, TowerPanel, RankPanel, LogPanel, ActionFeed
  },
  data() {
    return {
      tab: 'cultivate',
      tickTimer: null,
      pollTimer: null,
      offlineShown: false,
      bootFailed: false,
      pollFailures: 0,
      disconnected: false
    };
  },
  computed: {
    ...mapState(['profile']),
    ...mapGetters(['role', 'derived', 'liveStone', 'liveExp', 'settle'])
  },
  async created() {
    // 令牌可能已过期，bootstrap 失败不该把页面卡死
    try {
      await this.$store.dispatch('bootstrap');
    } catch (e) {
      this.bootFailed = true;
    }

    // await 期间组件可能已被销毁（HMR、令牌失效跳转），不能再去挂定时器
    if (this._isDestroyed) return;

    if (!this.profile) {
      // 不再 replace 到 /login：路由守卫看到 token 还在会弹回本页，形成死循环。
      // 改为在遮罩上给一个明确的「重新登录」出口。
      this.bootFailed = true;
      return;
    }

    this.showOfflineReward();
    this.startTimers();
    this.$root.$on('switch-tab', this.switchTab);
  },
  beforeDestroy() {
    clearInterval(this.tickTimer);
    clearInterval(this.pollTimer);
    this.$root.$off('switch-tab', this.switchTab);
  },
  methods: {
    switchTab(tab) {
      this.tab = tab;
    },
    startTimers() {
      // 每秒推动一次本地插值，让数字持续跳动
      this.tickTimer = setInterval(() => this.$store.commit('TICK'), 1000);
      // 每 5 秒与服务端对一次帐（服务端按 60 秒阈值节流落库）。
      // 档案里顺带带回最近的行动记录，右侧行动区因此不需要额外请求。
      this.pollTimer = setInterval(() => {
        this.$store.dispatch('fetchProfile', { silent: true })
          .then(() => {
            this.pollFailures = 0;
            this.disconnected = false;
            this.showOfflineReward();
          })
          .catch(() => {
            this.pollFailures += 1;
            if (this.pollFailures >= 3) this.disconnected = true;
          });
      }, POLL_MS);
    },
    showOfflineReward() {
      // 离线收益不再弹通知：服务端在结算时已经往「行迹」里写了一条
      // 「闭关 N，洞府产出灵石 X、修为 Y」，比一次性提示更持久。
      const s = this.settle;
      if (!s || this.offlineShown || !s.offline || s.gainedStone <= 0) return;
      this.offlineShown = true;
    },
    forceLogin() {
      this.$store.commit('CLEAR');
      this.$router.replace({ name: 'login' }).catch(() => {});
    },
    logout() {
      this.$store.dispatch('logout');
      this.$router.replace({ name: 'login' }).catch(() => {});
    }
  }
};
</script>

<style lang="scss" scoped>
.game-root {
  height: 100%;
}

.boot-mask {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
  color: #8ba1b8;
  font-size: 14px;
  letter-spacing: 2px;
}

.game-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.topbar {
  flex: 0 0 auto;
  height: 56px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 20px;
  border-bottom: 1px solid rgba(120, 200, 180, 0.16);
  background: rgba(12, 20, 33, 0.72);
  backdrop-filter: blur(6px);
}

.brand {
  font-size: 16px;
  letter-spacing: 4px;
  background: linear-gradient(180deg, #fff6d8, #d9b96a);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.res {
  display: flex;
  gap: 22px;
  font-size: 13px;
  color: #8ba1b8;

  b { margin-left: 6px; color: #dfe9f3; font-variant-numeric: tabular-nums; }
  b.jade { color: #4fd3b8; }
  b.gold { color: #d9b96a; }
  .rate { color: #4fd3b8; }
}

.who {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 13px;
  color: #8ba1b8;

  .nick { color: #dfe9f3; }
  .realm { color: #d9b96a; }
}

.offline-bar {
  flex: 0 0 auto;
  padding: 6px 20px;
  font-size: 12px;
  color: #f0c674;
  background: rgba(200, 150, 60, 0.12);
  border-bottom: 1px solid rgba(200, 150, 60, 0.25);
  text-align: center;
  letter-spacing: 1px;
}

.layout {
  flex: 1 1 auto;
  display: flex;
  gap: 16px;
  padding: 16px 20px 20px;
  overflow: hidden;
}

.side {
  flex: 0 0 300px;
  overflow-y: auto;
}

.side-right {
  flex: 0 0 260px;
  overflow-y: auto;
}

.main {
  flex: 1 1 auto;
  min-width: 0;
  overflow-y: auto;
  background: rgba(18, 30, 46, 0.5);
  border: 1px solid rgba(120, 200, 180, 0.16);
  border-radius: 6px;
  padding: 8px 18px 18px;
}

.site-footer {
  flex: 0 0 auto;
  text-align: center;
  padding: 10px 20px;
  font-size: 12px;
  letter-spacing: 1px;
  color: rgba(139, 161, 184, 0.6);
  border-top: 1px solid rgba(120, 200, 180, 0.12);
  background: rgba(12, 20, 33, 0.5);
}
</style>
