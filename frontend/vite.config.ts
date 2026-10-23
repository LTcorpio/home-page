import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 开发期把 /api 与 /icons 代理到本地 Go 后端（scripts/dev.sh 注入 VITE_API_TARGET）。
// 代理默认注入管理员身份头，便于在开发环境调试后台与容器操作；
// 与生产一致：后端只信任来自回环 / 私网的这些头。
// 注意：Node 的 HTTP 实现只允许 ISO-8859-1 头值，身份头请使用 ASCII（中文会触发 ERR_INVALID_CHAR）。
const apiTarget = process.env.VITE_API_TARGET ?? 'http://127.0.0.1:18081'
const devUser = process.env.VITE_DEV_USER ?? 'dev'
const devName = process.env.VITE_DEV_NAME ?? 'Dev Admin'
const devGroups = process.env.VITE_DEV_GROUPS ?? 'admins'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
    host: true, // 允许局域网设备访问，方便手机 / 平板调试
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: false,
        headers: {
          'Remote-User': devUser,
          'Remote-Name': devName,
          'Remote-Groups': devGroups,
        },
      },
      '/icons': {
        target: apiTarget,
        changeOrigin: false,
      },
    },
  },
})
