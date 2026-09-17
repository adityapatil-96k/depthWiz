import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'
import * as cesiumModule from 'vite-plugin-cesium'
import type { Plugin } from 'vite'

const cesium = (cesiumModule as unknown as { default: () => Plugin }).default

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), cesium()],
  server: { proxy: { '/api': 'http://localhost:8787' } },
})
