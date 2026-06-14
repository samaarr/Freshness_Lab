import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// API base: dev proxies /api -> localhost:8000; prod uses VITE_API_URL
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
})
