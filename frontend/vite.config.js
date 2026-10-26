import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Dev seulement : VITE_DEV_PROXY_TARGET fait passer l'API et les médias par le serveur Vite, avec
  // VITE_API_BASE_URL vide (même origine). Deux usages, voir .env.development.local :
  //   - https://app.parenthese.io : tester le front local sur un arbre réel (nginx retire /api côté prod)
  //   - http://127.0.0.1:4000 + VITE_DEV_PROXY_STRIP_API=1 : backend local, Vite retire /api comme nginx
  //     (sans ça, les liens partagés /api/arbre/:slug et les médias /api/... répondent 404 en local)
  const proxyTarget = env.VITE_DEV_PROXY_TARGET
  const stripApi = env.VITE_DEV_PROXY_STRIP_API === '1'
  const proxy = proxyTarget
    ? Object.fromEntries(['/api', '/trees', '/auth', '/health'].map((p) => [p, {
      target: proxyTarget,
      changeOrigin: true,
      ...(p === '/api' && stripApi ? { rewrite: (requestPath) => requestPath.replace(/^\/api/, '') } : {}),
    }]))
    : undefined

  return {
    plugins: [react(), tailwindcss()],
    server: { proxy },
    // Mêmes navigateurs qu'avec Vite 7 : Vite 8 relève sa cible par défaut (Safari 16.4, Chrome 111),
    // et la famille ouvre souvent l'arbre sur un vieil iPad ou un ancien téléphone
    build: { target: ['chrome107', 'edge107', 'firefox104', 'safari16'] },
    test: {
      environment: 'node',
      include: ['src/**/*.test.{js,jsx}'],
    },
  }
})
