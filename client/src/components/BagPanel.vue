<template>
  <div class="bag">
    <div class="head">
      <div class="xi-title" style="margin:0">储物袋 · {{ rootTitle }}</div>
      <div class="equip-line">
        <span>法宝：<b :class="equip.artifact ? 'rarity-' + equip.artifact.rarity : ''">{{ equip.artifact ? equip.artifact.name : '空' }}</b></span>
        <span>功法：<b :class="equip.skill ? 'rarity-' + equip.skill.rarity : ''">{{ equip.skill ? equip.skill.name : '空' }}</b></span>
        <el-button v-if="equip.artifact" type="text" @click="unequip('artifact')">卸下法宝</el-button>
        <el-button v-if="equip.skill" type="text" @click="unequip('skill')">卸下功法</el-button>
      </div>
    </div>

    <div v-if="loading" class="xi-empty">正在翻找储物袋...</div>
    <div v-else-if="!items.length" class="xi-empty">储物袋空空如也，去坊市转转吧</div>

    <div v-else class="item-grid">
      <div
        v-for="it in items"
        :key="it.itemId"
        class="item-card"
        :class="{ equipped: it.equipped, locked: it.usableNow === false }"
      >
        <div class="item-num">×{{ $num(it.num) }}</div>
        <div class="item-icon" :class="'rarity-' + it.rarity">{{ it.icon }}</div>
        <div class="item-name" :class="'rarity-' + it.rarity">
          {{ it.name }}
          <el-tag v-if="it.equipped" size="mini" style="margin-left:6px">已装备</el-tag>
        </div>
        <div class="item-desc">{{ it.desc }}</div>
        <div v-if="it.lockedReason" class="locked-tip">{{ it.lockedReason }}</div>
        <div class="item-foot">
          <span class="eff">{{ $effect(it.effect) }}</span>
        </div>
        <div class="item-foot">
          <span class="rarity-tag" :class="'rarity-' + it.rarity">{{ rarityName[it.rarity] }} · {{ typeName[it.type] }}</span>
          <span v-if="it.canSell" class="sell-hint">回收 {{ $num(it.sellPrice) }}/件</span>
        </div>
        <div class="item-actions">
          <el-button v-if="it.type === 'pill'" type="text" @click="usePill(it)">服用</el-button>
          <el-button v-else-if="it.type === 'breakStone'" type="text" :disabled="!it.usableNow" @click="useStone(it)">参悟</el-button>
          <el-button v-else-if="it.type === 'rootReset'" type="text" @click="openReset(it)">服用</el-button>
          <el-button v-else-if="!it.equipped" type="text" @click="equipItem(it)">装备</el-button>
          <el-button v-else type="text" @click="unequip(it.type)">卸下</el-button>
          <el-button v-if="it.canSell" type="text" class="sell-btn" @click="sell(it)">出售</el-button>
        </div>
      </div>
    </div>

    <!-- 散灵丹：选一条灵根散为 0 -->
    <el-dialog :title="`${resetItem ? resetItem.name : ''} · 选择要散去的灵根`" :visible.sync="resetVisible" width="440px">
      <div class="reset-tip">灵根一旦散去便不可逆，但之后仍可花费灵石重新洗练回来。</div>
      <el-radio-group v-model="resetElement" class="reset-group">
        <el-radio
          v-for="el in elements"
          :key="el"
          :label="el"
          :disabled="(roots[el] || 0) <= 0"
          border
        >
          <span :style="{ color: colorOf(el) }">{{ el }}</span>
          <span class="cur">{{ roots[el] || 0 }}</span>
        </el-radio>
      </el-radio-group>
      <div class="reset-tip small">
        当前道体：<b>{{ rootTitle }}</b> —— 散去后灵根更集中，斗法伤害的计算结果会随之改变。
      </div>
      <template slot="footer">
        <el-button @click="resetVisible = false">再想想</el-button>
        <el-button type="danger" :loading="resetting" :disabled="!resetElement" @click="confirmReset">散去</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script>
import { mapGetters, mapState } from 'vuex';
import { apiBagList, apiBagUse, apiBagEquip, apiBagUnequip, apiBagSell } from '../api';
import { RARITY_NAME, TYPE_NAME } from '../utils/format';

export default {
  name: 'BagPanel',
  data() {
    return {
      items: [],
      loading: true,
      rarityName: RARITY_NAME,
      typeName: TYPE_NAME,
      resetVisible: false,
      resetItem: null,
      resetElement: '',
      resetting: false
    };
  },
  computed: {
    ...mapState(['config']),
    ...mapGetters(['equip', 'role']),
    elements() {
      return (this.config && this.config.world.elements) || ['金', '木', '水', '火', '土'];
    },
    roots() {
      return this.role.roots || {};
    },
    rootTitle() {
      return this.role.rootTitle;
    }
  },
  created() {
    this.load();
  },
  methods: {
    colorOf(el) {
      const colors = (this.config && this.config.world.elementColors) || {};
      return colors[el] || '#dfe9f3';
    },
    async load() {
      this.loading = true;
      try {
        const data = await apiBagList();
        this.items = data.items;
      } catch (e) { /* 已提示 */ } finally {
        this.loading = false;
      }
    },
    /** 成功类提示一律不弹：右侧「行迹」就是行动记录的唯一出口 */
    async usePill(item) {
      try {
        const data = await apiBagUse(item.itemId, 1);
        this.$store.commit('SET_PROFILE', data);
        this.load();
      } catch (e) { /* 已提示 */ }
    },
    async useStone(item) {
      try {
        const data = await apiBagUse(item.itemId, 1);
        this.$store.commit('SET_PROFILE', data);
        this.load();
      } catch (e) { /* 已提示 */ }
    },
    async equipItem(item) {
      try {
        const data = await apiBagEquip(item.itemId);
        this.$store.commit('SET_PROFILE', data);
        this.load();
      } catch (e) { /* 已提示 */ }
    },
    async unequip(type) {
      try {
        const data = await apiBagUnequip(type);
        this.$store.commit('SET_PROFILE', data);
        this.load();
      } catch (e) { /* 已提示 */ }
    },
    openReset(item) {
      this.resetItem = item;
      this.resetElement = '';
      this.resetVisible = true;
    },
    async confirmReset() {
      if (!this.resetElement) return;
      const el = this.resetElement;
      const cur = this.roots[el] || 0;

      // 二次确认：散灵丹不可逆，值得再问一次
      try {
        await this.$confirm(
          `${el} 灵根当前 ${cur} 点，散去后直接归零，且不可撤销（只能之后重新花灵石一点点洗回来）。确定要散去吗？`,
          '再确认一次',
          { confirmButtonText: '确认散去', cancelButtonText: '再想想', type: 'warning' }
        );
      } catch (e) {
        return; // 玩家取消
      }

      this.resetting = true;
      try {
        const data = await apiBagUse(this.resetItem.itemId, 1, el);
        this.$store.commit('SET_PROFILE', data);
        this.resetVisible = false;
        this.load();
      } catch (e) { /* 已提示 */ } finally {
        this.resetting = false;
      }
    },
    /** 出售：按市价 7 成回收灵石，数量由玩家指定 */
    async sell(item) {
      if (item.equipped) {
        this.$message.warning('请先卸下装备再出售');
        return;
      }
      try {
        const { value } = await this.$prompt(
          `市价 ${item.price} 灵石，按 ${Math.round(item.sellRate * 100)}% 回收，单价 ${item.sellPrice} 灵石；你有 ${item.num} 件。`,
          `出售 ${item.name}`,
          {
            confirmButtonText: '出售',
            cancelButtonText: '算了',
            inputValue: '1',
            inputPattern: /^[1-9]\d{0,2}$/,
            inputErrorMessage: '请输入 1-999 的整数'
          }
        );
        const data = await apiBagSell(item.itemId, Number(value));
        this.$store.commit('SET_PROFILE', data);
        this.load();
      } catch (e) { /* 取消或已提示 */ }
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
  border-bottom: 1px solid rgba(255, 255, 255, 0.06);
  margin-bottom: 14px;
  flex-wrap: wrap;
  gap: 8px;
}

.equip-line {
  font-size: 13px;
  color: #8ba1b8;
  display: flex;
  align-items: center;
  gap: 16px;

  b { color: #dfe9f3; }
}

.eff { color: #8ba1b8; }
.rarity-tag { font-size: 12px; }
.sell-hint { font-size: 11px; color: rgba(139, 161, 184, 0.85); }

.item-card.locked { opacity: 0.72; }

.locked-tip {
  font-size: 11px;
  color: #d9a86a;
  margin-top: 4px;
}

.item-actions {
  display: flex;
  justify-content: flex-end;
  gap: 2px;
  margin-top: 6px;
  border-top: 1px dashed rgba(255, 255, 255, 0.07);
  padding-top: 6px;
}

.sell-btn { color: #d9b96a !important; }

.reset-tip {
  font-size: 12px;
  color: #8ba1b8;
  line-height: 1.7;
  margin-bottom: 10px;

  &.small { margin-top: 12px; margin-bottom: 0; }
  b { color: #d9b96a; }
}

.reset-group {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;

  .el-radio { margin: 0; width: 100%; }
  .cur { margin-left: 8px; color: #8ba1b8; }
}
</style>
