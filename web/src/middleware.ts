import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

const USER_TO_DEPLOYMENTS_MAP = {
  user_34OPUHayKIB0u2jdw8UdCbgT2QL:
    'https://vibe-ware-2v5u64bdi-rogut-kuba.vercel.app',
  user_34OQYLsOuLRH85ySWzWBeQRQ4Lr:
    'https://vibe-ware-hljne9ta0-rogut-kuba.vercel.app',
};

const vibewareMiddleware = (id: string | null) => {
  console.log('vibewareID', id);
  return (request: NextRequest) => {
    // Prevent rewrite loops by checking if we've already rewritten
    if (request.headers.get('x-middleware-rewrite') || !id) {
      // console.log('Already rewritten, skipping middleware');
      return NextResponse.next();
    }

    const currentHost = request.nextUrl.hostname;
    const pathname = request.nextUrl.pathname;

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
        const rewriteUrl = new URL(targetHost);
        // if / is last char, dont add it to the rewrite url
        if (pathname.endsWith('/')) {
          rewriteUrl.pathname = rewriteUrl.pathname.slice(0, -1);
        }

        const requestHeaders = new Headers(request.headers);
        requestHeaders.set('x-middleware-rewrite', 'true');
        console.log('Rewriting to:', rewriteUrl.toString());
        return NextResponse.rewrite(rewriteUrl, {
          headers: requestHeaders,
        });
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
  console.log('auth exists', !!auth);

  try {
    const protect = await auth();
    return vibewareMiddleware(protect.userId ?? null)(req);
  } catch (error) {
    console.error('Error in clerkMiddleware', error);
    return NextResponse.next();
  }
  // const pathname = req.nextUrl.pathname;
  // // an exmaple to use any middleware you want to run before clerkMiddleware or to opt out clerkMiddleware.
  // if (
  //   pathname.startsWith('/_next') ||
  //   pathname.startsWith('/favicon.ico') ||
  //   pathname.includes('.')
  // ) {
  //   return NextResponse.next();
  // }

  // console.log('auth.fn', auth);

  // const protect = await auth();
  // return vibewareMiddleware(protect.userId ?? null)(req);
});

// export const config = {
//   matcher: [
//     // Skip Next.js internals and all static files, unless found in search params
//     '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
//     // Always run for API routes
//     '/(api|trpc)(.*)',
//   ],
// };
