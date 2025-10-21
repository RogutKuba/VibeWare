import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextRequest, NextResponse } from 'next/server';

const USER_TO_DEPLOYMENTS_MAP = {
  user_34OPUHayKIB0u2jdw8UdCbgT2QL:
    'vibe-ware-git-vibeware-d4o6dbeiab4hz9rsfb-jnl-rogut-kuba.vercel.app/',
  user_34OQYLsOuLRH85ySWzWBeQRQ4Lr:
    'vibe-ware-git-vibeware-dy7ucmaagrcx75lfcmgu7-rogut-kuba.vercel.app',
};

const vibewareMiddleware = (id: string) => {
  return (request: NextRequest) => {
    const rewrite =
      USER_TO_DEPLOYMENTS_MAP[id as keyof typeof USER_TO_DEPLOYMENTS_MAP];
    if (!rewrite) {
      return NextResponse.next();
    }

    console.log(`Rewriting to ${rewrite}`);
    return NextResponse.rewrite(`${rewrite}${request.nextUrl.pathname}`);
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
