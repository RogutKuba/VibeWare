perfect—let’s design a **hackathon-minimal backend flow** that uses **Daytona sandboxes + Claude Code SDK** to generate code diffs, pushes a branch, and lets **Vercel Preview Deployments** spin up automatically. No auth, just per-session IDs.

I’ll give you:

* the exact **sequence** (one-shot + background job)
* **API endpoints** you’ll implement
* a tiny **DB schema** (Drizzle)
* **Claude Code + Daytona** pseudo-code you can drop in

---

# 🔁 End-to-end sequence

**Actors:** Browser → Next.js API → Daytona Sandbox → Claude Code (in sandbox) → GitHub branch → Vercel Preview → Webhooks → DB

1. **User prompt**: “Add a Kanban view for deals.”
2. **/api/customize** creates a **CustomizeJob** row, spawns a **Daytona sandbox** from the base repo (main), and kicks off a background worker.
3. **Worker** (server action/route handler):

   * opens the sandbox workspace using **Claude Code SDK**
   * runs a “plan → apply changes” loop (multi-file edits)
   * `git checkout -b user-{shortId}` → commit diff → push to origin
4. **Vercel** auto-builds a **Preview Deployment** for that branch.
5. **GitHub status** or **Vercel deployment webhook** hits `/api/webhooks/vercel` → store `previewUrl`.
7. UI polls `/api/job/:id` (or use SSE) until `status=ready` with `previewUrl`.

---

# 🧱 Minimal DB (Drizzle)

```ts
// drizzle schema (Postgres or SQLite)

export const sessions = pgTable('sessions', {
  id: text('id').primaryKey(),        // random short id, cookie "u"
  createdAt: timestamp('created_at').defaultNow()
});

export const sandboxes = pgTable('sandboxes', {
  id: text('id').primaryKey(),        // daytona sandbox id
  sessionId: text('session_id').notNull().references(() => sessions.id),
  repoUrl: text('repo_url').notNull(),// base repo
  status: text('status').notNull().default('creating'), // creating|ready|error
  createdAt: timestamp('created_at').defaultNow()
});

export const customizeJobs = pgTable('customize_jobs', {
  id: text('id').primaryKey(),        // job id
  sessionId: text('session_id').notNull().references(() => sessions.id),
  sandboxId: text('sandbox_id').notNull().references(() => sandboxes.id),
  branch: text('branch'),
  prompt: text('prompt').notNull(),
  status: text('status').notNull().default('queued'), // queued|running|pushed|deployed|error
  previewUrl: text('preview_url'),
  logs: text('logs'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp('updated_at').defaultNow()
});
```

No users/auth; a **session cookie** ties everything together.

---

# 🔐 Env you’ll need

* `BASE_REPO_URL` (GitHub HTTPS or SSH)
* `GITHUB_APP_TOKEN` (or PAT just for hackathon)
* `DAYTONA_API_URL`, `DAYTONA_API_KEY`
* `CLAUDE_API_KEY` (for Claude Code SDK)
* `VERCEL_WEBHOOK_SECRET` (to verify deployment webhooks)

---

# 🛣️ API routes (App Router)

### 1) `POST /api/customize`

Body: `{ prompt: string }`
Creates session (if missing), creates sandbox, enqueues job, returns `{ jobId }`.

Core work happens in a background task you can implement as:

* a quick **server Action** that returns immediately and continues (ok for hackathon), or
* a simple **in-process queue** (array + setInterval), or
* **Inngest** if you want reliability.

**Handler sketch:**

```ts
// app/api/customize/route.ts
import { cookies } from 'next/headers';
import { createSandbox, runCustomizationJob } from '@/lib/pipeline';
import { db, sessions, sandboxes, customizeJobs } from '@/db';

export async function POST(req: Request) {
  const { prompt } = await req.json();

  // 1) ensure session
  const jar = cookies();
  let u = jar.get('u')?.value;
  if (!u) { u = crypto.randomUUID().slice(0, 8); jar.set('u', u, { httpOnly: true, path: '/' }); }
  await db.insert(sessions).values({ id: u }).onConflictDoNothing();

  // 2) spawn daytona sandbox from base repo
  const sb = await createSandbox(process.env.BASE_REPO_URL!);

  // 3) create job
  const jobId = crypto.randomUUID().slice(0, 8);
  await db.insert(customizeJobs).values({
    id: jobId, sessionId: u, sandboxId: sb.id, prompt, status: 'queued'
  });

  // 4) kick worker (fire and forget)
  runCustomizationJob({ jobId }).catch(console.error);

  return Response.json({ jobId });
}
```

### 2) `GET /api/job/[id]`

Returns job status + `previewUrl` when ready (UI polls or SSE).

```ts
// app/api/job/[id]/route.ts
export async function GET(_: Request, { params }: { params: { id: string }}) {
  const job = await db.query.customizeJobs.findFirst({ where: eq(customizeJobs.id, params.id) });
  return Response.json(job ?? { error: 'not found' }, { status: job ? 200 : 404 });
}
```

### 3) `POST /api/webhooks/vercel`

Verify signature → map deployment to branch → find job by `branch` → set `status='deployed'`, store `previewUrl`.

---

# 🧪 Middleware: route a session to its preview

```ts
// middleware.ts
import { NextResponse } from 'next/server';
import { db, sessions, customizeJobs } from '@/db';
import { cookies } from 'next/headers';

export async function middleware(req: Request) {
  const url = new URL(req.url);
  // only intercept app root; skip API/static/next
  const pathname = url.pathname;
  if (pathname.startsWith('/api') || pathname.startsWith('/_next') || pathname.startsWith('/public')) {
    return NextResponse.next();
  }

  const cookieHeader = (req as any).headers.get('cookie') || '';
  // quick parse for "u=" (or use next/headers in edge isn't available—this is fine for demo)
  const match = cookieHeader.match(/(?:^|;\s*)u=([^;]+)/);
  const u = match?.[1];

  if (!u) return NextResponse.next(); // no session yet

  // fetch latest deployed preview for this session
  const job = await db.query.customizeJobs.findFirst({
    where: (t, { eq, and }) => and(eq(t.sessionId, u), eq(t.status, 'deployed')),
    orderBy: (t, { desc }) => [desc(t.createdAt)]
  });

  if (job?.previewUrl) {
    return NextResponse.redirect(job.previewUrl, 307);
  }
  return NextResponse.next();
}

export const config = { matcher: ['/:path*'] };
```

> For the demo: once a user has a preview, hitting `/` takes them straight to **their** live instance.

---

# 🧰 The worker: Daytona + Claude Code + Git push

A simple pipeline helper:

```ts
// lib/pipeline.ts (pseudo-ish but close)
import { db, customizeJobs } from '@/db';

export async function createSandbox(repoUrl: string) {
  // call Daytona: create sandbox from repo
  // return { id, workspacePath, gitRemoteUrl }
}

export async function runCustomizationJob({ jobId }: { jobId: string }) {
  // 0) load job
  const job = await db.query.customizeJobs.findFirst({ where: eq(customizeJobs.id, jobId) });
  if (!job) return;

  try {
    await db.update(customizeJobs).set({ status: 'running' }).where(eq(customizeJobs.id, jobId));

    // 1) open sandbox workspace
    const sandbox = await getSandbox(job.sandboxId); // your wrapper
    const wsPath = sandbox.workspacePath;

    // 2) Claude Code SDK: plan + apply
    //    Give it repo context + guardrails (only touch /app, /components, /db/schema.ts, etc.)
    await runClaudeCode({
      workspace: wsPath,
      system: `
You are modifying a Next.js CRM template.
Only edit files under /app, /components, /lib, /db.
Do not change package.json scripts or env handling unless necessary.
Generate small, auditable diffs and include migration steps when touching the schema.
    `,
      prompt: job.prompt
    });

    // 3) git branch/commit/push
    const branch = `u-${job.sessionId}-${job.id}`;
    await sandbox.exec(`git checkout -b ${branch}`);
    await sandbox.exec(`git add -A`);
    await sandbox.exec(`git commit -m "feat(${branch}): ${sanitize(job.prompt)}" || echo "no changes"`);
    await sandbox.exec(`git push origin ${branch}`);

    await db.update(customizeJobs).set({ status: 'pushed', branch }).where(eq(customizeJobs.id, jobId));

    // 4) wait for Vercel webhook to mark deployed (do nothing here)
  } catch (e: any) {
    await db.update(customizeJobs).set({ status: 'error', logs: String(e?.stack || e) }).where(eq(customizeJobs.id, jobId));
  }
}
```

**Claude Code SDK call sketch** (shape varies by SDK version, but demo-friendly):

```ts
async function runClaudeCode({ workspace, system, prompt }: { workspace: string; system: string; prompt: string }) {
  // Pseudo: open a session; send instructions; apply patches
  const session = await ClaudeCode.open({ dir: workspace, apiKey: process.env.CLAUDE_API_KEY! });
  await session.adapt({
    system,
    task: `
User request: "${prompt}".
1) Describe a plan (files to add/edit).
2) Apply changes as minimal patches (create files if needed).
3) Write a brief /CHANGES.md explaining what changed and test steps.
    `,
    guardrails: { allowPaths: ['app/', 'components/', 'lib/', 'db/'], denyPaths: ['.vercel/', '.github/'] }
  });
  await session.close();
}
```

**Daytona exec helper**:

```ts
async function getSandbox(id: string) {
  return {
    id,
    workspacePath: `/work/${id}`, // depends on Daytona
    exec: (cmd: string) => daytona.exec({ id, cmd }) // implement via REST/WS
  };
}
```

---

# 🪝 Vercel webhook

When Vercel posts a deployment event, pull out:

* `branch`
* `url` (e.g., `https://u-abc-123.vercel.app`)

```ts
// app/api/webhooks/vercel/route.ts
import { verifyVercelSignature } from '@/lib/verify';
import { db, customizeJobs } from '@/db';

export async function POST(req: Request) {
  const raw = await req.text();
  if (!verifyVercelSignature(raw, req.headers)) return new Response('bad sig', { status: 401 });

  const evt = JSON.parse(raw);
  if (evt?.type !== 'deployment.created' && evt?.type !== 'deployment.ready') return new Response('ok');

  const branch = evt?.payload?.meta?.githubCommitRef || evt?.payload?.target?.gitSource?.ref || evt?.deployment?.meta?.gitRef;
  const previewUrl = evt?.payload?.url || evt?.deployment?.url ? `https://${evt.deployment.url}` : null;

  if (!branch || !previewUrl) return new Response('ok');

  // map branch → job
  const job = await db.query.customizeJobs.findFirst({ where: eq(customizeJobs.branch, branch) });
  if (!job) return new Response('ok');

  await db.update(customizeJobs).set({ status: 'deployed', previewUrl }).where(eq(customizeJobs.id, job.id));
  return new Response('ok');
}
```

> If you don’t want to verify for the hackathon, skip signature (but keep endpoint).

---

# 🧪 Base repo tips (so Claude’s edits are safe)

```
/app
  /(dashboard)/page.tsx            ← obvious place for “add a chart”
  /deals/page.tsx                  ← obvious place for “add Kanban”
/components
  /Chart.tsx, /Kanban.tsx          ← atomize visuals for easy reuse
/lib
  /db.ts                            ← Prisma/Drizzle client
/db
  /schema.ts                        ← keep small; migrations optional for demo
```

**Guardrails for the model**:

* “Only edit files in `/app`, `/components`, `/lib`, `/db`.”
* “Prefer adding new components over refactoring global config.”
* “If schema changes are required, generate a tiny in-file comment block with SQL to run later.”

---

# 🧷 Frontend (super small)

* A textarea for the prompt.
* A status panel that calls `GET /api/job/:id` and shows:

  * `status: queued/running/pushed/deployed/error`
  * `previewUrl` (link shown once deployed)
* “Open my version” button simply links to `/` (middleware will redirect to preview).

---

# 🧨 Demo script (what you’ll say on stage)

1. “This is a plain Next.js CRM.”
2. Type: *“Add a Kanban view for deals and a revenue forecast chart on the dashboard.”*
3. Shows **job row** → status transitions → a minute later, middleware routes you to **your Vercel preview** that has the new Kanban + chart.
4. Optional: show the **GitHub branch** and the **/CHANGES.md** created by Claude Code.

---

# 🧩 Stretch (nice-to-haves if time permits)

* **SSE** (`/api/job/[id]/stream`) for live logs from the Daytona exec.
* **“Promote to Stable”**: open PR from branch → main (even auto-merge if tests pass).
* **“Template Gallery”**: save prompts + diffs as reusable modules.
* **Compare view**: side-by-side base vs preview.

---

If you want, I can drop in **concrete Daytona REST calls** and a **working Claude Code SDK snippet** wired to a public template repo so you can copy/paste into your project scaffold.
