import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5180,
    proxy: {
      // `npm run dev` proxies API calls to `vercel dev` (port 3000) or the local api server.
      '/api': { target: process.env.API_TARGET || 'http://localhost:3999', changeOrigin: true },
    },
  },
  build: { sourcemap: false },
})
