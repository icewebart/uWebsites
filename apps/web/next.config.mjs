import path from 'node:path'
import { fileURLToPath } from 'node:url'
const __dirname = path.dirname(fileURLToPath(import.meta.url))

/** @type {import('next').NextConfig} */
// output: 'standalone' so PM2 runs .next/standalone/.../server.js directly
// (uReferrals pattern — avoids the pnpm-shim orphan-process issue).
// outputFileTracingRoot = monorepo root so pnpm-workspace deps are bundled.
const nextConfig = {
  output: 'standalone',
  reactStrictMode: true,
  outputFileTracingRoot: path.join(__dirname, '../../'),
}
export default nextConfig
