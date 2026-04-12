import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { TanStackRouterVite } from '@tanstack/router-plugin/vite'
import path from 'path'

export default defineConfig({
  plugins: [TanStackRouterVite(), react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  build: {
    outDir: '../frontend-v4',
    emptyOutDir: true,
    sourcemap: false,
    minify: 'esbuild',
    chunkSizeWarningLimit: 200, // kB per chunk
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // React core — must come first to avoid circular chunks
            if (id.includes('node_modules/react/') || id.includes('node_modules/react-dom/') || id.includes('node_modules/scheduler/')) return 'react-vendor'
            // TanStack
            if (id.includes('@tanstack/react-query')) return 'query-vendor'
            if (id.includes('@tanstack/react-router')) return 'router-vendor'
            // Heavy visualization — isolated
            if (id.includes('recharts') || id.includes('d3-') || id.includes('victory-')) return 'charts-vendor'
            // Icon library — large
            if (id.includes('lucide-react')) return 'icons-vendor'
            // Radix UI primitives
            if (id.includes('@radix-ui/')) return 'ui-vendor'
            // HTTP client
            if (id.includes('axios')) return 'http-vendor'
            // Validation
            if (id.includes('zod')) return 'zod-vendor'
            // Everything else goes to vendor
            return 'vendor'
          }
        },
      },
    },
  },
})
