import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // Mêmes navigateurs qu'avec Vite 7, comme le front (Vite 8 relève sa cible par défaut)
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    outDir: 'dist',
    emptyOutDir: true,
  },
})
