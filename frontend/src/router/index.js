import { createRouter, createWebHistory } from 'vue-router';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'bandeja', component: () => import('../views/Bandeja.vue') },
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  ],
});

export default router;
