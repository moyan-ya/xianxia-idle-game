<template>
  <div class="login-page">
    <div class="login-box">
      <div class="brand">
        <div class="brand-title">仙 侠 放 置</div>
        <div class="brand-sub">一念起，万水千山；一念灭，沧海桑田</div>
      </div>

      <el-tabs v-model="mode" stretch>
        <el-tab-pane label="登入仙门" name="login">
          <el-form ref="loginForm" :model="loginForm" :rules="rules" @submit.native.prevent>
            <el-form-item prop="username">
              <el-input v-model="loginForm.username" placeholder="账号" prefix-icon="el-icon-user" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="loginForm.password" type="password" placeholder="密码" prefix-icon="el-icon-lock" show-password @keyup.enter.native="submit" />
            </el-form-item>
            <el-button type="primary" class="submit-btn" :loading="loading" @click="submit">踏 入 修 途</el-button>
          </el-form>
        </el-tab-pane>

        <el-tab-pane label="初入江湖" name="register">
          <el-form ref="regForm" :model="regForm" :rules="regRules" @submit.native.prevent>
            <el-form-item prop="username">
              <el-input v-model="regForm.username" placeholder="账号：3-20 位字母数字下划线" prefix-icon="el-icon-user" />
            </el-form-item>
            <el-form-item prop="nickname">
              <el-input v-model="regForm.nickname" placeholder="道号：2-12 字，如 凌尘" prefix-icon="el-icon-star-off" />
            </el-form-item>
            <el-form-item prop="password">
              <el-input v-model="regForm.password" type="password" placeholder="密码：6-32 位" prefix-icon="el-icon-lock" show-password />
            </el-form-item>
            <el-button type="primary" class="submit-btn" :loading="loading" @click="submit">开 宗 立 派</el-button>
          </el-form>
        </el-tab-pane>
      </el-tabs>

    </div>

    <div class="copyright">Vue 2.6 + Element UI · Node 16 + Express · MySQL 8.0</div>
  </div>
</template>

<script>
export default {
  name: 'LoginView',
  data() {
    return {
      mode: 'login',
      loading: false,
      loginForm: { username: '', password: '' },
      regForm: { username: '', nickname: '', password: '' },
      rules: {
        username: [{ required: true, message: '请输入账号', trigger: 'blur' }],
        password: [{ required: true, message: '请输入密码', trigger: 'blur' }]
      },
      regRules: {
        username: [
          { required: true, message: '请输入账号', trigger: 'blur' },
          { pattern: /^[a-zA-Z0-9_]{3,20}$/, message: '3-20 位字母、数字或下划线', trigger: 'blur' }
        ],
        nickname: [
          { required: true, message: '请输入道号', trigger: 'blur' },
          { min: 2, max: 12, message: '道号 2-12 个字符', trigger: 'blur' }
        ],
        password: [
          { required: true, message: '请输入密码', trigger: 'blur' },
          { min: 6, max: 32, message: '密码 6-32 位', trigger: 'blur' }
        ]
      }
    };
  },
  methods: {
    submit() {
      if (this.loading) return; // 回车键不受按钮 loading 保护，这里挡一次重复提交
      const isLogin = this.mode === 'login';
      const refName = isLogin ? 'loginForm' : 'regForm';

      this.$refs[refName].validate(async (valid) => {
        if (!valid) return;
        this.loading = true;
        try {
          // 成功不弹提示：进去之后右侧「行迹」就是唯一的记录出口
          if (isLogin) {
            await this.$store.dispatch('login', { ...this.loginForm });
          } else {
            await this.$store.dispatch('register', { ...this.regForm });
          }
          this.$router.push({ name: 'game' }).catch(() => {});
        } catch (e) {
          /* 错误提示已由请求拦截器统一处理 */
        } finally {
          this.loading = false;
        }
      });
    }
  }
};
</script>

<style lang="scss" scoped>
.login-page {
  height: 100%;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  position: relative;
}

.login-box {
  width: 380px;
  padding: 32px 32px 20px;
  background: rgba(12, 20, 33, 0.86);
  border: 1px solid rgba(120, 200, 180, 0.2);
  border-radius: 10px;
  box-shadow: 0 18px 60px rgba(0, 0, 0, 0.55);
}

.brand {
  text-align: center;
  margin-bottom: 18px;
}

.brand-title {
  font-size: 26px;
  letter-spacing: 8px;
  background: linear-gradient(180deg, #fff6d8, #d9b96a);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
}

.brand-sub {
  margin-top: 8px;
  font-size: 12px;
  color: #7f93a8;
  letter-spacing: 1px;
}

.submit-btn {
  width: 100%;
  letter-spacing: 2px;
  margin-top: 6px;
}

.tip {
  margin-top: 18px;
  text-align: center;
  font-size: 12px;
  color: #7f93a8;

  b { color: #d9b96a; }
}

.copyright {
  position: absolute;
  bottom: 18px;
  font-size: 12px;
  color: rgba(127, 147, 168, 0.6);
}
</style>
