import { env } from '@/lib/env';
import { Vercel } from '@vercel/sdk';

export const vercel = new Vercel({
  bearerToken: env.VERCEL_TOKEN,
});
