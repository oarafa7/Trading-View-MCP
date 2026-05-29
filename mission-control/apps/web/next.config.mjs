/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Static export so the gateway can serve the UI on the same origin as the API (single link,
  // works for tunnels and single-container deploys). `next dev` ignores this for local dev.
  output: "export",
  trailingSlash: true,
  images: { unoptimized: true },
};

export default nextConfig;
