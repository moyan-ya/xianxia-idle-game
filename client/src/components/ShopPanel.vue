<template>
  <div class="shop">
    <div class="head">
      <div class="xi-title" style="margin:0">坊市 · 以灵石易物</div>
      <div class="stone-line">
        囊中灵石：<b class="jade">{{ $num(liveStone) }}</b>
        <span class="realm">当前境界：<b>{{ realmName }}</b></span>
      </div>
    </div>

    <div class="filter">
      <el-radio-group v-model="typeFilter" size="mini">
        <el-radio-button label="all">全部（{{ items.length }}）</el-radio-button>
        <el-radio-button v-for="t in typeOrder" :key="t" :label="t">
          {{ typeName[t] }}（{{ countByType(t) }}）
        </el-radio-button>
      </el-radio-group>
      <el-checkbox v-model="onlyMyRealm" style="margin-left:12px">只看本境界</el-checkbox>
    </div>

    <el-table :data="shown" v-loading="loading" style="width:100%" :row-class-name="rowClass">
      <el-table-column label="物品" min-width="200">
        <template slot-scope="s">
          <div class="cell-item">
            <span class="mini-icon" :class="'rarity-' + s.row.rarity">{{ s.row.icon }}</span>
            <div>
              <div :class="'rarity-' + s.row.rarity">
                {{ s.row.name }}
                <el-tag v-if="s.row.immediate" size="mini" type="success" style="margin-left:6px">买入即用</el-tag>
                <el-tag v-else-if="s.row.type === 'breakStone' && s.row.realmMatch" size="mini" type="info" style="margin-left:6px">已满 100%</el-tag>
              </div>
              <div class="cell-desc">{{ s.row.desc }}</div>
              <div v-if="s.row.immediate" class="cell-extra">
                本境界可叠加参悟，最多再买 <b>{{ s.row.maxUseful }}</b> 颗即满（多买不收钱）
              </div>
            </div>
          </div>
        </template>
      </el-table-column>
      <el-table-column label="品阶" width="92">
        <template slot-scope="s">
          <span :class="'rarity-' + s.row.rarity">{{ rarityName[s.row.rarity] }} · {{ typeName[s.row.type] }}</span>
        </template>
      </el-table-column>
      <el-table-column label="对应境界" width="100">
        <template slot-scope="s">
          <span v-if="s.row.realmName" :class="{ 'same-realm': s.row.realm === currentRealm }">
            {{ s.row.realmName }}<span v-if="s.row.realm === currentRealm" class="now">（当前）</span>
          </span>
          <span v-else class="dim">—</span>
        </template>
      </el-table-column>
      <el-table-column label="效用" min-width="170">
        <template slot-scope="s"><span class="eff">{{ $effect(s.row.effect) }}</span></template>
      </el-table-column>
      <el-table-column label="售价" width="120" align="right">
        <template slot-scope="s"><span class="gold">{{ $num(s.row.price) }}</span></template>
      </el-table-column>
      <el-table-column label="回收" width="110" align="right">
        <template slot-scope="s"><span class="dim">{{ $num(s.row.sellPrice) }}</span></template>
      </el-table-column>
      <el-table-column label="已有" width="60" align="right">
        <template slot-scope="s">{{ s.row.owned }}</template>
      </el-table-column>
      <el-table-column label="操作" width="190" align="right">
        <template slot-scope="s">
          <el-input-number
            v-model="s.row.buyNum"
            :min="1"
            :max="maxBuy(s.row)"
            size="mini"
            controls-position="right"
            style="width:78px"
          />
          <el-button
            type="primary"
            size="mini"
            style="margin-left:8px"
            :disabled="!canBuy(s.row)"
            @click="buy(s.row)"
          >
            {{ buyLabel(s.row) }}
          </el-button>
        </template>
      </el-table-column>
    </el-table>

    <div class="hint">
      「回收」是背包里出售该物品能拿回的灵石（市价 {{ sellPct }}%）。
      <span class="gold">悟道石</span>与本境界相符时买入即刻参悟（每颗 +5%，硬上限 100%，<b>突破成功一次后加成即散</b>），
      可一次买多颗叠加但只按用得上的数量收钱；与本境界不相符则进背包，留到对应境界再参悟。
      法宝与功法共八档，一一对应八个大境界，越往后的档位越贵。
    </div>
  </div>
</template>

<script>
import { mapGetters, mapState } from 'vuex';
import { apiShopList, apiShopBuy } from '../api';
import { RARITY_NAME, TYPE_NAME } from '../utils/format';

const TYPE_ORDER = ['artifact', 'skill', 'pill', 'breakStone', 'rootReset'];

export default {
  name: 'ShopPanel',
  data() {
    return {
      items: [],
      loading: true,
      realmName: '',
      currentRealm: 0,
      typeFilter: 'all',
      onlyMyRealm: false,
      typeOrder: TYPE_ORDER,
      rarityName: RARITY_NAME,
      typeName: TYPE_NAME
    };
  },
  computed: {
    ...mapState(['config']),
    ...mapGetters(['liveStone']),
    sellPct() {
      const rate = (this.config && this.config.world.sellRate) || 0.7;
      return Math.round(rate * 100);
    },
    shown() {
      let list = this.items;
      if (this.typeFilter !== 'all') list = list.filter((i) => i.type === this.typeFilter);
      if (this.onlyMyRealm) list = list.filter((i) => i.realm === null || i.realm === this.currentRealm);
      return list;
    }
  },
  created() {
    this.load();
  },
  methods: {
    countByType(t) {
      return this.items.filter((i) => i.type === t).length;
    },
    rowClass({ row }) {
      return row.immediate ? 'now-row' : '';
    },
    async load() {
      this.loading = true;
      try {
        const data = await apiShopList();
        this.items = data.items.map((i) => Object.assign({ buyNum: 1 }, i));
        this.realmName = data.realmName;
        this.currentRealm = data.realm;
      } catch (e) { /* 已提示 */ } finally {
        this.loading = false;
      }
    },
    /** 悟道石与本境界相符时把上限压到"用得上的颗数"，从源头避免买超 */
    maxBuy(row) {
      if (row.immediate && row.maxUseful) return Math.max(1, row.maxUseful);
      return 99;
    },
    canBuy(row) {
      return !(row.type === 'breakStone' && row.realmMatch && row.maxUseful === 0);
    },
    buyLabel(row) {
      if (row.immediate) return '购入参悟';
      if (row.type === 'breakStone' && row.realmMatch) return '已满';
      return '购入';
    },
    /** 不弹成功提示：右侧「行迹」会记录这次购买与成功率变化 */
    async buy(row) {
      const num = row.buyNum || 1;
      try {
        const data = await apiShopBuy(row.itemId, num);
        this.$store.commit('SET_PROFILE', data);
        if (data.bought.clamped) {
          this.$message.warning(
            `只需 ${data.bought.num} 颗就到 100%，已按 ${data.bought.num} 颗结算，其余灵石未扣`
          );
        }
        this.load();
      } catch (e) { /* 已提示 */ }
    }
  }
};
</script>

<style lang="scss" scoped>
.head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 0 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.stone-line {
  font-size: 13px;
  color: #8ba1b8;

  b.jade { color: #4fd3b8; font-variant-numeric: tabular-nums; }
  .realm { margin-left: 14px; b { color: #d9b96a; } }
}

.filter {
  display: flex;
  align-items: center;
  margin-bottom: 12px;
  flex-wrap: wrap;
  gap: 8px;
}

.cell-item {
  display: flex;
  align-items: center;
  gap: 10px;
}

.mini-icon {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  line-height: 28px;
  text-align: center;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 13px;
}

.cell-desc { font-size: 12px; color: #8ba1b8; line-height: 1.5; }
.cell-extra {
  font-size: 11px;
  color: #6fd6b8;
  margin-top: 3px;
  b { color: #4fd3b8; }
}

.eff { font-size: 12px; color: #a9bccd; }
.gold { color: #d9b96a; font-variant-numeric: tabular-nums; }
.dim { color: #8ba1b8; font-variant-numeric: tabular-nums; }
.same-realm { color: #4fd3b8; }
.now { font-size: 11px; color: rgba(79, 211, 184, 0.8); }

.hint {
  margin-top: 12px;
  font-size: 12px;
  color: rgba(139, 161, 184, 0.75);
  line-height: 1.8;
  b { color: #d9b96a; }
}
</style>
