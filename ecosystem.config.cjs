// PM2 — one process per server surface. Mirrors the uReferrals deploy pattern:
// build to dist/ (api) and standalone (next), call node directly, env via --env-file.
module.exports = {
  apps: [
    {
      name: 'uwebsites-api',
      script: 'apps/api/dist/index.js',
      cwd: '/www/wwwroot/uwebsites',
      node_args: '--env-file=/www/wwwroot/uwebsites/apps/api/.env',
      env: { PORT: '4005', NODE_ENV: 'production', COOKIE_DOMAIN: '.uwebsites.net' },
    },
    {
      name: 'uwebsites-web',
      script: 'apps/web/.next/standalone/apps/web/server.js',
      cwd: '/www/wwwroot/uwebsites',
      env: { PORT: '3014', HOSTNAME: '127.0.0.1', NODE_ENV: 'production' },
    },
    {
      name: 'uwebsites-admin',
      script: 'apps/admin/.next/standalone/apps/admin/server.js',
      cwd: '/www/wwwroot/uwebsites',
      env: { PORT: '3015', NODE_ENV: 'production' },
    },
    {
      name: 'uwebsites-website',
      script: 'apps/website/.next/standalone/apps/website/server.js',
      cwd: '/www/wwwroot/uwebsites',
      env: { PORT: '3016', NODE_ENV: 'production' },
    },
  ],
}
