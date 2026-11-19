import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  // Permite abrir el servidor de desarrollo desde un celular en la misma red (IP local)
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", ...(process.env.DEV_ORIGINS?.split(",").filter(Boolean) ?? [])],
  serverExternalPackages: ["better-sqlite3"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
