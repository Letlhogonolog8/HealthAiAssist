import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react({
      include: "**/*.{jsx,tsx}",
    }),
    runtimeErrorOverlay(),

    /**
     * Offline support.
     *
     * Guidelines §3.2 encourages offline and edge capability and §3.3 requires
     * low-bandwidth, offline-first operation. More concretely: the intended user
     * is a clinic on intermittent connectivity, and until now the application
     * was unusable the moment the connection dropped.
     *
     * What is cached, and what is deliberately not:
     *
     *   - The app shell is precached, so the interface loads with no network.
     *   - GET /api/models/cards is cached with a network-first strategy, so an
     *     offline client still knows which modalities have a model and can
     *     refuse the others rather than offering a menu it cannot serve.
     *   - **Nothing else under /api is cached at all.** A stale scan result, a
     *     stale review queue or a stale appointment is worse than an error,
     *     because it looks current. Clinical reads fail offline, visibly, and
     *     the queue in client/src/lib/scan-queue.ts holds writes.
     *
     * `registerType: autoUpdate` because a clinician should not have to notice
     * a "new version available" prompt to stop running a stale build of a
     * medical tool.
     */
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon-192.png", "icon-512.png", "icon-maskable-512.png"],
      manifest: {
        name: "HealthAI Assistant — cancer screening triage",
        short_name: "HealthAI",
        description:
          "Screening triage for skin and lung imaging. Every result requires clinician review; nothing here is a diagnosis.",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#0d1113",
        theme_color: "#0e6e6b",
        orientation: "portrait-primary",
        lang: "en-ZA",
        categories: ["medical", "health"],
        // The previous manifest.json carried `"icons": []`, which makes a PWA
        // non-installable — the install prompt never appears and the failure is
        // silent.
        icons: [
          { src: "/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icon-512.png", sizes: "512x512", type: "image/png" },
          {
            src: "/icon-maskable-512.png",
            sizes: "512x512",
            type: "image/png",
            purpose: "maskable",
          },
        ],
      },
      workbox: {
        // 6 MB: the admin dashboard chunk alone is 550 kB and the default 2 MB
        // ceiling silently drops the largest assets from the precache, which
        // produces an app shell that works offline until you open the one screen
        // that does not.
        maximumFileSizeToCacheInBytes: 6 * 1024 * 1024,
        globPatterns: ["**/*.{js,css,html,ico,png,svg,woff2}"],
        navigateFallbackDenylist: [/^\/api\//],
        runtimeCaching: [
          {
            urlPattern: /\/api\/models\/cards$/,
            handler: "NetworkFirst",
            options: {
              cacheName: "model-registry",
              networkTimeoutSeconds: 4,
              expiration: { maxEntries: 4, maxAgeSeconds: 60 * 60 * 24 },
              cacheableResponse: { statuses: [200] },
            },
          },
          {
            urlPattern: /^https:\/\/fonts\.(googleapis|gstatic)\.com\//,
            handler: "CacheFirst",
            options: {
              cacheName: "google-fonts",
              expiration: { maxEntries: 20, maxAgeSeconds: 60 * 60 * 24 * 365 },
              cacheableResponse: { statuses: [0, 200] },
            },
          },
        ],
      },
      devOptions: { enabled: false },
    }),
    ...(process.env.NODE_ENV !== "production" &&
    process.env.REPL_ID !== undefined
      ? [
          await import("@replit/vite-plugin-cartographer").then((m) =>
            m.cartographer(),
          ),
        ]
      : []),
  ],
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:5000',
        ws: true,
      },
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets"),
    },
  },
  root: path.resolve(import.meta.dirname, "client"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true,
    rollupOptions: {
      output: {
        // Only genuinely shared, genuinely eager dependencies are pinned to a
        // manual chunk. The previous config also forced recharts, framer-motion,
        // i18next and react-i18next into a single "vendor" chunk, which the
        // entry chunk then depended on — so every visitor downloaded 613 kB
        // (175 kB gzipped) of charting and animation code before the homepage
        // could paint, even though recharts is used only by the admin dashboard
        // and framer-motion only by the chatbot, both of which are lazy. Leaving
        // them unlisted lets Rollup place each one in the async chunk that
        // actually imports it.
        manualChunks: {
          react: ['react', 'react-dom'],
          query: ['@tanstack/react-query'],
          /**
           * recharts is deliberately NOT listed here.
           *
           * Adding `charts: ['recharts']` was tried and reverted. It did shrink
           * the admin dashboard chunk from 550 kB to 144 kB — and produced a
           * 696 kB `charts` chunk beside it, because a manual chunk pulls the
           * whole package in where the tree-shaken subset had been 550 kB. The
           * administrator's download went from 550 kB to 840 kB, so the change
           * that looked like a code-splitting win was a 53% regression.
           *
           * Same lesson as the `vendor` chunk described above. Rollup places a
           * dependency in the async chunk that imports it and shakes out what is
           * unused; naming a chunk overrides both. Measure the total, not the
           * chunk you were looking at.
           */
        }
      }
    },
  },
});
