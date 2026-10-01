<template>
  <div class="roots">
    <div class="head">
      <div class="xi-title" style="margin:0">五行灵根 · {{ role.rootTitle }}</div>
      <div class="meta">
        洗练花费随灵根值上升 · 同一条灵根每 {{ pityEvery }} 次必出「高于原值」的保底
      </div>
    </div>

    <!-- 待确认结果：服务端已经摇好并存着，这里只做选择 -->
    <div v-if="pending" class="pending">
      <div class="pending-title">
        「{{ pending.element }}」灵根洗练结果
        <el-tag v-if="pending.guaranteed" size="mini" type="warning" style="margin-left:8px">保底</el-tag>
      </div>
      <div class="compare">
        <div class="side old">
          <div class="label">原本</div>
          <div class="value" :style="{ color: colorOf(pending.element) }">{{ pending.oldValue }}</div>
        </div>
        <div class="arrow">→</div>
        <div class="side new">
          <div class="label">洗练出</div>
          <div class="value" :style="{ color: colorOf(pending.element) }">{{ pending.value }}</div>
        </div>
      </div>
      <div class="diff" :class="pending.value >= pending.oldValue ? 'up' : 'down'">
        {{ pending.value >= pending.oldValue ? '提升' : '下降' }}
        {{ Math.abs(pending.value - pending.oldValue) }} 点
        <span v-if="pending.cost" class="paid">（已耗灵石 {{ $num(pending.cost) }}）</span>
      </div>
      <div class="pending-actions">
        <el-button type="primary" :loading="saving" @click="confirm(true)">保存新灵根</el-button>
        <el-button :loading="saving" @click="confirm(false)">保留原本灵根</el-button>
      </div>
      <div class="pending-tip">保存后新数值立即生效；保留则维持原值，灵石不退还。</div>
    </div>

    <div class="root-grid">
      <div
        v-for="el in elements"
        :key="el"
        class="root-card"
        :class="{ 'is-main': el === derived.element }"
      >
        <div class="root-top">
          <span class="el-name" :style="{ color: colorOf(el) }">{{ el }}</span>
          <span v-if="el === derived.element" class="main-tag">主灵根</span>
        </div>

        <div class="root-value" :style="{ color: colorOf(el) }">{{ roots[el] || 0 }}</div>
        <div class="root-bar">
          <div class="fill" :style="{ width: (roots[el] || 0) / maxValue * 100 + '%', background: colorOf(el) }"></div>
        </div>

        <div class="pity">
          <template v-if="(roots[el] || 0) >= maxValue">已至圆满</template>
          <template v-else>再洗 {{ untilPity(el) }} 次必出更高值</template>
        </div>

        <el-button
          size="mini"
          type="primary"
          plain
          style="width:100%"
          :disabled="!canReroll(el)"
          :loading="rolling === el"
          @click="reroll(el)"
        >
          {{ buttonText(el) }}
        </el-button>
      </div>
    </div>

    <div class="hint">
      洗练只影响选中的那一条灵根。数值区间 {{ minValue }}–{{ maxValue }}。
      灵根越集中，斗法越强：每条灵根都会单独和对手五行判定克制，单灵根不被低值灵根稀释，混沌灵根另有额外优势。
      想改成单灵根，可以用坊市的「散灵丹」把某条灵根直接散为 0。
    </div>
  </div>
</template>

<script>
import { mapGetters, mapState } from 'vuex';
import { apiRerollRoot, apiConfirmRoot } from '../api';

export default {
  name: 'RootPanel',
  data() {
    return { rolling: '', saving: false };
  },
  computed: {
    ...mapState(['config']),
    ...mapGetters(['role', 'derived']),
    elements() {
      return (this.config && this.config.world.elements) || ['金', '木', '水', '火', '土'];
    },
    roots() {
      return this.role.roots || {};
    },
    costs() {
      return this.role.rootCosts || {};
    },
    pending() {
      return this.role.rootPending || null;
    },
    pityEvery() {
      return (this.config && this.config.world.rootPityEvery) || 5;
    },
    minValue() {
      return (this.config && this.config.world.rootRoll && this.config.world.rootRoll.min) || 5;
    },
    maxValue() {
      return (this.config && this.config.world.rootRoll && this.config.world.rootRoll.max) || 95;
    }
  },
  methods: {
    colorOf(el) {
      const colors = (this.config && this.config.world.elementColors) || {};
      return colors[el] || '#dfe9f3';
    },
    costOf(el) {
      // 花费随该灵根当前值递增，具体数额由服务端下发，前端不重复实现公式
      return this.costs[el] || 0;
    },
    untilPity(el) {
      const count = (this.role.rootPity && this.role.rootPity[el]) || 0;
      const left = this.pityEvery - (count % this.pityEvery);
      return left === 0 ? this.pityEvery : left;
    },
    canReroll(el) {
      if (this.pending) return false;
      if ((this.roots[el] || 0) >= this.maxValue) return false;
      return this.role.spiritStone >= this.costOf(el);
    },
    buttonText(el) {
      if (this.pending) return '先处理上一条';
      if ((this.roots[el] || 0) >= this.maxValue) return '已圆满';
      if (this.role.spiritStone < this.costOf(el)) return `洗练（需 ${this.$num(this.costOf(el))}）`;
      return `洗练（${this.$num(this.costOf(el))} 灵石）`;
    },
    async reroll(el) {
      this.rolling = el;
      try {
        const data = await apiRerollRoot(el);
        this.$store.commit('SET_PROFILE', data);
        // 不弹提示：上方「待确认」卡片就是结果反馈，右侧行迹另有留档
      } catch (e) { /* 已提示 */ } finally {
        this.rolling = '';
      }
    },
    async confirm(save) {
      this.saving = true;
      try {
        const data = await apiConfirmRoot(save);
        this.$store.commit('SET_PROFILE', data);
      } catch (e) { /* 已提示 */ } finally {
        this.saving = false;
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

.meta {
  font-size: 12px;
  color: #8ba1b8;
  b { color: #d9b96a; }
}

.pending {
  margin-bottom: 16px;
  padding: 16px;
  border: 1px solid rgba(217, 185, 106, 0.45);
  border-radius: 8px;
  background: rgba(217, 185, 106, 0.08);
  text-align: center;
}

.pending-title {
  font-size: 14px;
  color: #d9b96a;
  letter-spacing: 1px;
}

.compare {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 28px;
  margin: 14px 0 6px;
}

.side {
  .label { font-size: 12px; color: #8ba1b8; }
  .value { font-size: 30px; font-variant-numeric: tabular-nums; }
  &.old .value { opacity: 0.6; }
}

.arrow { font-size: 20px; color: #8ba1b8; }

.diff {
  font-size: 13px;
  margin-bottom: 12px;
  &.up { color: #4fd3b8; }
  &.down { color: #d4695c; }
  .paid { color: rgba(139, 161, 184, 0.8); font-size: 12px; }
}

.pending-actions { display: flex; justify-content: center; gap: 10px; }

.pending-tip {
  margin-top: 10px;
  font-size: 12px;
  color: rgba(139, 161, 184, 0.8);
}

.root-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(170px, 1fr));
  gap: 12px;
}

.root-card {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(120, 200, 180, 0.16);
  border-radius: 6px;
  padding: 12px;
  transition: border-color 0.18s ease;

  &:hover { border-color: #35b39a; }
  &.is-main { border-color: rgba(217, 185, 106, 0.45); }
}

.root-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.el-name { font-size: 16px; }

.main-tag {
  font-size: 11px;
  color: #d9b96a;
  border: 1px solid rgba(217, 185, 106, 0.45);
  border-radius: 3px;
  padding: 0 4px;
}

.root-value {
  font-size: 26px;
  text-align: center;
  margin: 6px 0;
  font-variant-numeric: tabular-nums;
}

.root-bar {
  height: 6px;
  background: rgba(255, 255, 255, 0.07);
  border-radius: 3px;
  overflow: hidden;

  .fill { height: 100%; border-radius: 3px; transition: width 0.4s ease; }
}

.pity {
  font-size: 11px;
  color: #8ba1b8;
  text-align: center;
  margin: 8px 0;
  min-height: 16px;
}

.hint {
  margin-top: 14px;
  font-size: 12px;
  color: rgba(139, 161, 184, 0.8);
  line-height: 1.8;
}
</style>
