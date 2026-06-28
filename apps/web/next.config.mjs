/** @type {import('next').NextConfig} */
// output: 'standalone' so PM2 runs .next/standalone/.../server.js directly
// (uReferrals pattern — avoids the pnpm-shim orphan-process issue).
const nextConfig = { output: 'standalone', reactStrictMode: true }
export default nextConfig
