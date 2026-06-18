/** @type {import('next').NextConfig} */
const nextConfig = {
  // Allow larger uploads to the server action / route handler
  experimental: {
    serverActions: {
      bodySizeLimit: "100gb",
    },
  },
};

export default nextConfig;
