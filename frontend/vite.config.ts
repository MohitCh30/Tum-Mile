import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import path from "path";

export default defineConfig({
  root: ".",
  plugins: [react()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  server: {
    port: 5173,
    proxy: {
      // 3007 is the API. Overridable so a second local copy can run beside
      // the production service on this machine without talking to it.
      "/api": process.env.TUMMILE_API ?? "http://localhost:3007",
    },
  },
  // Production, behind the Cloudflare tunnel. cloudflared sends /api/*
  // straight to the API and everything else here. Vite refuses Host
  // headers it does not recognise, so the public hostname is named.
  preview: {
    host: "127.0.0.1",
    port: 4173,
    strictPort: true,
    allowedHosts: ["tummile.mohitchdev.me"],
  },
});