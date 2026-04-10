import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { viteCommonjs } from '@originjs/vite-plugin-commonjs';

export default defineConfig({
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
