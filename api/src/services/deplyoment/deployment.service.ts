import { db } from '@/lib/db';
import Elysia, { t } from 'elysia';
import { deploymentsTable } from '@/db/deployment.db';
import { desc, eq } from 'drizzle-orm';
import { generateId, Id } from '@/lib/id';
import { DeploymentEntity } from '@/db/deployment.db';
import { daytona } from '@/lib/daytona';
import { inngestClient } from '@/lib/inngest-client';
import { SandboxEntity, sandboxesTable } from '@/db/sandbox.db';
import { env } from '@/lib/env';
import { vercel } from '@/lib/vercel';
import {
  createDeploymentJob,
  runDeploymentJob,
} from '@/services/deplyoment/deplyoment.jobs';
import { agentsTable } from '@/db/agent.db';
import { CreateDeploymentResponseBody } from '@vercel/sdk/esm/models/createdeploymentop';

export const DEMO_REPO = 'RogutKuba/vibeware';
export const DEMO_ORG = 'rogutkuba';

export const deploymentRoutes = new Elysia({ prefix: '/deployment' })
  .get('/', () => {
    console.log('get all deployments');
    // return all deployments
    return db
      .select()
      .from(deploymentsTable)
      .orderBy(desc(deploymentsTable.createdAt))
      .limit(100);
  })
  .get('/:id', ({ params }) => {
    console.log('get deployment by id', params.id);
    return db
      .select()
      .from(deploymentsTable)
      .where(eq(deploymentsTable.id, params.id as Id<'deployment'>))
      .limit(1);
  })
  .post(
    '/',
    async ({ body }) => {
      const newDeployment: DeploymentEntity = {
        id: generateId('deployment'),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        prompt: body.prompt,
        // body.prompt,
        status: 'pending',
        logs: null,
        error: null,
      };

      await db.insert(deploymentsTable).values(newDeployment);

      // 3. Kick off background workflow for deployment
      await createDeploymentJob(newDeployment);

      // 4. Return deployment info immediately
      return {
        deploymentId: newDeployment.id,
        status: 'pending',
      };
    },
    {
      body: t.Object({
        prompt: t.String(),
      }),
    }
  )
  .post(
    '/:id/agent-results',
    async ({ params, body }) => {
      const deploymentId = params.id as Id<'deployment'>;

      // update agent logs and update deploymnet status

      console.log(
        `Updating for deployment ${deploymentId} with results: ${JSON.stringify(
          body,
          null,
          2
        )}`
      );

      // Update the code agent with results from the Claude Code script
      let newStatus:
        | 'pending'
        | 'running_code'
        | 'completed_code'
        | 'failed_code' = (() => {
        switch (body.status) {
          case 'completed':
            return 'completed_code';
          case 'running':
            return 'running_code';
          case 'failed':
            return 'failed_code';
          default:
            return 'failed_code';
        }
      })();

      await Promise.all([
        db
          .update(deploymentsTable)
          .set({
            logs: JSON.stringify(body, null, 2),
            status: newStatus,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(deploymentsTable.id, deploymentId)),
        db
          .update(agentsTable)
          .set({
            ...body,
            updatedAt: new Date().toISOString(),
          })
          .where(eq(agentsTable.deploymentId, deploymentId)),
      ]);

      return { success: true };
    },
    {
      params: t.Object({
        id: t.String(),
      }),
      body: t.Object({
        status: t.Optional(
          t.Union([
            t.Literal('running'),
            t.Literal('completed'),
            t.Literal('failed'),
          ])
        ),
        startedAt: t.Optional(t.String()),
        completedAt: t.Optional(t.String()),
        implementationSummary: t.Optional(t.String()),
        filesModified: t.Optional(t.Array(t.String())),
        codeChanges: t.Optional(
          t.Array(
            t.Object({
              file: t.String(),
              changes: t.String(),
            })
          )
        ),
        logs: t.Optional(t.String()),
        errorMessage: t.Optional(t.String()),
      }),
    }
  );

export abstract class DeploymentService {
  static WORK_DIR = 'workspace/repo';

  static getBranchName(deploymentId: Id<'deployment'>) {
    return `vibeware/${deploymentId}`;
  }

  static async initSandbox(params: { deploymentId: Id<'deployment'> }) {
    // spawn new sandbox instance
    const sandbox = await daytona.create({
      language: 'typescript',
      public: true,
      envVars: {
        ANTHROPIC_API_KEY: env.ANTHROPIC_API_KEY,
      },
    });

    const sEntity: SandboxEntity = {
      id: generateId('sandbox'),
      createdAt: new Date().toISOString(),
      deploymentId: params.deploymentId,
      daytonaSandboxId: sandbox.id,
    };

    // save sandbox instance to database
    await db.insert(sandboxesTable).values(sEntity);

    // set my git config
    await sandbox.process.executeCommand(
      `git config user.name "Kuba Rogut"`,
      DeploymentService.WORK_DIR
    );
    await sandbox.process.executeCommand(
      `git config user.email "rogutkuba@gmail.com"`,
      DeploymentService.WORK_DIR
    );

    await sandbox.git.clone(
      // git remote set-url origin https://username:token@github.com/put_username_here/repo-name.git
      `https://${env.GIT_PERSONAL_TOKEN}@github.com/${DEMO_REPO}`,
      DeploymentService.WORK_DIR
    );

    // check if branch exists
    const branchName = DeploymentService.getBranchName(params.deploymentId);
    const branches = await sandbox.git.branches(DeploymentService.WORK_DIR);
    const branchExsits = branches.branches.some(
      (branch) => branch === branchName
    );

    if (!branchExsits) {
      // create new branch of the repo
      await sandbox.git.createBranch(DeploymentService.WORK_DIR, branchName);
    } else {
      await sandbox.git.checkoutBranch(
        DeploymentService.WORK_DIR,
        DeploymentService.getBranchName(params.deploymentId)
      );
    }

    // install claude code and dotenv
    await sandbox.process.executeCommand(
      `npm install @anthropic-ai/claude-agent-sdk dotenv`,
      DeploymentService.WORK_DIR
    );

    return sEntity;
  }

  static async pushChanges(params: {
    deployment: DeploymentEntity;
    sandbox: SandboxEntity;
  }) {
    const { deployment, sandbox: sandboxRecord } = params;
    const sandbox = await daytona.get(sandboxRecord.daytonaSandboxId);

    // stage and commit all changes in the working directory
    await sandbox.git.add(DeploymentService.WORK_DIR, ['.']);

    await sandbox.git.commit(
      DeploymentService.WORK_DIR,
      `feat: ${deployment.prompt}`,
      'Vibeware Bot',
      'bot@vibeware.ai'
    );
    await sandbox.git.push(DeploymentService.WORK_DIR);
  }

  static getVercelDeploymentName(deploymentId: Id<'deployment'>) {
    // replaace undersco
    return deploymentId.replace(/_/g, '').toLowerCase();
  }

  static async deployToVercel(params: { deployment: DeploymentEntity }) {
    const { deployment } = params;

    const deploymentName = DeploymentService.getVercelDeploymentName(
      deployment.id
    );
    const branch = DeploymentService.getBranchName(deployment.id);

    try {
      const createResponse = await vercel.deployments.createDeployment({
        requestBody: {
          name: deploymentName,
          target: 'production',
          gitSource: {
            type: 'github',
            repo: `https://github.com/${DEMO_REPO}`,
            ref: branch,
            org: DEMO_ORG,
          },
        },
      });

      console.log(
        `Vercel deployment created: ${JSON.stringify(createResponse, null, 2)}`
      );

      // update deployment with vercel deployment id
      await db
        .update(deploymentsTable)
        .set({ status: 'running_deployment' })
        .where(eq(deploymentsTable.id, deployment.id));

      return createResponse;
    } catch (error) {
      console.error(error);
      throw error;
    }
  }

  static async waitForVercelDeployment(params: {
    deployment: DeploymentEntity;
    vercelDeployment: CreateDeploymentResponseBody;
  }) {
    const { deployment, vercelDeployment } = params;

    const deploymentId = deployment.id;
    const deploymentName = DeploymentService.getVercelDeploymentName(
      deployment.id
    );

    // Check deployment status
    let deploymentStatus;
    let deploymentURL;
    do {
      await new Promise((resolve) => setTimeout(resolve, 5000)); // Wait 5 seconds between checks

      const statusResponse = await vercel.deployments.getDeployment({
        idOrUrl: vercelDeployment.id,
        withGitRepoInfo: 'true',
      });

      deploymentStatus = statusResponse.status;
      deploymentURL = statusResponse.url;
      console.log(`Deployment status: ${deploymentStatus}`);
    } while (
      deploymentStatus === 'BUILDING' ||
      deploymentStatus === 'INITIALIZING'
    );

    if (deploymentStatus === 'READY') {
      console.log(`Deployment successful. URL: ${deploymentURL}`);

      const aliasResponse = await vercel.aliases.assignAlias({
        id: deploymentId,
        requestBody: {
          alias: `${deploymentName}.vercel.app`,
          redirect: null,
        },
      });

      console.log(`Alias created: ${aliasResponse.alias}`);

      // update deployment with vercel deployment status
      await db
        .update(deploymentsTable)
        .set({ status: 'completed_deployment' })
        .where(eq(deploymentsTable.id, deployment.id));

      return { success: true };
    } else {
      console.log('Deployment failed or was canceled');
      await db
        .update(deploymentsTable)
        .set({ status: 'failed_deployment' })
        .where(eq(deploymentsTable.id, deployment.id));

      throw new Error('Deployment failed or was canceled');
    }
  }
}
