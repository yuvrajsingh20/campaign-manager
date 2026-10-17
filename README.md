# Campaign Manager

Multi-tenant outbound AI voice campaign platform. Create campaigns, upload contact cohorts, and dispatch calls through **Sarvam AI** with organisation-level rate limits, retries, and webhook-driven outcomes.

---

## Architecture

```
┌─────────────┐     ┌──────────────────────────────┐     ┌─────────────────┐
│  Browser UI │────▶│  Next.js App (:3000)         │────▶│  PostgreSQL 16  │
│  (App Router)│     │  Auth · Campaigns · Admin    │     │  (Prisma ORM)   │
└─────────────┘     │  Cohort upload · Webhooks    │     └─────────────────┘
                    └──────────────┬───────────────┘
                                   │ enqueue jobs
                                   ▼
                    ┌──────────────────────────────┐
                    │  Redis 7                     │
                    │  BullMQ queue + rate limits   │
                    └──────────────┬───────────────┘
                                   │ consume jobs
                                   ▼
                    ┌──────────────────────────────┐     ┌─────────────────┐
                    │  Worker (npm run worker)     │────▶│  Sarvam AI API  │
                    │  Claim · RPS gate · Dispatch │     │  (or Mock mode) │
                    └──────────────────────────────┘     └────────┬────────┘
                                                                  │ webhooks
                                                                  ▼
                                                         /api/webhooks/sarvam
```

**Flow in short**

1. Owner/Admin creates a campaign and uploads a CSV cohort.
2. Start enqueues pending contacts onto the BullMQ queue in Redis.
3. The standalone worker claims contacts, checks calling windows + org RPS, then calls Sarvam (or mock).
4. Sarvam posts status webhooks; the app maps outcomes and schedules retries when configured.

---

## Stack

| Layer | Tech |
| :--- | :--- |
| App | Next.js 16 (App Router), React 19, TypeScript, Tailwind CSS v4 |
| DB | PostgreSQL 16 + Prisma 6 |
| Queue / limits | Redis 7 + BullMQ 6 (Lua sliding-window RPS) |
| Validation | Zod 4 · PapaParse (CSV) |
| Telephony | Sarvam AI Outbound Voice Agent API |

---

## Security check (secrets)

| Item | Status |
| :--- | :--- |
| `.env` / `.env.local` | **Gitignored** — never commit these |
| Tracked secrets in repo / git history | **None found** |
| `SARVAM_API_KEY` in tracked files | Placeholder only (`your-sarvam-api-key-here`) |
| Demo passwords in README / seed | Local-dev only (`12345678`) — change before any shared/prod use |

Copy the template; put real keys only in your private `.env`:

```bash
cp .env.example .env
```

---

## Environment variables

| Variable | Purpose | Local example |
| :--- | :--- | :--- |
| `DATABASE_URL` | Prisma / app DB | `postgresql://postgres:postgres@localhost:5432/campaign_manager?schema=public` |
| `DIRECT_URL` | Direct DB URL (migrations / poolers) | Same as above for local Docker |
| `REDIS_URL` | BullMQ + rate limiter | `redis://localhost:6379` |
| `SARVAM_API_KEY` | Live Sarvam key | Leave empty / placeholder → mock mode |
| `SARVAM_API_BASE_URL` | Sarvam base URL | `https://apps.sarvam.ai` |
| `SARVAM_MOCK_MODE` | Force mock telephony | `true` |
| `WEBHOOK_SECRET` | Webhook auth (`x-webhook-secret` or Bearer) | `local-dev-webhook-secret` |
| `NEXT_PUBLIC_APP_URL` | Public app URL (webhook callbacks) | `http://localhost:3000` |
| `SUPERADMIN_EMAIL` / `SUPERADMIN_PASSWORD` | Seeded superadmin | see seed defaults below |

Production: use a strong `WEBHOOK_SECRET`, a real `SARVAM_API_KEY`, and `SARVAM_MOCK_MODE=false`. Never commit real keys.

---

## Roles

| Role | Scope |
| :--- | :--- |
| `SUPERADMIN` | Platform: onboard companies, RPS limits, ACTIVE/INACTIVE |
| `OWNER` / `ADMIN` | Own organisation: campaigns, workspaces, cohorts, lifecycle |
| `MEMBER` | Own workspace: read-only campaign / cohort views |

Sessions are `httpOnly` cookies. Client-supplied org/workspace IDs are never trusted for authz. Cross-tenant access returns `404` / `403`. Inactive orgs cannot start or dispatch campaigns.

---

## Quick start

### 1. Infrastructure

```bash
docker compose up -d
```

Starts PostgreSQL 16 and Redis 7 with persistent volumes.

### 2. Schema + seed

```bash
npm install
npm run setup   # db:push + db:seed
```

**Seeded demo logins** (local only):

| Account | Email | Password |
| :--- | :--- | :--- |
| Superadmin | `voiceagent@yopmail.com` | `12345678` |
| Acme Owner | `admin@acme.com` | `12345678` |
| Beta Owner | `admin@betahealth.com` | `12345678` |

Seeding is blocked in production unless `ALLOW_PRODUCTION_SEED=true`.

### 3. App + worker

```bash
# Terminal 1 — web UI & APIs
npm run dev

# Terminal 2 — outbound dispatcher
npm run worker
```

Open [http://localhost:3000/login](http://localhost:3000/login).

---

## Local demo path

1. Log in as **Superadmin** → `/admin` (metrics, RPS, company status, onboard company).
2. Sign out → log in as **Acme Owner**.
3. Create a campaign → download sample CSV → upload cohort → **Start**.
4. With `SARVAM_MOCK_MODE=true`, the worker simulates calls; webhooks / retries still exercise the lifecycle.

---

## Rate limiting

Per-organisation Redis sliding window (`ratelimit:org:{orgId}`):

- Keyed by org (shared across campaigns and workers).
- Strict rolling 1-second window (Lua) — no burst above `maxRequestsPerSecond`.
- Fail-closed if Redis is unavailable.

Superadmin sets each company’s RPS from the admin UI.

---

## Telephony (Sarvam)

**Dispatch:** `POST …/api/outbounds/v1/orgs/{org}/workspaces/{ws}/outbounds`

- Path `{org}` / `{ws}` come from server-side `SARVAM_ORG_ID` / `SARVAM_WORKSPACE_ID` (shared Sarvam account IDs), not Prisma organisation/workspace CUIDs.
- Mock when `SARVAM_MOCK_MODE=true` or key is missing/placeholder.
- Live when mock is off and a real `SARVAM_API_KEY` plus path IDs are set (non-placeholder `appId` / `connectionId` / caller number required).

**Webhooks:** `POST /api/webhooks/sarvam`

- Auth via `x-webhook-secret` or `Authorization: Bearer` only (query secrets rejected).
- Idempotent on already-ended attempts; maps completed / busy / no_answer into contact status + retries.

---

## Main APIs

Postman collection: [`docs/campaign-manager-postman-collection.json`](docs/campaign-manager-postman-collection.json)

| Area | Endpoints |
| :--- | :--- |
| Auth | `POST /api/auth/login`, `logout`, `GET /api/auth/me` |
| Admin | `GET/POST /api/admin/companies`, `GET/PATCH /api/admin/companies/[id]`, `GET /api/admin/metrics` |
| Workspaces | `GET/POST /api/workspaces` |
| Campaigns | `GET/POST /api/campaigns`, `GET/PATCH /api/campaigns/[id]` |
| Lifecycle | `POST …/start`, `pause`, `resume`, `stop` |
| Contacts | `GET …/contacts/sample`, `POST …/contacts/upload` |
| Webhooks | `POST /api/webhooks/sarvam` |
| Health | `GET /api/health` |

---

## Tests

```bash
npm test          # full suite
npm run demo      # live Postgres/Redis e2e walkthrough
npm run typecheck
```

---

## Reliability notes

- **Claim locking:** only one worker can move a contact to `IN_PROGRESS`.
- **Stale recovery:** stranded `IN_PROGRESS` contacts are recovered on worker start and every 60s.
- **Ambiguous provider errors:** marked for reconciliation instead of blind redial.
- **Credentials:** never returned in API bodies; use `.env.example` placeholders only in git.
