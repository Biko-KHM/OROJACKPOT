import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
      '@tg-lottery/shared': path.resolve(__dirname, '../../packages/shared/src/index.ts'),
    },
  },
  server: {
    port: 5180,
    strictPort: true,
    proxy: {
      '/api': { target: 'http://localhost:3005', changeOrigin: true },
      '/auth': { target: 'http://localhost:3005', changeOrigin: true },
      '/lotteries': { target: 'http://localhost:3005', changeOrigin: true },
      '/reservations': { target: 'http://localhost:3005', changeOrigin: true },
      '/uploads': { target: 'http://localhost:3005', changeOrigin: true },
      '/me': { target: 'http://localhost:3005', changeOrigin: true },
      '/admin': {
        target: 'http://localhost:3005',
        changeOrigin: true,
        bypass: (req) => {
          if (req.headers.accept?.includes('text/html')) {
            return '/index.html';
          }
        },
      },
      '/health': { target: 'http://localhost:3005', changeOrigin: true },
      '/draws': { target: 'http://localhost:3005', changeOrigin: true },
      '/webhooks': { target: 'http://localhost:3005', changeOrigin: true },
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
    rollupOptions: {
      output: {
        manualChunks: {
          'vendor-react': ['react', 'react-dom'],
          'vendor-icons': ['lucide-react'],
        },
      },
    },
  },
});
