import type { Request, Response, NextFunction } from 'express'
import { SignJWT, jwtVerify } from 'jose'

const secret = () => new TextEncoder().encode(process.env.JWT_SECRET!)
const COOKIE = 'session'

export interface AuthRequest extends Request {
  user?: { id: string; accountId: string; email: string }
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
