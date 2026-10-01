/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Self-contained server output, so the Docker image needs no node_modules.
  output: "standalone",
  // AGENTS.md here is hand-written and more specific than the block `next dev`
  // appends on every run. Its one durable point - that Next 16 diverges from
  // older training data, so check node_modules/next/dist/docs/ - is recorded in
  // AGENTS.md instead.
  agentRules: false,
};

export default nextConfig;
