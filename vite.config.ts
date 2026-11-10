import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths, so the build runs from any folder (itch.io, GitHub Pages, a zip)
  base: './',
  server: { port: 5173 },
  build: { target: 'es2022', chunkSizeWarningLimit: 3000 },
});
