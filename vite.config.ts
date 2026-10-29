import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import {defineConfig} from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.'),
    },
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'core-vendor': ['react', 'react-dom', 'zustand', 'axios', 'dexie', 'date-fns'],
          'map-vendor': ['leaflet', 'react-leaflet', '@geoman-io/leaflet-geoman-free'],
          'ui-vendor': ['framer-motion', 'lucide-react'],
        },
      },
    },
  },
  server: {
    fs: { deny: ['.env', '.env.*', '*.{crt,pem}', '**/.git/**', '**/.private/**'] },
    // Set DISABLE_HMR=true to stop live reload while files are being edited.
    hmr: process.env.DISABLE_HMR !== 'true',
  },
});
