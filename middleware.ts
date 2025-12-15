import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || ''

  // Detect iOS 12 or older
  const isLegacyIOS = /OS (1[0-2]|[1-9])_/.test(userAgent) && /iPhone|iPad|iPod/.test(userAgent)

  // Redirect Logic
  if (isLegacyIOS) {
    // If they are NOT already on the legacy route, send them there
    if (!request.nextUrl.pathname.startsWith('/legacy')) {
       return NextResponse.redirect(new URL('/legacy', request.url))
    }
  }

  return NextResponse.next()
}

export const config = {
  // Exclude API and static files
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
}