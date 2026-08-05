import { createRouter, createWebHistory } from 'vue-router';
import { useAuth } from '../stores/auth';

const router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: '/', name: 'bandeja', component: () => import('../views/Bandeja.vue'), meta: { requiereAuth: true } },
    { path: '/informe', name: 'informe', component: () => import('../views/Informe.vue'), meta: { requiereAuth: true } },
    { path: '/seguimiento', name: 'seguimiento', component: () => import('../views/ScorecardAgentes.vue'), meta: { requiereAuth: true } },
    { path: '/login', name: 'login', component: () => import('../views/Login.vue') },
  ],
});

router.beforeEach(async (to) => {
  const auth = useAuth();
  if (auth.token && !auth.agente) await auth.cargarAgente();
  if (to.meta.requiereAuth && !auth.estaAutenticado) return { name: 'login' };
  if (to.name === 'login' && auth.estaAutenticado) return { name: 'bandeja' };
  return true;
});

export default router;
