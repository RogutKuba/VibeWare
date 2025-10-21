import { inngestClient } from '@/lib/inngest-client';
import { db } from '@/lib/db';
import { DeploymentEntity, deploymentsTable } from '@/db/deployment.db';
import { eq } from 'drizzle-orm';
import { daytona } from '@/lib/daytona';
import { DeploymentService } from '@/services/deplyoment/deployment.service';
import { AgentService } from '@/services/agent/agent.service';

interface RunDeploymentJobData {
  deployment: DeploymentEntity;
}

/**
 * Background job that runs Claude Code in a Daytona sandbox
 * to apply changes based on the user's prompt
 */
export const runDeploymentJob = inngestClient.createFunction(
  {
    id: 'deployment/run',
    onFailure: async ({ error, event }) => {
      const params = event.data.event.data as RunDeploymentJobData;
      await db
        .update(deploymentsTable)
        .set({ status: 'failed', error: JSON.stringify(error, null, 2) })
        .where(eq(deploymentsTable.id, params.deployment.id));
    },
  },
  { event: 'deployment/run' },
  async ({ event, step }) => {
    const { deployment } = event.data;

    // spawn sandbox initial setup
    const sandbox = await step.run('create-sandbox', async () => {
      return await DeploymentService.initSandbox({
        deploymentId: deployment.id,
      });
    });

    // spawn claude code inside sandbox to make changes (logs are streamed to DB)
    const agent = await step.run('run-claude-code', async () => {
      return await AgentService.spawnClaudeCode({
        deployment,
        sandbox,
      });
    });

    // now we have to wait for the claude code agent to complete
    await step.run('wait-for-claude-code', async () => {
      return await AgentService.waitForClaudeCode({
        agent,
      });
    });

    // now push changes to the branc
    await step.run('push-changes', async () => {
      return await DeploymentService.pushChanges({
        deployment,
        sandbox,
      });
    });

    // now deploy to vercel
    const vercelDeployment = await step.run('deploy-to-vercel', async () => {
      return await DeploymentService.deployToVercel({
        deployment,
      });
    });

    // now wait for vercel deployment to complete
    await step.run('wait-for-vercel-deployment', async () => {
      return await DeploymentService.waitForVercelDeployment({
        deployment,
        vercelDeployment,
      });
    });

    return { success: true };
  }
);

export const createDeploymentJob = (deployment: DeploymentEntity) => {
  return inngestClient.send({
    name: 'deployment/run',
    data: { deployment },
  });
};
