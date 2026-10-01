<template>
  <div class="tower">
    <div class="head">
      <div class="xi-title" style="margin:0">试炼塔 · 十五重</div>
      <div class="tip">
        已解锁 {{ unlocked }} / {{ stages.length }} 层 · 首通全额奖励，重复挑战按 {{ repeatPct }}% 计
      </div>
    </div>

    <div v-if="loading" class="xi-empty">正在推演塔中气机...</div>

    <div v-else class="stage-grid">
      <div
        v-for="s in stages"
        :key="s.stageId"
        class="stage-card"
        :class="{ locked: s.locked, cleared: s.firstCleared }"
      >
        <div class="stage-top">
          <span class="stage-no">{{ s.stageId }}</span>
          <span class="stage-name">{{ s.name }}</span>
        </div>
        <div class="stage-monster">
          {{ s.monsterName }}
          <span class="el-tag-mini" :style="{ color: s.elementColor, borderColor: s.elementColor }">{{ s.element }}</span>
        </div>
        <div class="stage-stat">
          气血 {{ $num(s.monster.hp) }} · 攻 {{ $num(s.monster.atk) }} · 防 {{ $num(s.monster.def) }} · 身法 {{ s.monster.speed }}
        </div>
        <div class="stage-reward">
          奖励：修为 {{ $num(s.reward.exp) }} · 灵石 {{ $num(s.reward.stone) }}
        </div>
        <div class="stage-risk">失败扣修为 {{ $num(s.failExp) }}</div>
        <div class="stage-foot">
          <span v-if="s.locked" class="state lock">未解锁</span>
          <span v-else-if="s.clearCount" class="state clear">已通关 ×{{ s.clearCount }}</span>
          <span v-else class="state fresh">未挑战</span>
          <el-button
            type="primary"
            size="mini"
            :disabled="s.locked"
            :loading="busy === s.stageId"
            @click="challenge(s)"
          >
            挑战
          </el-button>
        </div>
      </div>
    </div>

    <BattleReportDialog ref="report" />
  </div>
</template>

<script>
import { apiStages, apiChallenge } from '../api';
import BattleReportDialog from './BattleReportDialog.vue';

export default {
  name: 'TowerPanel',
  components: { BattleReportDialog },
  data() {
    return { stages: [], unlocked: 0, loading: true, busy: 0, repeatPct: 30 };
  },
  created() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;
      try {
        const data = await apiStages();
        this.stages = data.stages;
        this.unlocked = data.unlocked;
        if (data.stages.length) this.repeatPct = Math.round(data.stages[0].repeatRewardRate * 100);
      } catch (e) { /* 已提示 */ } finally {
        this.loading = false;
      }
    },
    async challenge(stage) {
      this.busy = stage.stageId;
      try {
        const data = await apiChallenge(stage.stageId);
        // 期间可能已切页签导致本组件被销毁，此时 $refs 为空，直接放弃弹窗即可
        if (this._isDestroyed) return;
        this.$store.commit('SET_PROFILE', data);
        if (this.$refs.report) this.$refs.report.open(data.challenge);
        this.load();
      } catch (e) { /* 已提示 */ } finally {
        if (!this._isDestroyed) this.busy = 0;
      }
    }
  }
};
</script>

<style lang="scss" scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 14px;
  flex-wrap: wrap;
  gap: 8px;
}

.tip { font-size: 12px; color: #8ba1b8; }

.stage-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 12px;
}

.stage-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(120, 200, 180, 0.16);
  border-radius: 6px;
  padding: 12px;
  transition: all 0.18s ease;

  &:hover { border-color: #35b39a; }
  &.cleared { border-color: rgba(217, 185, 106, 0.4); }
  &.locked {
    opacity: 0.45;
    filter: grayscale(0.6);
    &:hover { border-color: rgba(120, 200, 180, 0.16); }
  }
}

.stage-top {
  display: flex;
  align-items: center;
  gap: 8px;
}

.stage-no {
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 50%;
  font-size: 12px;
  background: rgba(53, 179, 154, 0.18);
  color: #4fd3b8;
}

.stage-name { font-size: 14px; color: #dfe9f3; }

.stage-monster {
  margin-top: 8px;
  font-size: 13px;
  color: #a9bccd;
  display: flex;
  align-items: center;
  gap: 6px;
}

.el-tag-mini {
  font-size: 11px;
  border: 1px solid;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 15px;
}

.stage-stat,
.stage-reward {
  font-size: 12px;
  color: #8ba1b8;
  margin-top: 6px;
  line-height: 1.6;
}

.stage-risk {
  font-size: 12px;
  color: #d4695c;
  margin-top: 4px;
}

.stage-foot {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-top: 10px;
}

.state {
  font-size: 12px;
  &.lock { color: rgba(139, 161, 184, 0.7); }
  &.clear { color: #d9b96a; }
  &.fresh { color: #4fd3b8; }
}
</style>
