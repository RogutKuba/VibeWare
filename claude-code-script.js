/**
 * Claude Code Runner Script
 *
 * This script runs inside a Daytona sandbox to execute Claude Code agent
 * and implement UX improvements autonomously.
 *
 * Usage: node run-claude-code.js
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

// Configuration injected by the API
const CONFIG = {
  deploymentId: 'd_4o6DbEIAb4HZ9RsFb-Jnl',
  apiUrl: 'https://pull-thriller-src-make.trycloudflare.com',
  prompt: `You are a senior software engineer tasked with implementing a feature from user feedback
      **Original User feedback:**
      Make the header red

      **Your Task:**
      Implement this feature in the codebase. The project is a Next.js e-commerce application located in the workspace/commerce directory.

      **Instructions:**
      1. Analyze the current codebase to understand the existing structure
      2. Implement the feature following React/Next.js best practices
      3. Ensure the implementation is clean, maintainable, and follows the existing code style`,
};

/**
 * Report results back to the API
 */
async function reportResults(data) {
  fs.writeFileSync('./logs.txt', JSON.stringify(data, null, 2));

  let reportResult = 'pending;';
  try {
    const response = await fetch(
      `${CONFIG.apiUrl}/deployment/${CONFIG.deploymentId}/agent-results`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      }
    );

    if (!response.ok) {
      const error = await response.text();
      reportResult = JSON.stringify(error, null, 2);
    } else {
      reportResult = 'success';
      console.log('Results reported successfully');
    }
  } catch (error) {
    console.error('Error reporting results:', error);
    reportResult = JSON.stringify(error, null, 2);
  } finally {
    fs.writeFileSync('./reportResults.txt', reportResult);
  }
}

/**
 * Extract summary and file changes from Claude's response
 */
function parseClaudeResponse(messages) {
  const summary = [];
  const filesModified = new Set();

  for (const message of messages) {
    if (message.type === 'result') {
      // Extract the final summary
      if (message.result) {
        summary.push(message.result);
      }
    } else if (message.type === 'tool_use' || message.type === 'tool_result') {
      // Track file modifications
      if (message.tool_name === 'Write' || message.tool_name === 'Edit') {
        if (message.parameters?.file_path) {
          filesModified.add(message.parameters.file_path);
        }
      }
    }
  }

  return {
    summary: summary.join('\n'),
    filesModified: Array.from(filesModified),
  };
}

/**
 * Main execution function
 */
async function main() {
  console.log('=== Claude Code Agent Starting ===');
  console.log(`Code Agent ID: ${CONFIG.codeAgentId}`);
  console.log(`Prompt: ${CONFIG.prompt.substring(0, 100)}...`);
  console.log('');

  const startTime = Date.now();
  const allMessages = [];
  let finalResult = null;

  try {
    // Update status to running
    await reportResults({
      status: 'running',
      startedAt: new Date().toISOString(),
    });

    console.log('Running Claude Code agent...');

    // Run Claude Code in single-shot mode
    for await (const message of query({
      prompt: CONFIG.prompt,
      options: {
        maxTurns: 20,
        allowedTools: ['Read', 'Write', 'Edit', 'Bash', 'Glob', 'Grep'],
      },
    })) {
      allMessages.push(message);

      // Log progress
      if (message.type === 'result') {
        finalResult = message.result;
        console.log('Claude completed task');
      } else if (message.type === 'tool_use') {
        console.log(`Tool used: ${message.tool_name}`);
      } else if (message.type === 'assistant_message') {
        console.log('Assistant thinking...');
      }
    }

    const endTime = Date.now();
    const duration = (endTime - startTime) / 1000;

    // Parse the response to extract useful information
    const { summary, filesModified } = parseClaudeResponse(allMessages);

    console.log('');
    console.log('=== Execution Complete ===');
    console.log(`Duration: ${duration}s`);
    console.log(`Files Modified: ${filesModified.length}`);
    console.log(`Files: ${filesModified.join(', ')}`);
    console.log('');

    // Report success
    await reportResults({
      status: 'completed',
      completedAt: new Date().toISOString(),
      implementationSummary:
        summary || finalResult || 'Implementation completed',
      filesModified,
      logs: JSON.stringify(allMessages, null, 2),
      codeChanges: filesModified.map((file) => ({
        file,
        changes: 'Modified by Claude Code',
      })),
    });

    console.log('Results reported successfully');
    process.exit(0);
  } catch (error) {
    console.error('');
    console.error('=== Execution Failed ===');
    console.error('Error:', error.message);
    console.error('Stack:', error.stack);
    console.error('');

    // Report failure
    await reportResults({
      status: 'failed',
      completedAt: new Date().toISOString(),
      errorMessage: error.message,
      logs: JSON.stringify(allMessages, null, 2),
    });

    process.exit(1);
  }
}

// Run the agent
main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});

