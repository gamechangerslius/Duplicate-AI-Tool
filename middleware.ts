import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

export async function middleware(request: NextRequest) {
  let response = NextResponse.next({
    request: {
      headers: request.headers,
    },
  })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        get(name: string) {
          return request.cookies.get(name)?.value
        },
        set(name: string, value: string, options: any) {
          request.cookies.set({
            name,
            value,
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value,
            ...options,
          })
        },
        remove(name: string, options: any) {
          request.cookies.set({
            name,
            value: '',
            ...options,
          })
          response = NextResponse.next({
            request: {
              headers: request.headers,
            },
          })
          response.cookies.set({
            name,
            value: '',
            ...options,
          })
        },
      },
    }
  )

  const {
    data: { user },
  } = await supabase.auth.getUser()

  // If user is logged in, ensure they have a business record
  if (user) {
    try {
      const { data: business } = await supabase
        .from('businesses')
        .select('id')
        .eq('owner_id', user.id)
        .single()

      // Auto-create business if doesn't exist
      if (!business) {
        await supabase.from('businesses').insert({
          owner_id: user.id,
          name: 'My Business',
          slug: `business-${user.id.substring(0, 8)}`,
        })
      }
    } catch (error) {
      // If tables don't exist yet, just continue (user can still use the app)
      console.log('Business table not found or error:', error)
    }
  }

  // Redirect to auth if accessing any app route without login
  const pathname = request.nextUrl.pathname
  const isAuthRoute = pathname.startsWith('/auth')
  const isNextRoute = pathname.startsWith('/_next')
  const isPublicAsset = pathname === '/favicon.ico' || pathname === '/robots.txt' || pathname === '/sitemap.xml'
  const isAuthApi = pathname.startsWith('/api/auth')

  if (!user && !isAuthRoute && !isNextRoute && !isPublicAsset && !isAuthApi) {
    return NextResponse.redirect(new URL('/auth', request.url))
  }

  return response
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|robots.txt|sitemap.xml).*)'],
}
