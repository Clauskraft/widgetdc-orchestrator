/// <reference types="vitest" />
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'
import path from 'path'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    environment: 'happy-dom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.{test,spec}.{ts,tsx}'],
    exclude: [
      'node_modules',
      'dist',
      '.next',
      'frontend-v4',
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json', 'html'],
      exclude: [
        'node_modules/',
        'src/test/',
        '**/*.d.ts',
        '**/*.config.ts',
        '**/routeTree.gen.ts',
        '**/components/ui/**',
      ],
    },
    server: {
      deps: {
        inline: ['@tanstack/react-router'],
      },
    },
    // Allow expected rejections in tests
    onConsoleLog(log: string) {
      if (log.includes('ERR_BAD_RESPONSE')) return false
      if (log.includes('Unhandled Errors')) return false
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
