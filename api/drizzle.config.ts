import dotenv from 'dotenv';
import { defineConfig } from 'drizzle-kit';

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error('DATABASE_URL is not set');
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/db/**/*.db.ts',
  out: './drizzle',
  dbCredentials: {
    url: DATABASE_URL,
  },
});
