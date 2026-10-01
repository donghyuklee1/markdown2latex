import nextConfig from "eslint-config-next/core-web-vitals";

/**
 * Flat config: `next lint` was removed in Next 16, so ESLint runs directly.
 * @type {import("eslint").Linter.Config[]}
 */
const config = [
  { ignores: [".next/**", "node_modules/**", "out/**"] },
  ...(Array.isArray(nextConfig) ? nextConfig : [nextConfig]),
];

export default config;
