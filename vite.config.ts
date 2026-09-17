import { defineConfig } from 'vite'

// The EvenG2 app (`npm run pack`) is served from its own package root, so it
// always needs base "/". Only the GitHub Pages build needs the "/evenapp/"
// subpath prefix — set via BUILD_TARGET=pages in the Pages workflow.
export default defineConfig({
  base: process.env.BUILD_TARGET === 'pages' ? '/ibt2026-check/' : '/',
  server: {
    host: '0.0.0.0',
    port: 5173,
  },
  build: {
    outDir: 'dist',
  },
})
