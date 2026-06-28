import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Presence-check the shared session cookie for routing. Real verification
// (signature/expiry) happens server-side in the API via /auth/me.
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has('session')
  const { pathname } = req.nextUrl
  const isAuthPage = pathname === '/login' || pathname === '/signup'

  // Behind the nginx/Cloudflare proxy, req.nextUrl resolves to the upstream
  // host (localhost:3014). Build redirects from the forwarded host so the
  // browser is sent to app.uwebsites.net, not the origin port.
  const host = req.headers.get('x-forwarded-host') || req.headers.get('host')
  const proto = req.headers.get('x-forwarded-proto') || 'https'
  const base = host ? `${proto}://${host}` : req.nextUrl.origin

  if (!hasSession && !isAuthPage) return NextResponse.redirect(new URL('/login', base))
  if (hasSession && isAuthPage) return NextResponse.redirect(new URL('/', base))
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|png|jpg|svg|ico)).*)'],
}
