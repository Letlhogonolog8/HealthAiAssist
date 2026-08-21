import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";
import runtimeErrorOverlay from "@replit/vite-plugin-runtime-error-modal";

export default defineConfig({
  plugins: [
    react({
      include: "**/*.{jsx,tsx}",
    }),
    runtimeErrorOverlay(),
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
        }
      }
    },
  },
});
