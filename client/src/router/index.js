import Vue from 'vue';
import VueRouter from 'vue-router';
import store from '../store';

Vue.use(VueRouter);

const routes = [
  { path: '/', redirect: '/game' },
  {
    path: '/login',
    name: 'login',
    component: () => import('../views/Login.vue')
  },
  {
    path: '/game',
    name: 'game',
    component: () => import('../views/Game.vue'),
    meta: { auth: true }
  },
  { path: '*', redirect: '/game' }
];

const router = new VueRouter({
  mode: 'hash',
  routes
});

router.beforeEach((to, from, next) => {
  if (to.meta.auth && !store.state.token) return next({ name: 'login' });
  if (to.name === 'login' && store.state.token) return next({ name: 'game' });
  return next();
});

export default router;
