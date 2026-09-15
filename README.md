# Function Planner (backend shell + planner UI)

This monorepo is the **authentication, course administration, roster, plan lifecycle, and multi-user Yjs collaboration** half of Function Planner, plus the embedded planner diagram UI.

The planner UI (diagram, function model, config-driven checking) lives in the [`function-planner-ui`](https://github.com/MoravianUniversity/function-planner-ui) submodule at [`packages/function-planner-ui`](packages/function-planner-ui). Shared types and schemas live in the [`function-planner-shared`](https://github.com/MoravianUniversity/function-planner-shared) submodule at [`packages/shared`](packages/shared). Student plans and the staff base-plan editor both use that UI against ticketed Yjs rooms.

## Monorepo layout

| Path | Role |
|------|------|
| `apps/server` | Express API, Google OAuth sessions, Prisma/Postgres, Yjs WebSocket (`/yjs`) with Postgres persistence |
| `apps/client` | React shell: courses, roster, base-plan manage/publish, student start/join/leave, planner host |
| `packages/shared` | Git submodule: shared TypeScript types and Zod schemas |
| `packages/function-planner-ui` | Git submodule: GoJS planner (`init` + Yjs model) |

## What works today

- Google OAuth sign-in (Passport) and cookie sessions
- Courses with instructor / TA / student enrollments; course becomes **readonly** after `endsAt`
- Roster: add members, CSV student import, enable/disable enrollments
- Base plans: create, import from another course you instruct, title/settings, publish (cannot unpublish)
- Base-plan **settings** JSON mapped into the planner `init` options (allowed types, mins, claim/call-graph, doc style, etc.)
- **Yjs persistence** to Postgres (`yjsState`; map-based docs also refresh `content` JSON for seeding)
- Students: start/join/leave with the live **Function Planner** UI; staff can supervise without becoming members (TAs read-only)
- Staff **Function Planner** on base plans (ticketed WebSocket; instructors edit, TAs read-only) — seed template for empty student docs

## Student start / join / leave

Students open `/plans/:basePlanId` (published assignment):

1. If already a **member** of a student plan for that base → open the planner.
2. Otherwise show **Start / Join**:
   - **Start New Plan** — creates a student plan with only themselves.
   - **Joinable plans** — other groups for the same course + base plan that currently have **at least one student member connected** to the Yjs room. Member names are listed; **active** (connected) names are emphasized.
3. Requesting to join creates a `JoinRequest`. Active members in the planner see approve/reject. On approve the requester becomes a member and enters the planner; on reject they stay on start/join with a message.
4. **Leave plan** (confirm dialog) removes membership and returns to start/join. If they were the **last member**, the student plan (and its Yjs state / pending requests) is **deleted** (extra warning in the dialog).

A student may belong to **at most one** student plan per `(courseId, basePlanId)` at a time.

Staff open a student plan instance from the base-plan manage page (or by student-plan id). They receive a collab ticket **without** a membership row; instructors can edit, TAs are read-only.

Empty student docs seed from parseable base-plan JSON `content` when present; otherwise a single `main` function.

## Collaboration stack note

Browser clients use `y-websocket` + **Yjs 13** (`y-protocols`). The server must use the matching **`y-websocket@1.5.x` `bin/utils`** server helpers (also Yjs 13). Do not use `@y/websocket-server` (Yjs 14 / `@y/protocols`) — connections will succeed but documents will not sync.

Planner docs (student and base) use Yjs maps (`modelData`, `functions`, `calls`), not `Y.Text('content')`. IndexedDB is disabled when connected to the server. Persisted `content` is a JSON export of those maps (used to seed empty student docs).

## Prerequisites

- Node.js (npm workspaces)
- PostgreSQL listening locally (default URL assumes DB name `function_planner`)
- Google OAuth client with redirect URI matching `GOOGLE_CALLBACK_URL`
- Clone with submodules: `git clone --recurse-submodules …` (or `git submodule update --init --recursive`)

## Quick start

1. Install deps from the repo root (after submodules are checked out):

   ```bash
   git submodule update --init --recursive
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

   Optionally copy `apps/client/.env.example` → `apps/client/.env`:

   | Variable | Notes |
   |----------|--------|
   | `VITE_API_BASE_URL` | Optional API origin override (default talks to `:3000`) |
   | `VITE_GOJS_LICENSE_KEY` | GoJS license key for your deployment domain |

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

## Production (nginx + systemd)

Serve the built client and API on one hostname. `/yjs` is only the API WebSocket; the SPA does not own that path, so path-based routing works the same as the Vite dev proxy.

1. Build: set `VITE_API_BASE_URL` empty (same-origin `/api`) and `VITE_GOJS_LICENSE_KEY` in `apps/client/.env`, then `npm run build`. Nginx `root` must be [`apps/client/dist`](apps/client/dist) (or a copy of that tree).
2. Copy [`deploy/nginx.conf.example`](deploy/nginx.conf.example) into your nginx sites config; set `server_name`, TLS certs, and paths. It proxies `/api`, `/auth`, `/yjs` (WebSocket), and `/healthz` to the Node API, gzips static assets, long-caches hashed `/assets/` (so GoJS survives frequent client redeploys), and uses `Cache-Control: no-cache` for `index.html` / SPA routes. Keep `X-Forwarded-Proto` (already in the example) so Express can set secure session cookies behind TLS termination.
3. Copy [`deploy/systemd/function-planner-api.service.example`](deploy/systemd/function-planner-api.service.example) to `/etc/systemd/system/function-planner-api.service`, adjust user/paths, then `systemctl enable --now function-planner-api`. Entry point is `dist/src/index.js`. The client needs no systemd unit.

Production env (server `.env` + unit; register the callback in Google OAuth):

| Variable | Value |
|----------|--------|
| `CLIENT_URL` | `https://your.host` (exact browser origin; used for CORS and post-login redirect) |
| `GOOGLE_CALLBACK_URL` | `https://your.host/auth/google/callback` |
| `NODE_ENV` | `production` (set in the systemd unit; enables secure session cookies) |

Sessions are stored in Postgres via `connect-pg-simple` (table created automatically). The API sets `trust proxy` so secure cookies work when nginx terminates TLS.
## Updating the planner UI submodule

UI changes belong in [MoravianUniversity/function-planner-ui](https://github.com/MoravianUniversity/function-planner-ui). In this repo:

```bash
cd packages/function-planner-ui
# edit, commit, push to function-planner-ui
cd ../..
git add packages/function-planner-ui
git commit -m "Bump function-planner-ui submodule"
```

## Useful scripts

| Script | Where | Purpose |
|--------|--------|---------|
| `npm run prisma:setup -w apps/server` | server | `prisma generate` + `db push --force-reset` + seed (**wipes data**) |
| `npm run prisma:migrate -w apps/server` | server | Incremental migrations during development |
| `npm run prisma:seed -w apps/server` | server | Seed only |
| `npm run build` | root | Build shared → server → client |
| `npm test` | root | Workspace tests (currently minimal) |

## Roles (short)

- **INSTRUCTOR** — create/edit courses and plans, roster, publish, edit base-plan JSON and student-plan diagrams (Yjs); supervise student plans without joining
- **TA** — view published base plans and student instances; live view of collab (read-only content)
- **STUDENT** — start / join / leave plans for published base plans; live edit with teammates

## Related project

Planner editor package / demos: [`function-planner-ui`](https://github.com/MoravianUniversity/function-planner-ui) (submodule).
