/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: {
    proxyTimeout: 120000,
  },
  async rewrites() {
    const internalApi = process.env.INTERNAL_API_URL || "http://backend:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${internalApi}/api/:path*`,
      },
      {
        source: "/health",
        destination: `${internalApi}/health`,
      },
    ];
  },
};

export default nextConfig;

