import { daytona } from '@/lib/daytona';
import { DeploymentEntity } from '@/db/deployment.db';
import { SandboxEntity } from '@/db/sandbox.db';
import { env } from '@/lib/env';
import Elysia, { t } from 'elysia';
import { AgentEntity, agentsTable } from '@/db/agent.db';
import { db } from '@/lib/db';
import { eq } from 'drizzle-orm';
import { generateId, Id } from '@/lib/id';
import { DeploymentService } from '@/services/deplyoment/deployment.service';
import { Sandbox } from '@daytonaio/sdk';

export const agentRoutes = new Elysia({ prefix: '/agent' })
  .get('/:id', ({ params }) => {
    return db
      .select()
      .from(agentsTable)
      .where(eq(agentsTable.id, params.id as Id<'agent'>))
      .limit(1);
  })
  .get('/deployment/:deploymentId', ({ params }) => {
    return db
      .select()
      .from(agentsTable)
      .where(
        eq(agentsTable.deploymentId, params.deploymentId as Id<'deployment'>)
      );
  });

export abstract class AgentService {
  static async generateImplementationPrompt(
    userPrompt: string
  ): Promise<string> {
    return `You are a senior software engineer tasked with implementing a feature from user feedback
      **Original User feedback:**
      ${userPrompt}

      **Your Task:**
      Implement this feature in the codebase. The project is a Next.js e-commerce application located in the workspace/commerce directory.

      **Instructions:**
      1. Analyze the current codebase to understand the existing structure
      2. Implement the feature following React/Next.js best practices
      3. Ensure the implementation is clean, maintainable, and follows the existing code style`;
  }

  static async createAgent(params: {
    deployment: DeploymentEntity;
    sandbox: Sandbox;
    prompt: string;
    claudeSessionId: string;
  }): Promise<AgentEntity> {
    const { deployment, sandbox, prompt, claudeSessionId } = params;

    const agent: AgentEntity = await db
      .insert(agentsTable)
      .values({
        id: generateId('agent'),
        deploymentId: deployment.id,
        prompt: prompt,
        status: 'pending',
        implementationPrompt: await AgentService.generateImplementationPrompt(
          prompt
        ),
        daytonaSandboxId: sandbox.id,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        claudeSessionId,
      })
      .returning()
      .then(([agent]) => agent);

    return agent;
  }

  /**
   * Spawn a Claude Code agent in the sandbox to implement changes
   * Uses the Anthropic SDK to run Claude with the deployment prompt
   */
  static async spawnClaudeCode(params: {
    deployment: DeploymentEntity;
    sandbox: SandboxEntity;
  }) {
    const { deployment, sandbox: sandboxRecord } = params;
    console.log(`sandboxRecord: ${JSON.stringify(sandboxRecord, null, 2)}`);
    const sandbox = await daytona.get(sandboxRecord.daytonaSandboxId);

    // Get the Daytona sandbox instance
    // give a good prompt

    // Read the script template
    const fs = await import('fs/promises');
    const path = await import('path');
    const templatePath = path.join(
      process.cwd(),
      'src/script/run-claude-code.template.js'
    );
    let scriptContent = await fs.readFile(templatePath, 'utf-8');
    const implementationPrompt =
      await AgentService.generateImplementationPrompt(deployment.prompt);

    const claudeSessionId = `claude-session-${deployment.id}-${Date.now()}`;

    const agent = await AgentService.createAgent({
      deployment,
      sandbox,
      prompt: deployment.prompt,
      claudeSessionId,
    });

    // Replace placeholders in the template
    scriptContent = scriptContent
      .replace('{{DEPLOYMENT_ID}}', deployment.id)
      .replace('{{API_URL}}', env.API_URL)
      .replace(
        '{{PROMPT}}',
        implementationPrompt.replace(/`/g, '\\`').replace(/\$/g, '\\$')
      );

    console.log('Writing Claude Code script to sandbox...');

    // Write the script to the sandbox using heredoc
    const scriptPath = 'claude-code-script.js';
    const writeCommand = `cat > ${scriptPath} << 'EOF'
${scriptContent}
EOF`;

    const writeResult = await sandbox.process.executeCommand(
      writeCommand,
      DeploymentService.WORK_DIR
    );
    console.log(`Write script result:`, writeResult);

    console.log('Installing dependencies...');

    console.log('Starting Claude Code agent...');

    await sandbox.process.createSession(claudeSessionId);
    // change directory to the workspace
    await sandbox.process.executeSessionCommand(claudeSessionId, {
      command: `cd ${DeploymentService.WORK_DIR}`,
    });

    const executeResult = await sandbox.process.executeSessionCommand(
      claudeSessionId,
      {
        command: `node ${scriptPath}`,
        runAsync: true,
      }
    );

    // wait for 5 seconds
    await new Promise((resolve) => setTimeout(resolve, 5000));

    // get the logs for the session
    const logs = await sandbox.process.getSessionCommandLogs(
      claudeSessionId,
      executeResult.cmdId!
    );
    console.log(`Claude Code logs: ${JSON.stringify(logs, null, 2)}`);

    console.log(
      `Claude Code execution result: ${JSON.stringify(executeResult, null, 2)}`
    );
    console.log('Claude Code agent started');

    return agent;
  }

  static async waitForClaudeCode(params: { agent: AgentEntity }) {
    const { agent: agentRecord } = params;

    // track agent entity and wait for it to be complete or failed
    while (true) {
      const agent = await db
        .select()
        .from(agentsTable)
        .where(eq(agentsTable.id, agentRecord.id))
        .limit(1);
      if (agent.length === 0) {
        throw new Error('Agent not found');
      }

      console.log(`Agent status: ${agent[0].status}`);

      if (agent[0].status === 'completed') {
        return { success: true };
      }
      if (agent[0].status === 'failed') {
        throw new Error('Agent failed');
      }
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
  }
}
