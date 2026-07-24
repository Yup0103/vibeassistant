import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      includeAssets: ["icon.svg"],
      manifest: {
        name: "Personal Life Assistant",
        short_name: "Assistant",
        description: "Personal MCP-connected assistant — portfolio + food ordering",
        theme_color: "#FF6B45",
        background_color: "#FDF8F5",
        display: "standalone",
        start_url: "/",
        icons: [
          { src: "icon.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
          { src: "icon.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
        ],
      },
    }),
  ],
  server: {
    proxy: {
      "/auth": "http://localhost:5174",
      "/chat": "http://localhost:5174",
      "/swiggy": "http://localhost:5174",
    },
  },
});
