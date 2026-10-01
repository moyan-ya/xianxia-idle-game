<template>
  <div class="logs">
    <el-tabs v-model="tab">
      <el-tab-pane :label="`资源流水（${currencyTotal}）`" name="currency">
        <div v-if="!rows.length && !loading" class="xi-empty">暂无记录</div>

        <div v-else>
          <el-table :data="rows" v-loading="loading" style="width:100%" size="mini">
            <el-table-column label="时间" width="150" prop="created_at" />
            <el-table-column label="项目" width="80">
              <template slot-scope="s">{{ kindName[s.row.kind] || s.row.kind }}</template>
            </el-table-column>
            <el-table-column label="变动" width="110" align="right">
              <template slot-scope="s">
                <span :class="s.row.delta >= 0 ? 'up' : 'down'">
                  {{ s.row.delta >= 0 ? '+' : '' }}{{ $num(s.row.delta) }}
                </span>
              </template>
            </el-table-column>
            <el-table-column label="余额" width="120" align="right">
              <template slot-scope="s">{{ $num(s.row.balance_after) }}</template>
            </el-table-column>
            <el-table-column label="来源" min-width="140">
              <template slot-scope="s">
                <span class="reason">{{ reasonName[s.row.reason] || s.row.reason }}</span>
                <span v-if="s.row.remark" class="remark">{{ s.row.remark }}</span>
              </template>
            </el-table-column>
          </el-table>

          <div class="pager">
            <el-pagination
              small
              background
              :key="`cur-${page}-${syncKey}`"
              layout="prev, pager, next, total"
              :current-page="page"
              :page-size="pageSize"
              :total="currencyTotal"
              @current-change="onCurrencyPage"
            />
          </div>
        </div>
      </el-tab-pane>

      <el-tab-pane :label="`战斗留档（${battleTotal}）`" name="battle">
        <div v-if="!battles.length && !loading" class="xi-empty">尚未与妖物交手</div>

        <div v-else>
          <el-table :data="battles" v-loading="loading" style="width:100%" size="mini">
            <el-table-column label="塔层" width="70">
              <template slot-scope="s">第 {{ s.row.stage_id }} 层</template>
            </el-table-column>
            <el-table-column label="对手" min-width="150">
              <template slot-scope="s">{{ monsterName(s.row.stage_id) }}</template>
            </el-table-column>
            <el-table-column label="结果" width="70">
              <template slot-scope="s">
                <span :class="s.row.win ? 'win' : 'lose'">{{ s.row.win ? '胜' : '败' }}</span>
              </template>
            </el-table-column>
            <el-table-column label="回合" width="70" prop="rounds" />
            <el-table-column label="随机种子" min-width="130">
              <template slot-scope="s"><span class="seed">{{ s.row.seed }}</span></template>
            </el-table-column>
            <el-table-column label="时间" min-width="150" prop="created_at" />
          </el-table>

          <div class="pager">
            <el-pagination
              small
              background
              :key="`bat-${battlePage}-${syncKey}`"
              layout="prev, pager, next, total"
              :current-page="battlePage"
              :page-size="battlePageSize"
              :total="battleTotal"
              @current-change="onBattlePage"
            />
          </div>
        </div>

        <div class="hint">
          记录里的 seed 可以完整复算出同一场战斗，用于查作弊与客服补单。
        </div>
      </el-tab-pane>
    </el-tabs>
  </div>
</template>

<script>
import { mapState } from 'vuex';
import { apiLogs } from '../api';

const KIND_NAME = { stone: '灵石', exp: '修为', qi: '灵石' };
const REASON_NAME = {
  settle: '洞府结算',
  breakthrough: '境界突破',
  shop: '坊市交易',
  use: '服用丹药',
  cave: '洞府扩建',
  reroll: '灵根洗练',
  sell: '出售回收',
  battle: '试炼塔',
  init: '开局赠礼'
};

export default {
  name: 'LogPanel',
  data() {
    return {
      tab: 'currency',
      loading: true,
      rows: [],
      battles: [],
      page: 1,
      pageSize: 10,
      currencyTotal: 0,
      battlePage: 1,
      battlePageSize: 10,
      battleTotal: 0,
      // 请求失败时用它强制分页器重建，把页码拉回服务端真正返回的那一页
      syncKey: 0,
      kindName: KIND_NAME,
      reasonName: REASON_NAME
    };
  },
  computed: {
    ...mapState(['config'])
  },
  created() {
    this.load();
  },
  methods: {
    monsterName(stageId) {
      const s = ((this.config && this.config.stages) || []).find((x) => x.id === stageId);
      return (s && s.monsterName) || '未知';
    },
    /** 两张表各自分页，但一次请求同时取回，翻哪页都只发一个请求 */
    async load(overrides = {}) {
      this.loading = true;
      try {
        const params = Object.assign({
          page: this.page,
          pageSize: this.pageSize,
          battlePage: this.battlePage,
          battlePageSize: this.battlePageSize
        }, overrides);
        const data = await apiLogs(params);
        this.rows = data.currency.list;
        this.currencyTotal = data.currency.total;
        this.page = data.currency.page;
        this.pageSize = data.currency.pageSize;
        this.battles = data.battles.list;
        this.battleTotal = data.battles.total;
        this.battlePage = data.battles.page;
        this.battlePageSize = data.battles.pageSize;
      } catch (e) {
        // 失败时页码已经不会被回写，但分页器自己已经跳到新页了 ——
        // 不重建的话会出现"高亮在第 2 页、内容还是第 1 页"，只能靠再点一次自愈
        this.syncKey += 1;
      } finally {
        this.loading = false;
      }
    },
    onCurrencyPage(p) {
      this.load({ page: p });
    },
    onBattlePage(p) {
      this.load({ battlePage: p });
    }
  }
};
</script>

<style lang="scss" scoped>
.up { color: #4fd3b8; font-variant-numeric: tabular-nums; }
.down { color: #d4695c; font-variant-numeric: tabular-nums; }
.win { color: #4fd3b8; }
.lose { color: #d4695c; }
.seed { font-size: 12px; color: #8ba1b8; }

.reason { color: #cfdcea; }
.remark { color: rgba(139, 161, 184, 0.75); margin-left: 6px; font-size: 12px; }

.pager {
  display: flex;
  justify-content: flex-end;
  margin-top: 12px;
}

.hint {
  margin-top: 10px;
  font-size: 12px;
  color: rgba(139, 161, 184, 0.75);
  line-height: 1.7;
}
</style>
