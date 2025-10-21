import { clerkMiddleware } from '@clerk/nextjs/server';
import { NextResponse } from 'next/server';

export default clerkMiddleware(async (auth, req) => {
  const { userId } = await auth();

  console.log('userId', userId);

  // Only redirect if user is authenticated
  if (userId) {
    const url = new URL(req.url);
    const currentHost = url.hostname;
    const targetHost = `${userId}.vercel.app`;

    // Only redirect if:
    // 1. We're in production (vercel.app domain)
    // 2. We're not already on the correct subdomain
    const isVercelDomain = currentHost.includes('vercel.app');
    const isCorrectSubdomain = currentHost === targetHost;

    if (isVercelDomain && !isCorrectSubdomain) {
      console.log('redirecting to', targetHost);
      // Create new URL with user-specific subdomain
      const redirectUrl = new URL(req.url);
      redirectUrl.hostname = targetHost;

      console.log('redirecting to', redirectUrl);

      return NextResponse.redirect(redirectUrl);
    }
  }

  // Continue with default Clerk middleware behavior
  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and all static files, unless found in search params
    '/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)',
    // Always run for API routes
    '/(api|trpc)(.*)',
  ],
};
