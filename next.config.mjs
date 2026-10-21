/** @type {import('next').NextConfig} */
const nextConfig = {
  // Shopify's app proxy requests the root as /portal/ — answer it directly instead of redirecting off averyled.com.
  skipTrailingSlashRedirect: true,
  serverExternalPackages: ['better-sqlite3', 'unpdf'],
  experimental: { serverActions: { bodySizeLimit: '20mb' } },
};
export default nextConfig;
