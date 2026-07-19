import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The proxy block only matters during `npm run dev` (outside Docker); in the
// container nginx does this routing. It lets you run the FE against a stack
// that's up on :8080.
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
      '/r': 'http://localhost:8080',
    },
  },
});
