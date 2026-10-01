<template>
  <div class="action-feed xi-panel">
    <div class="xi-title">行迹</div>
    <div class="sub">每一次出手都会记在这里</div>

    <div v-if="!actions.length" class="xi-empty" style="padding:24px 0">尚无行动</div>

    <div v-else class="feed">
      <div v-for="(a, i) in actions" :key="i" class="feed-item">
        <span class="dot" :class="'t-' + a.type"></span>
        <div class="body">
          <div class="text">{{ a.text }}</div>
          <div class="time">{{ shortTime(a.created_at) }}</div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapGetters } from 'vuex';

export default {
  name: 'ActionFeed',
  computed: {
    ...mapGetters(['actions'])
  },
  methods: {
    shortTime(value) {
      if (!value) return '';
      // 后端返回 "YYYY-MM-DD HH:mm:ss"，这里只留 月-日 时:分
      const m = String(value).match(/^\d{4}-(\d{2}-\d{2})[ T](\d{2}:\d{2})/);
      return m ? `${m[1]} ${m[2]}` : value;
    }
  }
};
</script>

<style lang="scss" scoped>
.sub {
  font-size: 12px;
  color: #8ba1b8;
  margin: -6px 0 12px;
}

.feed {
  max-height: calc(100vh - 260px);
  overflow-y: auto;
  padding-right: 4px;
}

.feed-item {
  display: flex;
  gap: 8px;
  padding: 8px 0;
  border-bottom: 1px dashed rgba(255, 255, 255, 0.06);

  &:last-child { border-bottom: none; }
}

.dot {
  flex: 0 0 6px;
  width: 6px;
  height: 6px;
  border-radius: 50%;
  margin-top: 6px;
  background: #4fd3b8;

  &.t-shop { background: #6fb2e0; }
  &.t-battle { background: #d4695c; }
  &.t-cave { background: #d9b96a; }
  &.t-breakthrough { background: #b98fe0; }
  &.t-use { background: #7fc47f; }
  &.t-reroll { background: #e0a03c; }
  &.t-sell { background: #9fb0c0; }
  &.t-equip { background: #4fd3b8; }
  &.t-init { background: #ffd76e; }
  &.t-settle { background: rgba(139, 161, 184, 0.7); }
}

.body { flex: 1; min-width: 0; }

.text {
  font-size: 12px;
  line-height: 1.6;
  color: #cfdcea;
  word-break: break-all;
}

.time {
  font-size: 11px;
  color: rgba(139, 161, 184, 0.7);
  margin-top: 2px;
}
</style>
