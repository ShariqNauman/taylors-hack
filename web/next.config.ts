import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Local preview only: let a phone on the same Wi-Fi or hotspot (and an https
  // tunnel) load the dev server, so laptop and phone share one demo store.
  allowedDevOrigins: ["172.20.10.2", "kaylas-macbook.local", "*.trycloudflare.com"],
};

export default nextConfig;
