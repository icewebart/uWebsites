import express from 'express'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { authRouter } from './routes/auth.js'
import { workspacesRouter } from './routes/workspaces.js'
import { importRouter } from './routes/import.js'
import { googleRouter } from './routes/google.js'
import { pagesRouter } from './routes/pages.js'
import { publishRouter } from './routes/publish.js'
import { aiRouter } from './routes/ai.js'
import { domainsRouter } from './routes/domains.js'

const app = express()
app.set('trust proxy', 1) // Cloudflare is the first hop in prod
const PORT = process.env.PORT || 4005

const allowed = [
  process.env.FRONTEND_URL || 'http://localhost:3014',
  process.env.ADMIN_URL || 'http://localhost:3015',
]
app.use(cors({
  origin: (origin, cb) => (!origin || allowed.includes(origin)) ? cb(null, true) : cb(new Error('CORS')),
  credentials: true,
}))
app.use(express.json())
app.use(cookieParser())

app.get('/health', (_req, res) => res.json({ ok: true, service: 'uwebsites-api', version: '0.1.0', ts: new Date().toISOString() }))

app.use('/auth', authRouter)
app.use('/auth', googleRouter)
app.use('/workspaces', workspacesRouter)
app.use('/workspaces', publishRouter)
app.use('/import', importRouter)
app.use('/pages', pagesRouter)
app.use('/ai', aiRouter)
// Public — the section catalog used by the editor's section-gallery picker
// and as grounding for the chat. No tenant data; safe to be unauthenticated.
import { SECTIONS as __SECTIONS } from './lib/sections.js'
app.get('/sections', (_req, res) => res.json({ ok: true, data: __SECTIONS }))
app.use('/workspaces', domainsRouter)

app.listen(PORT, () => console.log(`[uwebsites-api] listening on :${PORT}`))
