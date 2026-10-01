<template>
  <div class="role-panel">
    <div class="xi-panel">
      <div class="xi-realm">{{ role.realmName }}</div>
      <div class="realm-line">
        <span>{{ role.realmLevel }} / {{ levelsPerRealm }} 层</span>
        <span class="desc">{{ role.realmDesc }}</span>
      </div>

      <div class="xi-title" style="margin-top:16px">修为</div>
      <el-progress :percentage="expPercent" :show-text="false" :stroke-width="10" />
      <div class="exp-text">{{ $num(liveExp) }} / {{ $num(role.expNeed) }}</div>
      <el-button
        type="primary"
        size="small"
        style="width:100%;margin-top:10px"
        :disabled="!canBreak"
        :loading="breaking"
        @click="doBreakthrough"
      >
        {{ canBreak ? `冲击 ${role.realmLevel === levelsPerRealm ? '下一境界' : (role.realmLevel + 1) + ' 层'}` : '修为不足' }}
      </el-button>
      <div class="rate-tip">
        成功率 {{ $pct(derived.breakRate) }}<span v-if="derived.breakBonus">（含悟道石 +{{ Math.round(derived.breakBonus * 100) }}%）</span><span v-if="role.breakPity">（保底 +{{ role.breakPity }} 次）</span>
      </div>
      <!-- 突破结果就地显示，不再弹顶部提示（右侧行迹里同时留档） -->
      <transition name="el-fade-in">
        <div v-if="lastResult" class="break-result" :class="lastResult.ok ? 'ok' : 'bad'">
          {{ lastResult.text }}
        </div>
      </transition>
    </div>

    <div class="xi-panel" style="margin-top:12px">
      <div class="xi-title">道体</div>
      <div class="xi-stat"><span class="label">灵根</span><span class="value" :style="{ color: derived.elementColor }">{{ role.rootTitle }}</span></div>
      <div class="xi-stat"><span class="label">主灵根</span><span class="value" :style="{ color: derived.elementColor }">{{ derived.element }} · {{ derived.mainRoot.value }}</span></div>
      <div class="xi-stat"><span class="label">攻击</span><span class="value">{{ $exact(derived.atk) }}</span></div>
      <div class="xi-stat"><span class="label">防御</span><span class="value">{{ $exact(derived.def) }}</span></div>
      <div class="xi-stat"><span class="label">气血</span><span class="value">{{ $exact(derived.hp) }}</span></div>
      <div class="xi-stat"><span class="label">身法</span><span class="value">{{ derived.speed }}</span></div>
      <div class="xi-stat"><span class="label">灵石产出</span><span class="value jade">{{ $rate(derived.stonePerSec) }} / 秒</span></div>
      <div class="xi-stat"><span class="label">洞府</span><span class="value gold">{{ derived.cave.level }} 级（+{{ Math.round(derived.cave.stoneBonus * 100) }}%）</span></div>
      <div class="xi-stat"><span class="label">累计突破</span><span class="value">{{ role.totalBreak }} 次</span></div>
    </div>

    <div class="xi-panel" style="margin-top:12px">
      <div class="xi-title">五行灵根</div>
      <div v-for="el in elements" :key="el" class="root-row">
        <span class="root-name" :style="{ color: elementColors[el] }">{{ el }}</span>
        <div class="root-bar">
          <div class="fill" :style="{ width: (role.roots[el] || 0) + '%', background: elementColors[el] }"></div>
        </div>
        <span class="root-val">{{ role.roots[el] || 0 }}</span>
      </div>
      <el-button type="text" size="mini" style="padding:0" @click="gotoRoots">去洗练灵根 →</el-button>
    </div>

    <div class="xi-panel" style="margin-top:12px">
      <div class="xi-title">法宝 / 功法</div>
      <div class="slot">
        <span class="slot-label">法宝</span>
        <span v-if="equip.artifact" class="slot-val" :class="'rarity-' + equip.artifact.rarity">{{ equip.artifact.name }}</span>
        <span v-else class="slot-empty">空</span>
      </div>
      <div class="slot">
        <span class="slot-label">功法</span>
        <span v-if="equip.skill" class="slot-val" :class="'rarity-' + equip.skill.rarity">{{ equip.skill.name }}</span>
        <span v-else class="slot-empty">空</span>
      </div>
      <div class="bonus-line">
        加成：灵石产出 +{{ Math.round((derived.bonus.stoneBonus || 0) * 100) }}% · 攻击 +{{ derived.bonus.atk || 0 }} · 防御 +{{ derived.bonus.def || 0 }} · 气血 +{{ derived.bonus.hp || 0 }}
      </div>
    </div>
  </div>
</template>

<script>
import { mapGetters, mapState } from 'vuex';
import { apiBreakthrough } from '../api';

export default {
  name: 'RolePanel',
  data() {
    return { breaking: false, lastResult: null, resultTimer: null };
  },
  computed: {
    ...mapState(['config']),
    ...mapGetters(['role', 'derived', 'equip', 'liveExp']),
    elements() {
      return (this.config && this.config.world.elements) || ['金', '木', '水', '火', '土'];
    },
    elementColors() {
      return (this.config && this.config.world.elementColors) || {};
    },
    levelsPerRealm() {
      return (this.config && this.config.levelsPerRealm) || 9;
    },
    expPercent() {
      if (!this.role || !this.role.expNeed) return 0;
      return Math.min(100, Math.floor((this.liveExp / this.role.expNeed) * 100));
    },
    canBreak() {
      return this.liveExp >= this.role.expNeed && !this.role.isMaxRealm;
    }
  },
  methods: {
    /** 组件嵌在 el-tabs 深处，用根事件通知外层切页签 */
    gotoTroots() {
      this.$root.$emit('switch-tab', 'roots');
    },
    async doBreakthrough() {
      if (this.breaking) return;
      this.breaking = true;
      try {
        const data = await apiBreakthrough();
        this.$store.commit('SET_PROFILE', data);
        const r = data.breakthrough;
        // 结果就地显示，不再弹顶部提示；右侧行迹里也有一条留档
        this.lastResult = { ok: r.success, text: r.message };
        clearTimeout(this.resultTimer);
        this.resultTimer = setTimeout(() => { this.lastResult = null; }, 9000);
      } catch (e) {
        /* 拦截器已提示 */
      } finally {
        this.breaking = false;
      }
    }
  },
  beforeDestroy() {
    clearTimeout(this.resultTimer);
  }
};
</script>

<style lang="scss" scoped>
.realm-line {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  color: #8ba1b8;
  padding: 0 2px;

  .desc { color: rgba(139, 161, 184, 0.75); }
}

.exp-text {
  text-align: right;
  font-size: 12px;
  color: #8ba1b8;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.rate-tip {
  margin-top: 8px;
  font-size: 12px;
  color: #8ba1b8;
  text-align: center;
}

.break-result {
  margin-top: 8px;
  padding: 8px 10px;
  font-size: 12px;
  line-height: 1.6;
  border-radius: 4px;
  border-left: 2px solid;

  &.ok {
    color: #8ff0da;
    background: rgba(53, 179, 154, 0.12);
    border-color: #4fd3b8;
  }
  &.bad {
    color: #f0b3ac;
    background: rgba(200, 90, 80, 0.12);
    border-color: #d4695c;
  }
}

.root-row {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
  font-size: 12px;
}

.root-name { width: 14px; }

.root-bar {
  flex: 1;
  height: 6px;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 3px;
  overflow: hidden;

  .fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
}

.root-val { width: 24px; text-align: right; color: #8ba1b8; font-variant-numeric: tabular-nums; }

.slot {
  display: flex;
  justify-content: space-between;
  font-size: 13px;
  padding: 5px 0;

  .slot-label { color: #8ba1b8; }
  .slot-empty { color: rgba(139, 161, 184, 0.5); }
}

.bonus-line {
  margin-top: 8px;
  font-size: 12px;
  color: #8ba1b8;
  line-height: 1.6;
}
</style>
