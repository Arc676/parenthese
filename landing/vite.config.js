import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: {
    // Mêmes navigateurs qu'avec Vite 7, comme le front (Vite 8 relève sa cible par défaut)
    target: ['chrome107', 'edge107', 'firefox104', 'safari16'],
    outDir: 'dist',
    emptyOutDir: true,
  },
})
