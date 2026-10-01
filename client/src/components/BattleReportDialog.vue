<template>
  <el-dialog
    :title="title"
    :visible.sync="visible"
    width="620px"
    @closed="onClosed"
  >
    <div v-if="report" class="report">
      <div class="versus">
        <div class="side">
          <div class="name" :style="{ color: elementColor(report.player.element) }">{{ report.player.name }}</div>
          <div class="sub">{{ report.player.element }} · 攻 {{ report.player.atk }} · 防 {{ report.player.def }}</div>
          <div class="hp-bar player"><div class="fill" :style="{ width: playerHpPct + '%' }"></div></div>
          <div class="hp-text">{{ playerHp }} / {{ report.playerMaxHp }}</div>
        </div>

        <div class="vs">斗</div>

        <div class="side right">
          <div class="name" :style="{ color: elementColor(report.monster.element) }">{{ report.monster.name }}</div>
          <div class="sub">{{ report.monster.element }} · 攻 {{ report.monster.atk }} · 防 {{ report.monster.def }}</div>
          <div class="hp-bar monster"><div class="fill" :style="{ width: monsterHpPct + '%' }"></div></div>
          <div class="hp-text">{{ monsterHp }} / {{ report.monsterMaxHp }}</div>
        </div>
      </div>

      <div class="meta">
        共 {{ report.roundCount }} 回合 · 随机种子 {{ report.seed }}
        <el-button v-if="playing" type="text" @click="skip">跳过演出</el-button>
      </div>

      <div class="battle-log" ref="logBox">
        <div
          v-for="(r, i) in shown"
          :key="i"
          class="row"
          :class="[r.side === 'player' ? 'player' : 'monster', { crit: r.crit }]"
        >
          <span class="round">第{{ r.round }}回合</span>
          <span class="text">{{ r.text }}</span>
        </div>
      </div>

      <div v-if="!playing" class="result">
        <div class="result-title" :class="report.win ? 'win' : 'lose'">
          {{ report.win ? '胜' : (report.timeout ? '平（三十回合未分胜负）' : '败') }}
        </div>
        <div v-if="challenge" class="reward-line">
          <template v-if="report.win">
            {{ challenge.firstClear ? '首通奖励' : `重复挑战（${Math.round(challenge.rewardRate * 100)}%）` }}：
            修为 +{{ $num(challenge.reward.exp) }} · 灵石 +{{ $num(challenge.reward.stone) }}
          </template>
          <template v-else>
            此战未得奖励<template v-if="challenge.failLoss">，且损失修为 {{ $num(challenge.failLoss) }}</template>，可再战
          </template>
        </div>
      </div>
    </div>

    <template slot="footer">
      <el-button type="primary" @click="visible = false">收剑</el-button>
    </template>
  </el-dialog>
</template>

<script>
export default {
  name: 'BattleReportDialog',
  data() {
    return {
      visible: false,
      report: null,
      challenge: null,
      shown: [],
      playing: false,
      timer: null,
      playerHp: 0,
      monsterHp: 0
    };
  },
  computed: {
    title() {
      if (!this.challenge) return '战报';
      return `${this.challenge.stage.name} · 遭遇 ${this.challenge.stage.monsterName}`;
    },
    playerHpPct() {
      if (!this.report) return 0;
      return Math.max(0, Math.round((this.playerHp / this.report.playerMaxHp) * 100));
    },
    monsterHpPct() {
      if (!this.report) return 0;
      return Math.max(0, Math.round((this.monsterHp / this.report.monsterMaxHp) * 100));
    }
  },
  beforeDestroy() {
    clearTimeout(this.timer);
  },
  methods: {
    elementColor(el) {
      const colors = (this.$store.state.config && this.$store.state.config.world.elementColors) || {};
      return colors[el] || '#dfe9f3';
    },
    open(challenge) {
      this.challenge = challenge;
      this.report = challenge.report;
      this.visible = true;
      this.playerHp = this.report.playerMaxHp;
      this.monsterHp = this.report.monsterMaxHp;
      this.play();
    },
    play() {
      clearTimeout(this.timer);
      this.shown = [];
      this.playing = true;
      this.playerHp = this.report.playerMaxHp;
      this.monsterHp = this.report.monsterMaxHp;
      let i = 0;
      const step = () => {
        if (i >= this.report.rounds.length) {
          this.playing = false;
          return;
        }
        const r = this.report.rounds[i];
        this.shown.push(r);
        if (r.side === 'player') this.monsterHp = r.targetHp;
        else this.playerHp = r.targetHp;
        i += 1;
        this.scrollBottom();
        this.timer = setTimeout(step, 240);
      };
      step();
    },
    skip() {
      clearTimeout(this.timer);
      this.shown = this.report.rounds.slice();
      this.playerHp = this.report.playerHp;
      this.monsterHp = this.report.monsterHp;
      this.playing = false;
      this.scrollBottom();
    },
    scrollBottom() {
      this.$nextTick(() => {
        const box = this.$refs.logBox;
        if (box) box.scrollTop = box.scrollHeight;
      });
    },
    onClosed() {
      clearTimeout(this.timer);
      this.playing = false;
      this.shown = [];
    }
  }
};
</script>

<style lang="scss" scoped>
.versus {
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 12px;
  background: rgba(255, 255, 255, 0.03);
  border-radius: 6px;
}

.side {
  flex: 1;

  &.right { text-align: right; }
  .name { font-size: 15px; }
  .sub { font-size: 12px; color: #8ba1b8; margin: 4px 0 8px; }
}

.vs {
  flex: 0 0 40px;
  text-align: center;
  font-size: 20px;
  color: #d9b96a;
}

.hp-text {
  font-size: 12px;
  color: #8ba1b8;
  margin-top: 4px;
  font-variant-numeric: tabular-nums;
}

.meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 12px;
  color: #8ba1b8;
  margin: 14px 0 8px;
}

.round {
  flex: 0 0 62px;
  color: #8ba1b8;
  font-size: 12px;
}

.text { flex: 1; }

.result {
  margin-top: 14px;
  text-align: center;
  border-top: 1px solid rgba(255, 255, 255, 0.08);
  padding-top: 12px;
}

.result-title {
  font-size: 22px;
  letter-spacing: 6px;
  &.win { color: #4fd3b8; }
  &.lose { color: #d4695c; }
}

.reward-line {
  margin-top: 8px;
  font-size: 13px;
  color: #d9b96a;
}
</style>
