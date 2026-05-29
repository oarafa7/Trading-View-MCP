/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The gateway is a separate service; the browser talks to it via NEXT_PUBLIC_GATEWAY_URL.
};

export default nextConfig;
