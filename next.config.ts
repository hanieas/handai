import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 'standalone' for web deployment / Docker (bundles server + minimal node_modules).
  // 'export' for Tauri desktop (static HTML/CSS/JS, no API routes needed — browser
  //   calls LLM providers directly and uses tauri-plugin-sql for the database).
  // Toggle via: TAURI_BUILD=1 npm run build:tauri
  output: process.env.TAURI_BUILD === "1" ? "export" : "standalone",
  devIndicators: false,
  // Tauri dev mode loads the Next.js dev server from 127.0.0.1 (not localhost),
  // triggering a cross-origin warning. Explicitly allow it to silence the noise.
  allowedDevOrigins: ["127.0.0.1"],
  // pdf-parse v2 and pdfjs-dist v4 are ESM-only packages. They CANNOT be listed
  // in serverExternalPackages because that path uses require(), which fails on ESM.
  // Let Turbopack bundle them normally. The server-side code already disables the
  // pdfjs worker (workerSrc = "") so no worker resolution is needed at runtime.
};

export default nextConfig;
