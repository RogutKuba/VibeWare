import { deploymentsTable } from '@/db/deployment.db';
import { Id } from '@/lib/id';
import { text, pgTable, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const sandboxesTable = pgTable('sandboxes', {
  id: text('id').$type<Id<'sandbox'>>().primaryKey(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  daytonaSandboxId: text('daytona_sandbox_id').notNull(),
  deploymentId: text('deployment_id').$type<Id<'deployment'>>().notNull(),
});

export type SandboxEntity = typeof sandboxesTable.$inferSelect;
