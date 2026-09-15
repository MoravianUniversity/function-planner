import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Pin rarely changing node_modules into their own hashed chunks so frequent
 * app / function-planner-ui deploys do not force browsers to re-download GoJS etc.
 */
function vendorChunk(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined;

  // Workspace UI package changes with the product — keep it out of stable vendors.
  if (id.includes('function-planner-ui') || id.includes('@function-planner')) {
    return undefined;
  }

  if (id.includes('/gojs/')) {
    return 'vendor-gojs';
  }
  if (
    id.includes('/react/') ||
    id.includes('/react-dom/') ||
    id.includes('/react-router') ||
    id.includes('/scheduler/')
  ) {
    return 'vendor-react';
  }
  if (
    id.includes('/yjs/') ||
    id.includes('/y-websocket/') ||
    id.includes('/y-protocols/') ||
    id.includes('/y-indexeddb/') ||
    id.includes('/lib0/') ||
    id.includes('/fast-diff/')
  ) {
    return 'vendor-yjs';
  }
  if (id.includes('/@fortawesome/') || id.includes('/@base-ui/')) {
    return 'vendor-ui';
  }
  if (id.includes('/@tanstack/') || id.includes('/zod/') || id.includes('/sonner/')) {
    return 'vendor-data';
  }

  return undefined;
}

export default defineConfig({
  plugins: [react()],
  // Workspace UI package must not be prebundled — source changes (extraFabs, etc.)
  // would otherwise stay stale in node_modules/.vite until a forced re-optimize.
  optimizeDeps: {
    exclude: ['function-planner-ui'],
    include: ['gojs', 'yjs', 'y-websocket', 'y-indexeddb', 'fast-diff']
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: vendorChunk
      }
    }
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
