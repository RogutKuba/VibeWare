import z from 'zod';

export const envSchema = z.object({
  DAYTONA_API_KEY: z.string().min(1),
  DATABASE_URL: z.string().min(1),
  ANTHROPIC_API_KEY: z.string().min(1),
  VERCEL_TOKEN: z.string().min(1),
  API_URL: z.string().min(1),
  GIT_PERSONAL_TOKEN: z.string().min(1),
});

export const env = envSchema.parse(process.env);
