import { Router } from 'express'
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { zipStore } from '../lib/zip.js'

// Public: download the WordPress plugin as an installable .zip. GPL code, no
// tenant data — safe to be unauthenticated. Zipped on first request, cached.
export const pluginRouter = Router()

const here = path.dirname(fileURLToPath(import.meta.url))
// dist/routes → repo root is ../../../.. ; also try cwd (prod ecosystem cwd is
// the repo root) so it works in dev and prod regardless of where node started.
const CANDIDATES = [
  path.resolve(here, '../../../../wp-plugin/uwebsites/uwebsites.php'),
  path.resolve(process.cwd(), 'wp-plugin/uwebsites/uwebsites.php'),
]

let cache: Buffer | null = null

async function readPlugin(): Promise<Buffer> {
  for (const p of CANDIDATES) {
    try { return await readFile(p) } catch { /* try next */ }
  }
  throw new Error('plugin source not found')
}

pluginRouter.get('/uwebsites.zip', async (_req, res) => {
  try {
    if (!cache) {
      const php = await readPlugin()
      // WP expects a top-level folder matching the plugin slug.
      cache = zipStore([{ name: 'uwebsites/uwebsites.php', data: php }])
    }
    res.setHeader('Content-Type', 'application/zip')
    res.setHeader('Content-Disposition', 'attachment; filename="uwebsites.zip"')
    res.setHeader('Cache-Control', 'public, max-age=300')
    res.send(cache)
  } catch (e: any) {
    res.status(500).json({ ok: false, error: 'Plugin download unavailable: ' + (e?.message || 'unknown') })
  }
})
