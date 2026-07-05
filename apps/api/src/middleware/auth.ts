import type { Request, Response, NextFunction } from 'express'
import { SignJWT, jwtVerify } from 'jose'

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET!)
const COOKIE = 'session'

export interface AuthRequest extends Request {
  user?: { id: string; accountId: string; email: string }
}

// Read + verify the session from a request without failing the response —
// returns the user payload or null. Used by the Google data-OAuth callback,
// which is a top-level redirect (not an API call) but still carries the cookie.
export async function sessionFromReq(req: Request): Promise<{ id: string; accountId: string; email: string } | null> {
  try {
    const token = (req as any).cookies?.[COOKIE]
    if (!token) return null
    const { payload } = await jwtVerify(token, secret())
    return { id: payload.id as string, accountId: payload.accountId as string, email: payload.email as string }
  } catch { return null }
}

export async function signSession(payload: { id: string; accountId: string; email: string }) {
  return new SignJWT(payload)
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('7d')
    .sign(secret())
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    maxAge: 7 * 24 * 60 * 60 * 1000,
    path: '/',
    ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}),
  })
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(COOKIE, { path: '/', ...(process.env.COOKIE_DOMAIN ? { domain: process.env.COOKIE_DOMAIN } : {}) })
}

export async function requireAuth(req: AuthRequest, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE]
    if (!token) return res.status(401).json({ ok: false, error: 'unauthenticated' })
    const { payload } = await jwtVerify(token, secret())
    req.user = { id: payload.id as string, accountId: payload.accountId as string, email: payload.email as string }
    next()
  } catch {
    res.status(401).json({ ok: false, error: 'invalid session' })
  }
}
