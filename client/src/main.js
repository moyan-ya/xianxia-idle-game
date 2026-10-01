import Vue from 'vue';
import ElementUI from 'element-ui';
import 'element-ui/lib/theme-chalk/index.css';

import App from './App.vue';
import router from './router';
import store from './store';
import { formatNum, formatExact, formatPct, formatRate, effectText } from './utils/format';

// 主题覆盖必须放在 element 默认样式之后
import './assets/theme.scss';

Vue.use(ElementUI, { size: 'small' });
Vue.config.productionTip = false;

// 数值格式化：仙境里的数字会到亿级，模板里统一用 $num
Vue.prototype.$num = formatNum;
Vue.prototype.$exact = formatExact;
Vue.prototype.$pct = formatPct;
Vue.prototype.$rate = formatRate;
Vue.prototype.$effect = effectText;

new Vue({
  router,
  store,
  render: (h) => h(App)
}).$mount('#app');
