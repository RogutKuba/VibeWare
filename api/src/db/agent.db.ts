import { Id } from '@/lib/id';
import { pgTable, text, timestamp, jsonb } from 'drizzle-orm/pg-core';

export const agentsTable = pgTable('agent', {
  id: text('id').$type<Id<'agent'>>().primaryKey(),
  createdAt: timestamp('created_at', { mode: 'string' }).defaultNow(),
  updatedAt: timestamp('updated_at', { mode: 'string' }).defaultNow(),

  // Relations
  deploymentId: text('deployment_id').notNull(),

  // Claude Code Agent Details
  claudeSessionId: text('claude_session_id'), // Claude Code session identifier
  daytonaSandboxId: text('daytona_sandbox_id').notNull(), // Sandbox where Claude is working

  // Task Information
  prompt: text('prompt').notNull(), // The prompt to implement
  implementationPrompt: text('implementation_prompt').notNull(), // Full prompt given to Claude

  // Status Tracking
  status: text('status')
    .$type<'pending' | 'running' | 'completed' | 'failed'>()
    .notNull()
    .default('pending'),

  // Results
  implementationSummary: text('implementation_summary'), // Summary of what Claude did
  filesModified: jsonb('files_modified').$type<string[]>(), // List of files changed
  codeChanges: jsonb('code_changes').$type<
    {
      file: string;
      changes: string;
    }[]
  >(), // Detailed code changes
  logs: text('logs'), // Full logs from Claude session
  errorMessage: text('error_message'), // Error message if failed

  // Timing
  startedAt: timestamp('started_at', { mode: 'string' }),
  completedAt: timestamp('completed_at', { mode: 'string' }),
});

export type AgentEntity = typeof agentsTable.$inferSelect;
