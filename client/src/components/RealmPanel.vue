<template>
  <div class="realm-panel">
    <div class="two-col">
      <div class="xi-panel">
        <div class="xi-title">境界说明</div>
        <el-table :data="realmTable" size="mini" max-height="380" :row-class-name="realmRowClass">
          <el-table-column label="境界" width="70">
            <template slot-scope="s"><span :style="{ color: s.row.color }">{{ s.row.name }}</span></template>
          </el-table-column>
          <el-table-column label="灵石/秒" width="86" align="right">
            <template slot-scope="s">{{ $num(s.row.stonePerSec) }}</template>
          </el-table-column>
          <el-table-column label="本境修为总量" min-width="106" align="right">
            <template slot-scope="s">{{ $num(s.row.totalExp) }}</template>
          </el-table-column>
          <el-table-column label="九层所需" min-width="100" align="right">
            <template slot-scope="s">{{ $num(s.row.levels[levelsPerRealm - 1].expNeed) }}</template>
          </el-table-column>
          <el-table-column label="突破基础率" width="96" align="right">
            <template slot-scope="s">{{ $pct(s.row.breakBonus, 0) }}</template>
          </el-table-column>
        </el-table>
        <div class="hint">
          共 {{ realmTable.length }} 个大境界，每境 {{ levelsPerRealm }} 层。
          「九层所需」是该境第 {{ levelsPerRealm }} 层突破到下一境界所需修为；
          越往后基础成功率越低，要靠失败保底与悟道石顶上去。
        </div>
      </div>

      <div class="xi-panel">
        <div class="xi-title">提升概览</div>

        <div class="block">
          <div class="block-title">灵石产出构成</div>
          <div class="formula">
            {{ stone.base }} <span class="op">×</span> {{ stone.levelMul }}<span class="tag">层数</span>
            <span class="op">×</span> {{ stone.rootMul }}<span class="tag">灵根 {{ derived.mainRoot.value }}</span>
            <span class="op">×</span> {{ stone.caveMul }}<span class="tag">洞府 {{ derived.cave.level }} 级</span>
            <span class="op">×</span> {{ stone.equipMul }}<span class="tag">装备</span>
            <span class="op">=</span> <b class="jade">{{ $num(stone.total) }}</b> <span class="tag">灵石/秒</span>
          </div>
        </div>

        <div class="block">
          <div class="block-title">突破成功率构成</div>
          <div class="formula">
            {{ $pct(bd.base, 0) }}<span class="tag">境界基础</span>
            <span class="op">−</span> {{ $pct(-bd.levelPenalty, 0) }}<span class="tag">层数惩罚</span>
            <span class="op">+</span> {{ $pct(bd.pityBonus, 0) }}<span class="tag">失败保底</span>
            <template v-if="bdAdjust !== 0">
              <span class="op">{{ bdAdjust > 0 ? '+' : '−' }}</span>
              {{ $pct(Math.abs(bdAdjust), 1) }}<span class="tag">下限/上限修正</span>
            </template>
            <span class="op">+</span> {{ $pct(bd.stoneBonus, 0) }}<span class="tag">悟道石</span>
            <span class="op">=</span> <b class="gold">{{ $pct(bd.total, 1) }}</b>
            <span class="tag">硬上限 100%</span>
          </div>
        </div>

        <div class="block">
          <div class="block-title">下一步可以做什么</div>
          <div v-for="(t, i) in todos" :key="i" class="todo" :class="t.ready ? 'ready' : ''">
            <span class="dot"></span>
            <span class="text">{{ t.text }}</span>
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script>
import { mapGetters, mapState } from 'vuex';

export default {
  name: 'RealmPanel',
  props: {
    /** 来自战斗推演的 15 层结果，用来给出"现在能打到第几层"的建议 */
    previewList: { type: Array, default: () => [] }
  },
  computed: {
    ...mapState(['config']),
    ...mapGetters(['role', 'derived', 'equip', 'liveExp', 'liveStone']),
    realmTable() {
      return (this.config && this.config.realmTable) || [];
    },
    levelsPerRealm() {
      return (this.config && this.config.levelsPerRealm) || 9;
    },
    stone() {
      return this.derived.stoneBreakdown || { base: 0, levelMul: 1, rootMul: 1, caveMul: 1, equipMul: 1, total: 0 };
    },
    bd() {
      return this.derived.breakDetail || {
        base: 0, levelPenalty: 0, pityBonus: 0, stoneBonus: 0, baseCapped: 0, total: 0
      };
    },
    /** 基础率有 5%~95% 的夹取，夹取后逐项相加会对不上，这里把差值显式列出来 */
    bdAdjust() {
      const raw = this.bd.base + this.bd.levelPenalty + this.bd.pityBonus;
      return Number(((this.bd.baseCapped || 0) - raw).toFixed(4));
    },
    /** 本境界最值得换的法宝（攻击向） */
    bestArtifact() {
      return ((this.config && this.config.items) || [])
        .filter((i) => i.type === 'artifact' && i.realm === this.role.realm && i.effect && i.effect.atk)
        .sort((a, b) => b.effect.atk - a.effect.atk)[0] || null;
    },
    /** 本境界最值得换的功法 */
    bestSkill() {
      return ((this.config && this.config.items) || [])
        .filter((i) => i.type === 'skill' && i.realm === this.role.realm && i.effect && i.effect.stoneBonus)
        .sort((a, b) => b.effect.stoneBonus - a.effect.stoneBonus)[0] || null;
    },
    todos() {
      const list = [];
      const need = this.role.expNeed;
      const exp = this.liveExp;
      const stoneOk = this.liveStone >= need;

      if (exp >= need && !this.role.isMaxRealm) {
        list.push({
          ready: true,
          text: `修为已够，可冲击${this.role.realmLevel === this.levelsPerRealm ? '下一境界' : (this.role.realmLevel + 1) + ' 层'}，当前成功率 ${this.$pct(this.derived.breakRate, 1)}`
        });
      } else if (!this.role.isMaxRealm) {
        list.push({ ready: false, text: `距离下一次突破还需修为 ${this.$num(need - exp)}` });
      }

      const next = this.derived.cave.next;
      if (next) {
        list.push({
          ready: this.liveStone >= next.costStone,
          text: this.liveStone >= next.costStone
            ? `可把洞府升到 ${next.level} 级，产出加成 +${Math.round(next.stoneBonus * 100)}%（需 ${this.$num(next.costStone)} 灵石）`
            : `洞府升到 ${next.level} 级需 ${this.$num(next.costStone)} 灵石，还差 ${this.$num(next.costStone - this.liveStone)}`
        });
      }

      if (this.bestSkill) {
        const cur = (this.equip.skill && this.equip.skill.effect && this.equip.skill.effect.stoneBonus) || 0;
        if (this.bestSkill.effect.stoneBonus > cur) {
          list.push({
            ready: this.liveStone >= this.bestSkill.price,
            text: `换上功法「${this.bestSkill.name}」可把产出加成从 +${Math.round(cur * 100)}% 提到 +${Math.round(this.bestSkill.effect.stoneBonus * 100)}%（${this.$num(this.bestSkill.price)} 灵石）`
          });
        }
      }

      if (this.bestArtifact) {
        const cur = (this.equip.artifact && this.equip.artifact.effect && this.equip.artifact.effect.atk) || 0;
        if (this.bestArtifact.effect.atk > cur) {
          list.push({
            ready: this.liveStone >= this.bestArtifact.price,
            text: `换上法宝「${this.bestArtifact.name}」可把攻击从 ${this.$num(cur)} 提到 ${this.$num(this.bestArtifact.effect.atk)}（${this.$num(this.bestArtifact.price)} 灵石）`
          });
        }
      }

      const winnable = this.previewList.filter((x) => x.damage && x.damage.verdict === '优势');
      if (winnable.length) {
        const top = winnable[winnable.length - 1];
        list.push({
          ready: true,
          text: `按当前道体推演，可稳胜试炼塔 ${winnable.length} 层（最高第 ${top.stageId} 层 ${top.name}，约 ${top.damage.roundsToKill} 回合）`
        });
      } else if (this.previewList.length) {
        list.push({ ready: false, text: '当前道体连试炼塔第一层都打得吃力，先提升灵根与装备' });
      }

      if (this.derived.rootCount > 1) {
        list.push({
          ready: false,
          text: `道体为「${this.role.rootTitle}」：灵根越多平均系数越低，可用散灵丹把低值灵根散去，或继续洗练主灵根（${this.derived.mainRoot.element} ${this.derived.mainRoot.value}）`
        });
      }

      return list;
    }
  },
  methods: {
    realmRowClass({ row }) {
      return row.id === this.role.realm ? 'me-row' : '';
    }
  }
};
</script>

<style lang="scss" scoped>
.two-col {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
}

.block {
  margin-bottom: 14px;

  &:last-child { margin-bottom: 0; }
}

.block-title {
  font-size: 12px;
  color: #8ba1b8;
  margin-bottom: 6px;
}

.formula {
  font-size: 13px;
  line-height: 2.1;
  color: #cfdcea;
  font-variant-numeric: tabular-nums;

  b { font-size: 15px; }
  b.jade { color: #4fd3b8; }
  b.gold { color: #d9b96a; }
  .op { color: #8ba1b8; margin: 0 4px; }
  .tag {
    font-size: 11px;
    color: rgba(139, 161, 184, 0.85);
    margin-left: 3px;
  }
}

.todo {
  display: flex;
  gap: 8px;
  align-items: flex-start;
  font-size: 12.5px;
  line-height: 1.7;
  padding: 5px 0;
  color: #a9bccd;

  .dot {
    flex: 0 0 6px;
    width: 6px;
    height: 6px;
    border-radius: 50%;
    background: rgba(139, 161, 184, 0.6);
    margin-top: 7px;
  }

  &.ready {
    color: #8ff0da;
    .dot { background: #4fd3b8; box-shadow: 0 0 6px rgba(79, 211, 184, 0.6); }
  }
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  color: rgba(139, 161, 184, 0.75);
  line-height: 1.8;
}
</style>
