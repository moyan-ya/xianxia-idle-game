<template>
  <div class="cultivate">
    <div class="xi-panel">
      <div class="xi-title">洞府修炼</div>
      <p class="narrative">
        你在洞府之中盘膝而坐，地脉灵气自四方汇入，凝作灵石堆于身侧。天地无声，唯有道心在缓缓转动。
      </p>
      <div class="grid">
        <div class="cell">
          <div class="cell-label">灵石产出</div>
          <div class="cell-value jade">{{ $rate(derived.stonePerSec) }} <small>灵石/秒</small></div>
        </div>
        <div class="cell">
          <div class="cell-label">每小时修为</div>
          <div class="cell-value gold">{{ $num(expPerHour) }} <small>点</small></div>
        </div>
        <div class="cell">
          <div class="cell-label">闭关上限</div>
          <div class="cell-value">{{ (settle && settle.maxHours) || 12 }} <small>小时</small></div>
        </div>
        <div class="cell">
          <div class="cell-label">上次结算</div>
          <div class="cell-value">
            {{ $num(settle ? settle.gainedStone : 0) }}
            <small>{{ settle ? settle.seconds : 0 }} 秒的收益</small>
          </div>
        </div>
      </div>
      <div class="hint">
        离线也会持续产出；超过 {{ (settle && settle.maxHours) || 12 }} 小时的部分按两成折算。
        每 60 秒自动结算一次，页面上的数字在两次结算之间是本地平滑插值。
      </div>
    </div>

    <div class="two-col">
      <div class="xi-panel">
        <div class="xi-title">洞府升级</div>
        <div class="xi-stat"><span class="label">当前等级</span><span class="value gold">{{ derived.cave.level }} 级</span></div>
        <div class="xi-stat"><span class="label">灵石加成</span><span class="value jade">+{{ Math.round(derived.cave.stoneBonus * 100) }}%</span></div>
        <template v-if="derived.cave.next">
          <div class="xi-stat"><span class="label">下一等级</span><span class="value">{{ derived.cave.next.level }} 级</span></div>
          <div class="xi-stat"><span class="label">提升至</span><span class="value jade">+{{ Math.round(derived.cave.next.stoneBonus * 100) }}%</span></div>
          <div class="xi-stat"><span class="label">需灵石</span><span class="value" :class="{ gold: canUpgrade }">{{ $num(derived.cave.next.costStone) }}</span></div>
          <el-button type="primary" style="width:100%;margin-top:12px" :disabled="!canUpgrade" :loading="upgrading" @click="doUpgrade">
            {{ canUpgrade ? '开辟洞府' : '灵石不足' }}
          </el-button>
        </template>
        <div v-else class="xi-empty" style="padding:20px 0">洞府已至十级，再无扩建余地</div>
      </div>

      <div class="xi-panel">
        <div class="xi-title">斗法概览</div>
        <div class="xi-stat"><span class="label">道体</span><span class="value" :style="{ color: derived.elementColor }">{{ role.rootTitle }}</span></div>
        <div class="xi-stat"><span class="label">攻 / 防 / 气血 / 身法</span><span class="value">{{ derived.atk }} / {{ derived.def }} / {{ derived.hp }} / {{ derived.speed }}</span></div>
        <div class="pick">
          <span class="label">选一层看推演</span>
          <el-select v-model="stageId" size="mini" style="width:170px">
            <el-option v-for="s in list" :key="s.stageId" :label="`第${s.stageId}层 ${s.name}`" :value="s.stageId" />
          </el-select>
          <el-button type="text" size="mini" :loading="loadingPreview" @click="loadPreview">刷新</el-button>
        </div>
        <div v-if="cur" class="verdict" :class="verdictClass">
          {{ cur.damage.verdict }} · 预计 {{ cur.damage.roundsToKill }} 回合击杀，对方约 {{ cur.damage.roundsToDie }} 回合击倒你
        </div>
        <el-button type="primary" plain style="margin-top:12px;width:100%" @click="gotoTower">前往试炼塔</el-button>
      </div>
    </div>

    <!-- 伤害公式：完整推导过程，供玩家与旁观者查看 -->
    <div class="xi-panel" style="margin-top:12px">
      <div class="xi-title">伤害公式推导</div>

      <div v-if="loadingPreview" class="xi-empty">正在推演...</div>

      <template v-else-if="cur">
        <p class="formula-intro">
          规则：<b>每条灵根都会单独与对手五行判定克制</b>。
          贡献 = 克制系数 × 灵根值 / 满值({{ cur.constants.rootMax }})；
          攻击系数 = 贡献之和 ÷ 灵根条数 × 平衡系数({{ cur.constants.rootMulScale }})。
          所以灵根值越高越强，灵根条数越少越不被稀释；五条全满另有混沌加成({{ cur.constants.chaosMul }})。
        </p>

        <div class="target-line">
          目标：<b>{{ cur.monsterName }}</b>
          <span class="el-tag-mini" :style="{ color: colorOf(cur.element), borderColor: colorOf(cur.element) }">{{ cur.element }}</span>
          气血 {{ $num(cur.target.hp) }} · 攻 {{ $num(cur.target.atk) }} · 防 {{ $num(cur.target.def) }} · 身法 {{ cur.target.speed }}
        </div>

        <el-table :data="cur.attack.breakdown" size="mini" style="width:100%;margin-top:10px">
          <el-table-column label="我方灵根" width="90">
            <template slot-scope="s"><span :style="{ color: colorOf(s.row.element) }">{{ s.row.element }}</span></template>
          </el-table-column>
          <el-table-column label="灵根值" width="80" align="right" prop="value" />
          <el-table-column label="对该目标的克制系数" width="180">
            <template slot-scope="s">
              <span :class="s.row.factor > 1 ? 'up' : (s.row.factor < 1 ? 'down' : '')">
                ×{{ s.row.factor.toFixed(2) }}
                {{ s.row.factor > 1 ? '（克制）' : (s.row.factor < 1 ? '（受制）' : '（中性）') }}
              </span>
            </template>
          </el-table-column>
          <el-table-column label="贡献 = 系数 × 值 / 满值" min-width="200">
            <template slot-scope="s">
              {{ s.row.factor.toFixed(2) }} × {{ s.row.value }} / {{ cur.constants.rootMax }} =
              <b>{{ s.row.score.toFixed(4) }}</b>
            </template>
          </el-table-column>
        </el-table>

        <div class="derive">
          <template v-if="cur.attack.chaos">
            <div class="derive-line">
              混沌灵根：五条灵根全部圆满 → 直接取 混沌系数 {{ cur.constants.chaosMul }} × 平衡系数 {{ cur.constants.rootMulScale }}
              = <b>{{ cur.attack.mul.toFixed(4) }}</b>
            </div>
          </template>
          <template v-else-if="cur.attack.empty">
            <div class="derive-line">
              五条灵根全为 0（凡体）→ 取保底系数 <b>{{ cur.attack.mul.toFixed(4) }}</b>
            </div>
          </template>
          <template v-else>
            <div class="derive-line">
              贡献之和 {{ cur.attack.sum.toFixed(4) }} ÷ 灵根条数 {{ cur.attack.count }} = 平均 {{ cur.attack.avg.toFixed(4) }}
            </div>
            <div class="derive-line">
              平均 {{ cur.attack.avg.toFixed(4) }} × 平衡系数 {{ cur.constants.rootMulScale }} =
              <b>攻击灵根系数 {{ cur.attack.mul.toFixed(4) }}</b>
            </div>
          </template>

          <div class="derive-line dim">
            对方打我的灵根系数 = Σ(对方五行对我的克制) ÷ {{ cur.defend.count }} =
            <b>{{ cur.defend.mul.toFixed(4) }}</b>
            <span class="dim-note">（灵根越多越接近 1.0，单灵根则是把身家押在一种对抗关系上）</span>
          </div>

          <div class="derive-line">
            每击伤害 ≈ (攻击 {{ derived.atk }} × {{ cur.attack.mul.toFixed(4) }} − 目标防御 × {{ cur.constants.defFactor }})
            × 暴击期望(1 + {{ cur.constants.critRate }}×{{ cur.constants.critMul - 1 }})
            = <b class="gold">{{ cur.damage.playerHit }}</b>
            <span class="dim-note">（实际在 {{ cur.damage.playerHitRange[0] }} ~ {{ cur.damage.playerHitRange[1] }} 之间浮动）</span>
          </div>

          <div class="derive-line">
            承伤 ≈ (对方攻击 {{ $num(cur.target.atk) }} × {{ cur.defend.mul.toFixed(4) }} − 我方防御 {{ derived.def }} × {{ cur.constants.defFactor }})
            × 暴击期望 = <b class="down">{{ cur.damage.monsterHit }}</b>
          </div>

          <div class="derive-line">
            结果：{{ cur.damage.timeout ? '超过回合上限仍打不动' : (cur.damage.roundsToKill < cur.damage.roundsToDie ? '优势' : '劣势') }}
            · {{ cur.damage.roundsToKill }} 回合击杀 / 可撑 {{ cur.damage.roundsToDie }} 回合
          </div>
        </div>
      </template>

      <div v-else class="xi-empty">暂无推演数据</div>
    </div>

    <RealmPanel :preview-list="list" />
  </div>
</template>

<script>
import { mapGetters, mapState } from 'vuex';
import { apiUpgradeCave, apiPreviewAll } from '../api';
import RealmPanel from './RealmPanel.vue';

export default {
  name: 'CultivatePanel',
  components: { RealmPanel },
  data() {
    return { upgrading: false, loadingPreview: false, stageId: 1, list: [], constants: null };
  },
  computed: {
    ...mapState(['config', 'profile']),
    ...mapGetters(['role', 'derived', 'settle']),
    expPerHour() {
      const rate = (this.settle && this.settle.expRate) || 0.6;
      return this.derived.stonePerSec * rate * 3600;
    },
    canUpgrade() {
      const next = this.derived.cave.next;
      return !!next && this.role.spiritStone >= next.costStone;
    },
    cur() {
      return this.list.find((x) => x.stageId === this.stageId) || this.list[0] || null;
    },
    verdictClass() {
      if (!this.cur) return '';
      const v = this.cur.damage.verdict;
      if (v === '优势') return 'good';
      if (v === '打不动（超过回合上限）') return 'bad';
      return 'warn';
    },
    /** 攻防气血一变就重新推演，避免显示过期数字 */
    previewKey() {
      return [this.derived.atk, this.derived.def, this.derived.hp, JSON.stringify(this.role.roots)].join('|');
    }
  },
  watch: {
    previewKey() {
      this.loadPreview();
    }
  },
  created() {
    this.loadPreview();
  },
  methods: {
    colorOf(el) {
      const colors = (this.config && this.config.world.elementColors) || {};
      return colors[el] || '#dfe9f3';
    },
    gotoTower() {
      this.$root.$emit('switch-tab', 'tower');
    },
    async loadPreview() {
      this.loadingPreview = true;
      try {
        const data = await apiPreviewAll();
        this.list = data.list;
        if (data.list.length && !data.list.some((x) => x.stageId === this.stageId)) {
          this.stageId = data.list[0].stageId;
        }
      } catch (e) { /* 已提示 */ } finally {
        this.loadingPreview = false;
      }
    },
    /** 不弹成功提示：升级结果在右侧「行迹」里 */
    async doUpgrade() {
      this.upgrading = true;
      try {
        const data = await apiUpgradeCave();
        this.$store.commit('SET_PROFILE', data);
      } catch (e) { /* 已提示 */ } finally {
        this.upgrading = false;
      }
    }
  }
};
</script>

<style lang="scss" scoped>
.narrative {
  font-size: 13px;
  line-height: 1.9;
  color: #a9bccd;
  margin: 0 0 14px;
  padding-left: 10px;
  border-left: 2px solid rgba(53, 179, 154, 0.35);
}

.grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 12px;
}

.cell {
  background: rgba(255, 255, 255, 0.03);
  border: 1px solid rgba(120, 200, 180, 0.14);
  border-radius: 6px;
  padding: 12px;

  .cell-label { font-size: 12px; color: #8ba1b8; }
  .cell-value {
    font-size: 18px;
    margin-top: 6px;
    font-variant-numeric: tabular-nums;
    small { font-size: 11px; color: #8ba1b8; }
    &.jade { color: #4fd3b8; }
    &.gold { color: #d9b96a; }
  }
}

.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  margin-top: 12px;
}

.pick {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-top: 12px;

  .label { font-size: 12px; color: #8ba1b8; white-space: nowrap; }
}

.verdict {
  margin-top: 12px;
  padding: 8px 10px;
  border-radius: 4px;
  font-size: 12px;
  line-height: 1.6;
  border-left: 2px solid;

  &.good { color: #8ff0da; background: rgba(53, 179, 154, 0.12); border-color: #4fd3b8; }
  &.warn { color: #f0dcab; background: rgba(217, 185, 106, 0.12); border-color: #d9b96a; }
  &.bad { color: #f0b3ac; background: rgba(200, 90, 80, 0.12); border-color: #d4695c; }
}

.formula-intro {
  font-size: 12px;
  line-height: 1.9;
  color: #a9bccd;
  margin: 0;
  padding-left: 10px;
  border-left: 2px solid rgba(217, 185, 106, 0.4);

  b { color: #d9b96a; }
}

.target-line {
  margin-top: 12px;
  font-size: 13px;
  color: #cfdcea;
  display: flex;
  align-items: center;
  gap: 6px;

  b { color: #dfe9f3; }
}

.el-tag-mini {
  font-size: 11px;
  border: 1px solid;
  border-radius: 3px;
  padding: 0 4px;
  line-height: 15px;
}

.derive {
  margin-top: 12px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.derive-line {
  font-size: 12.5px;
  line-height: 2;
  color: #cfdcea;
  font-variant-numeric: tabular-nums;

  b { color: #4fd3b8; }
  b.gold { color: #d9b96a; }
  b.down { color: #d4695c; }
  &.dim { color: #8ba1b8; }
  .dim-note { color: rgba(139, 161, 184, 0.75); }
}

.up { color: #4fd3b8; }
.down { color: #d4695c; }

.hint {
  margin-top: 12px;
  font-size: 12px;
  color: rgba(139, 161, 184, 0.8);
  line-height: 1.7;
}
</style>
