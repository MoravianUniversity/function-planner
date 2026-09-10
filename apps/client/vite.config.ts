import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Workspace UI package must not be prebundled — source changes (extraFabs, etc.)
  // would otherwise stay stale in node_modules/.vite until a forced re-optimize.
  optimizeDeps: {
    exclude: ['function-planner-ui'],
    include: ['gojs', 'yjs', 'y-websocket', 'y-indexeddb', 'fast-diff']
  },
  server: {
    port: 5174,
    watch: {
      // Follow the symlink into packages/function-planner-ui
      ignored: ['!**/node_modules/function-planner-ui/**']
    },
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/auth': {
        target: 'http://localhost:3000',
        changeOrigin: true
      },
      '/yjs': {
        target: 'http://localhost:3000',
        changeOrigin: true,
        ws: true
      }
    }
  }
});
