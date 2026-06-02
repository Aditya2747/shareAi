/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  swcMinify: true,
  serverExternalPackages: ['tweetnacl'],
};

module.exports = nextConfig;
