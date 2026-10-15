import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

// `npm run build`         → dist/        (static site, serve with `npm run preview`)
// `npm run build:single`  → dist-single/ (ONE self-contained index.html: JS, CSS and
//                           fonts inlined — double-click to run offline on any laptop)
export default defineConfig(({ mode }) => {
  const single = mode === 'single';
  return {
    base: mode === 'pages' ? '/Glyph/' : './',
    plugins: [react(), tailwindcss(), ...(single ? [viteSingleFile()] : [])],
    build: {
      target: 'es2022',
      outDir: single ? 'dist-single' : 'dist',
      assetsInlineLimit: single ? Number.MAX_SAFE_INTEGER : 4096,
      chunkSizeWarningLimit: 1500,
    },
    server: { port: 5173 },
    preview: { port: 4173 },
  };
});
