<template>
  <div class="rank">
    <div class="head">
      <div class="xi-title" style="margin:0">天榜 · 修为排名</div>
      <div class="meta">
        共 {{ total }} 位道友
        <span v-if="myRank" class="mine">你位列第 <b>{{ myRank }}</b> 名</span>
        <el-button type="text" :loading="loading" @click="load">刷新</el-button>
      </div>
    </div>

    <el-table :data="list" v-loading="loading" style="width:100%" :row-class-name="rowClass">
      <el-table-column label="名次" width="80">
        <template slot-scope="s">
          <span class="rank-no" :class="'top' + (s.row.rank <= 3 ? s.row.rank : 0)">{{ s.row.rank }}</span>
        </template>
      </el-table-column>
      <el-table-column label="道号" min-width="140">
        <template slot-scope="s">
          <span :class="{ 'is-me': s.row.isMe }">{{ s.row.nickname }}</span>
          <el-tag v-if="s.row.isMe" size="mini" style="margin-left:6px">我</el-tag>
        </template>
      </el-table-column>
      <el-table-column label="境界" width="140">
        <template slot-scope="s">
          <span :style="{ color: s.row.realmColor }">{{ s.row.realmName }} · {{ s.row.realmLevel }}层</span>
        </template>
      </el-table-column>
      <el-table-column label="修为" min-width="120" align="right">
        <template slot-scope="s"><span class="exp">{{ $num(s.row.exp) }}</span></template>
      </el-table-column>
      <el-table-column label="洞府" width="80" align="right">
        <template slot-scope="s">{{ s.row.caveLevel }} 级</template>
      </el-table-column>
      <el-table-column label="突破次数" width="100" align="right" prop="totalBreak" />
    </el-table>

    <div v-if="!inBoard && my" class="out-board">
      你尚未进入前 {{ size }} 名 —— 当前第 <b>{{ my.rank }}</b> 名：
      {{ my.realmName }} · {{ my.realmLevel }}层 · 修为 {{ $num(my.exp) }}
    </div>

    <div class="hint">排名规则：境界 → 境界内层数 → 修为，同分时按角色创建顺序。</div>
  </div>
</template>

<script>
import { apiRankList } from '../api';

export default {
  name: 'RankPanel',
  data() {
    return { list: [], total: 0, myRank: 0, inBoard: false, my: null, size: 50, loading: true };
  },
  created() {
    this.load();
  },
  methods: {
    async load() {
      this.loading = true;
      try {
        const data = await apiRankList(50);
        this.list = data.list;
        this.total = data.total;
        this.myRank = data.myRank;
        this.inBoard = data.inBoard;
        this.my = data.my;
        this.size = data.size;
      } catch (e) { /* 已提示 */ } finally {
        this.loading = false;
      }
    },
    rowClass({ row }) {
      return row.isMe ? 'me-row' : '';
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

  .mine {
    margin-left: 12px;
    color: #d9b96a;
    b { font-size: 14px; }
  }
}

.rank-no {
  display: inline-block;
  width: 22px;
  height: 22px;
  line-height: 22px;
  text-align: center;
  border-radius: 50%;
  font-size: 12px;
  background: rgba(255, 255, 255, 0.06);
  color: #8ba1b8;

  &.top1 { background: linear-gradient(180deg, #ffd76e, #c9a227); color: #2b1f04; }
  &.top2 { background: linear-gradient(180deg, #dfe9f3, #9fb0c0); color: #1d2530; }
  &.top3 { background: linear-gradient(180deg, #e0a03c, #a86a1f); color: #2b1f04; }
}

.is-me { color: #d9b96a; }
.exp { color: #4fd3b8; font-variant-numeric: tabular-nums; }

.out-board {
  margin-top: 14px;
  padding: 10px 12px;
  font-size: 13px;
  color: #d9b96a;
  background: rgba(217, 185, 106, 0.1);
  border: 1px solid rgba(217, 185, 106, 0.25);
  border-radius: 6px;

  b { font-size: 15px; }
}

.hint {
  margin-top: 12px;
  font-size: 12px;
  color: rgba(139, 161, 184, 0.75);
}
</style>
