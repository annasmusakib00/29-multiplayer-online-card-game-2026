import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// The game server (server.js) runs on :3000. We proxy the socket connection and
// the original game assets (card images, sounds) so the client works from any
// device on the LAN (e.g. http://192.168.x.x:5173) without CORS issues.
const BACKEND = 'http://localhost:3000'

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    proxy: {
      '/socket.io': { target: BACKEND, ws: true, changeOrigin: true },
      '/img': { target: BACKEND, changeOrigin: true },
      '/serverPingCheck': { target: BACKEND, changeOrigin: true },
    },
  },
})
