/** @type {import('next').NextConfig} */
const nextConfig = {
  serverExternalPackages: ['better-sqlite3', 'unpdf'],
  experimental: { serverActions: { bodySizeLimit: '20mb' } },
};
export default nextConfig;
