/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server output, so the Docker image needs no node_modules.
  output: "standalone",
};

export default nextConfig;
