import { Id } from '@/lib/id';
import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const deploymentsTable = pgTable('deployments', {
  id: text('id').$type<Id<'deployment'>>().primaryKey(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),
  prompt: text('prompt').notNull(),
  status: text('status')
    .$type<
      | 'pending'
      | 'running_code'
      | 'completed_code'
      | 'failed_code'
      | 'running_deployment'
      | 'completed_deployment'
      | 'failed_deployment'
      | 'failed'
    >()
    .notNull()
    .default('pending'),
  logs: jsonb('logs'),
  error: jsonb('error'),
});

export type DeploymentEntity = typeof deploymentsTable.$inferSelect;
