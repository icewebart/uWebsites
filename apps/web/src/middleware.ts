import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

// Presence-check the shared session cookie for routing. Real verification
// (signature/expiry) happens server-side in the API via /auth/me.
export function middleware(req: NextRequest) {
  const hasSession = req.cookies.has('session')
  const { pathname } = req.nextUrl
  const isAuthPage = pathname === '/login' || pathname === '/signup'

  if (!hasSession && !isAuthPage) {
    const url = req.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }
  if (hasSession && isAuthPage) {
    const url = req.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:css|js|png|jpg|svg|ico)).*)'],
}
