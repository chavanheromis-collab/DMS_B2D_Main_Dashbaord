import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Vercel serves the app from the domain root, so base stays '/'
// (this only needed to be a sub-path like '/repo-name/' for GitHub Pages).
export default defineConfig({
  plugins: [react()],
  base: '/',
  build: {
    rollupOptions: {
      output: {
        // Split the two big third-party trees out of the app bundle.
        //
        // Both are large and both change far less often than our own code,
        // so keeping them in separate files means a normal deploy only
        // invalidates the small app chunk -- returning users re-download a
        // few KB rather than 1.4 MB. Charts are additionally split from
        // Firebase because the login screen needs one and not the other.
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          charts: ['recharts'],
          firebase: ['firebase/app', 'firebase/auth', 'firebase/firestore'],
        },
      },
    },
    // The chunks below are genuinely large libraries, not accidental bloat;
    // raising the warning line stops it crying wolf on every build.
    chunkSizeWarningLimit: 700,
  },
  server: {
    // In local dev (npm run dev), the browser calls /api/sheets like it
    // does in production; Vite forwards that to the local Express server
    // in server/local-api.js, which runs the real api/sheets.js handler.
    // Only matters for `vite`/`npm run dev` -- Vercel's own dev/deploy
    // routing (vercel.json) is unaffected by this.
    proxy: {
      '/api': {
        target: `http://localhost:${process.env.LOCAL_API_PORT || 3001}`,
        changeOrigin: true,
      },
    },
  },
})
