/** @type {import('next').NextConfig} */
export default {
  reactStrictMode: true,
  webpack(config) {
    // src/ uses ESM-correct ".js" specifiers so vitest and tsx resolve them.
    // Webpack needs telling those map to the TypeScript sources.
    config.resolve.extensionAlias = {
      '.js': ['.ts', '.tsx', '.js'],
      '.mjs': ['.mts', '.mjs'],
    };
    return config;
  },
};
