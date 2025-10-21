import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

const USER_TO_DEPLOYMENTS_MAP = {
  user_34OPUHayKIB0u2jdw8UdCbgT2QL:
    'vibe-ware-git-vibeware-d4o6dbeiab4hz9rsfb-jnl-rogut-kuba.vercel.app',
  user_34OQYLsOuLRH85ySWzWBeQRQ4Lr:
    'vibe-ware-git-vibeware-dy7ucmaagrcx75lfcmgu7-rogut-kuba.vercel.app',
};

const vibewareMiddleware = (id: string) => {
  return (request: NextRequest) => {
    // Prevent rewrite loops by checking if we've already rewritten
    if (request.headers.get('x-middleware-rewrite')) {
      console.log('Already rewritten, skipping middleware');
      return NextResponse.next();
    }

    const currentHost = request.nextUrl.hostname;
    const pathname = request.nextUrl.pathname;
    const search = request.nextUrl.search;

    console.log('=== MIDDLEWARE DEBUG ===');
    console.log('User ID:', id);
    console.log('Current host:', currentHost);
    console.log('Pathname:', pathname);

    if (id in USER_TO_DEPLOYMENTS_MAP) {
      const targetHost =
        USER_TO_DEPLOYMENTS_MAP[id as keyof typeof USER_TO_DEPLOYMENTS_MAP];

      console.log('Target host:', targetHost);
      console.log('Current host matches target?', currentHost === targetHost);

      // Only rewrite if we're NOT already on the target deployment
      if (currentHost !== targetHost) {
        // Create a new URL object for the rewrite
        const rewriteUrl = new URL(request.url);
        rewriteUrl.hostname = targetHost;

        console.log('Rewriting to:', rewriteUrl.toString());

        const response = NextResponse.rewrite(rewriteUrl);
        // Add header to prevent loops
        response.headers.set('x-middleware-rewrite', 'true');

        return response;
      } else {
        console.log('Already on target host, no rewrite needed');
      }
    } else {
      console.log('User not in deployment map');
    }

    return NextResponse.next();
  };
};

export default clerkMiddleware(async (auth, req) => {
  return vibewareMiddleware((await auth()).userId ?? '')(req);
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
