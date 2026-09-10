# Function Planner (backend shell)

This monorepo is the **authentication, course administration, roster, plan lifecycle, and multi-user Yjs collaboration** half of Function Planner.

The real planner UI (diagram, function model, config-driven checking, client-side Yjs document shape, etc.) lives separately in [`intro-tools`](../intro-tools) (`function-planner.js` / `src/`). That UI is **not integrated here yet**. This app uses a **dummy textarea** bound to Yjs so staff and students can exercise live collaboration end-to-end before the planner is wired in.

## Monorepo layout

| Path | Role |
|------|------|
| `apps/server` | Express API, Google OAuth sessions, Prisma/Postgres, Yjs WebSocket (`/yjs`) with Postgres persistence |
| `apps/client` | Thin React shell: courses, roster, base-plan manage/publish, student start/join/leave, live textareas |
| `packages/shared` | Shared TypeScript types and Zod schemas |

## What works today

- Google OAuth sign-in (Passport) and cookie sessions
- Courses with instructor / TA / student enrollments; course becomes **readonly** after `endsAt`
- Roster: add members, CSV student import, enable/disable enrollments
- Base plans: create, import from another course you instruct, title/settings, publish (cannot unpublish)
- Base-plan **settings** JSON (allowed types, mins, claim/call-graph flags, doc style) — stored for the future planner UI
- **Yjs persistence** to Postgres (`yjsState` + denormalized `content`) for base and student plans
- Staff **live collaborative textarea** on base plans (ticketed WebSocket)
- Students: start/join/leave student plans with live shared textarea; staff can supervise without becoming members (TAs read-only)

## Student start / join / leave

Students open `/plans/:basePlanId` (published assignment):

1. If already a **member** of a student plan for that base → open the mock planner (Yjs textarea).
2. Otherwise show **Start / Join**:
   - **Start New Plan** — creates a student plan with only themselves.
   - **Joinable plans** — other groups for the same course + base plan that currently have **at least one student member connected** to the Yjs room. Member names are listed; **active** (connected) names are emphasized.
3. Requesting to join creates a `JoinRequest`. Active members in the planner see approve/reject. On approve the requester becomes a member and enters the planner; on reject they stay on start/join with a message.
4. **Leave plan** (confirm dialog) removes membership and returns to start/join. If they were the **last member**, the student plan (and its Yjs state / pending requests) is **deleted** (extra warning in the dialog).

A student may belong to **at most one** student plan per `(courseId, basePlanId)` at a time.

Staff open a student plan instance from the base-plan manage page (or by student-plan id). They receive a collab ticket **without** a membership row; instructors can edit, TAs are read-only.

## Intentionally incomplete

- Planner UI from `intro-tools` not embedded or synced yet (textarea is a stand-in for the Yjs document)
- No email notifications for join requests

## Collaboration stack note

Browser clients use `y-websocket` + **Yjs 13** (`y-protocols`). The server must use the matching **`y-websocket@1.5.x` `bin/utils`** server helpers (also Yjs 13). Do not use `@y/websocket-server` (Yjs 14 / `@y/protocols`) — connections will succeed but documents will not sync.

## Prerequisites

- Node.js (npm workspaces)
- PostgreSQL listening locally (default URL assumes DB name `function_planner`)
- Google OAuth client with redirect URI matching `GOOGLE_CALLBACK_URL`

## Quick start

1. Install deps from the repo root:

   ```bash
   npm install
   npm run build -w packages/shared
   ```

2. Copy `apps/server/.env.example` → `apps/server/.env` and set:

   | Variable | Notes |
   |----------|--------|
   | `DATABASE_URL` | Postgres connection string |
   | `SESSION_SECRET` | Session cookie signing secret |
   | `CLIENT_URL` | Browser origin of the Vite client (**`http://localhost:5174`**) — used for CORS and post-login redirect |
   | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | OAuth credentials |
   | `GOOGLE_CALLBACK_URL` | Default `http://localhost:3000/auth/google/callback` |

   Optionally edit [`apps/server/config.json`](apps/server/config.json) (see `config.example.json`):

   | Key | Default | Notes |
   |-----|---------|--------|
   | `appName` | `"Function Planner"` | Shown in the client header and browser title |
   | `allowedEmailDomains` | `[]` | If non-empty (e.g. `["moravian.edu"]`), only those Google email domains may sign in |

3. Create the database and seed an initial instructor + course (destructive reset):

   ```bash
   npm run prisma:setup -w apps/server
   ```

   Prompts for instructor name/email and course metadata. Use the same email you will sign in with via Google.

   For non-destructive schema updates during development: `npx prisma db push` from `apps/server`.

4. Start the API (port **3000**, includes `/yjs` WebSocket upgrades):

   ```bash
   npm run dev -w apps/server
   ```

5. Start the client (port **5174**; proxies `/api`, `/auth`, and `/yjs` to the server):

   ```bash
   npm run dev -w apps/client
   ```

6. Open `http://localhost:5174` and sign in with Google.

Health check: `GET http://localhost:3000/healthz` → `{"ok":true}`.

### Client API base URL

- Default: browser calls `http://localhost:3000` directly (CORS via `CLIENT_URL`).
- Override: set `VITE_API_BASE_URL` when starting the client (e.g. empty/`""` if you prefer same-origin requests through the Vite proxy).
- Yjs always connects to the **page host** (`/yjs`), so the Vite WS proxy matters when using the client on `:5174`.

## Useful scripts

| Script | Where | Purpose |
|--------|--------|---------|
| `npm run prisma:setup -w apps/server` | server | `prisma generate` + `db push --force-reset` + seed (**wipes data**) |
| `npm run prisma:migrate -w apps/server` | server | Incremental migrations during development |
| `npm run prisma:seed -w apps/server` | server | Seed only |
| `npm run build` | root | Build shared → server → client |
| `npm test` | root | Workspace tests (currently minimal) |

## Roles (short)

- **INSTRUCTOR** — create/edit courses and plans, roster, publish, edit base-plan and student-plan content (Yjs); supervise student plans without joining
- **TA** — view published base plans and student instances; live view of collab (read-only content)
- **STUDENT** — start / join / leave plans for published base plans; live edit with teammates

## Related project

Planner editor / Yjs document model: `../intro-tools` (`function-planner.html` / `function-planner.js` / `src/`). Next integration step is to replace this app’s dummy textarea with that UI against the same collab ticket + WebSocket path.
