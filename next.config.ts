import type { NextConfig } from "next";
import withPWA from "@ducanh2912/next-pwa";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          { key: "Cache-Control", value: "private, no-store" },
          { key: "Vary", value: "Cookie, Authorization" },
        ],
      },
    ];
  },
};

export default withPWA({
  dest: "public",
  register: true,
  workboxOptions: {
    skipWaiting: true,
    clientsClaim: true,
    runtimeCaching: [
      {
        urlPattern: /\/api\//,
        handler: "NetworkOnly",
        method: "GET",
      },
    ],
  },
  disable: process.env.NODE_ENV === "development",
})(nextConfig);
