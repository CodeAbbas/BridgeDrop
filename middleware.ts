import { NextResponse } from 'next/server'
import type { NextRequest } from 'next/server'

export function middleware(request: NextRequest) {
  const userAgent = request.headers.get('user-agent') || ''
  
  // Detect iOS 12 or older
  const isLegacyIOS = /OS (1[0-2]|[1-9])_/.test(userAgent) && /iPhone|iPad|iPod/.test(userAgent)
  
  // CRITICAL: Check if they are already on the /legacy page to prevent infinite loops
  const isLegacyPage = request.nextUrl.pathname.startsWith('/legacy');

  if (isLegacyIOS && !isLegacyPage) {
    // Redirect to the internal legacy page
    return NextResponse.redirect(new URL('/legacy', request.url))
  }

  // If a modern device tries to access /legacy, optionally redirect them back to home
  // (Optional, but good for UX)
  if (!isLegacyIOS && isLegacyPage) {
     return NextResponse.redirect(new URL('/', request.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/((?!api|_next/static|_next/image|favicon.ico).*)',
}


