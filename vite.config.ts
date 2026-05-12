import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

const base = process.env.VITE_BASE_PATH ?? '/';
const openAiCompatibleProxyTarget = process.env.VITE_OPENAI_COMPAT_PROXY_TARGET?.replace(/\/+$/, '');

export default defineConfig({
  base,
  server: openAiCompatibleProxyTarget
    ? {
        proxy: {
          '/openai-compatible-proxy': {
            target: openAiCompatibleProxyTarget,
            changeOrigin: true,
            secure: true,
            rewrite: (path) => path.replace(/^\/openai-compatible-proxy/, '') || '/',
          },
        },
      }
    : undefined,
  plugins: [
    react(),
    tailwindcss(),
    viteCommonjs(),
  ],
  build: {
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('@cornerstonejs')) return 'cornerstone-vendor';
          if (id.includes('lucide-react')) return 'icons';
          if (id.includes('react') || id.includes('scheduler')) return 'react-vendor';
        },
      },
    },
  },
  optimizeDeps: {
    exclude: ['@cornerstonejs/dicom-image-loader'],
    include: ['dicom-parser'],
  },
  worker: {
    format: 'es',
  },
  assetsInclude: ['**/*.wasm'],
});
