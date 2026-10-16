# Campaign Manager

Enterprise outbound AI voice campaign orchestration platform powered by **Next.js 16**, **PostgreSQL**, **Redis**, **BullMQ**, and integrated with **Sarvam AI's Outbound Voice Call API**.

---

## 1. System Architecture

```mermaid
flowchart TD
    subgraph ClientLayer["Client & Webhook Sources"]
        BrowserUI["Next.js Responsive UI (App Router)"]
        SarvamWebhook["Sarvam Telephony Webhooks"]
    end

    subgraph AppLayer["Next.js Application Layer (:3000)"]
        CampaignRoutes["Campaign CRUD & Lifecycle APIs\n(/api/campaigns/*)"]
        CohortRoutes["Cohort CSV Upload & Validation\n(/api/campaigns/:id/contacts/*)"]
        WebhookHandler["Webhook Receiver & Idempotency\n(/api/webhooks/sarvam)"]
        SlidingWindowLimiter["Atomic Sliding-Window Rate Limiter\n(Lua in Redis)"]
    end

    subgraph DataQueue["Persistent Storage & Queues"]
        Postgres[("PostgreSQL 16 DB\n(Authoritative State Store)")]
        RedisStore[("Redis 7\n(BullMQ & Sliding Window Keys)")]
    end

    subgraph ExecutionLayer["Distributed Worker Process"]
        WorkerProcess["BullMQ Standalone Worker Process\n(npm run worker - Concurrency: 10)"]
        ExecutionEngine["Execution Engine\n(State Check + Window + Claim)"]
        SarvamClient["Sarvam API Client\n(Mock / Live Dispatch)"]
    end

    subgraph Provider["External Telephony Engine"]
        SarvamAPI["Sarvam AI Outbound Voice API\n(POST /api/outbounds/v1/orgs/.../outbounds)"]
    end

    BrowserUI --> CampaignRoutes
    BrowserUI --> CohortRoutes
    SarvamWebhook --> WebhookHandler

    CampaignRoutes --> Postgres
    CohortRoutes --> Postgres
    WebhookHandler --> Postgres

    CampaignRoutes -->|Enqueue Jobs| RedisStore
    WorkerProcess -->|Consume Jobs| RedisStore
    WorkerProcess --> ExecutionEngine

    ExecutionEngine -->|Authoritative Lock & State| Postgres
    ExecutionEngine -->|Acquire Permit| SlidingWindowLimiter
    SlidingWindowLimiter --> RedisStore
    ExecutionEngine --> SarvamClient

    SarvamClient -->|Live Mode / Mock Mode| SarvamAPI
    SarvamAPI -.->|Telephony Events| SarvamWebhook
```

---

## 2. Technology Stack

- **Framework**: Next.js 16 (App Router, Turbopack)
- **Language**: TypeScript 5 (Strict Mode enabled)
- **Styling**: Tailwind CSS v4
- **Database ORM**: Prisma 6 with PostgreSQL 16
- **Distributed Cache & Queue**: Redis 7 & BullMQ 6
- **Validation**: Zod 4
- **CSV Stream Parser**: PapaParse 5
- **Telephony Provider**: Sarvam AI Outbound Voice Agent API

---

## 3. Environment Variables

Create a local `.env` file from `.env.example`:

```bash
cp .env.example .env
```

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/campaign_manager?schema=public` |
| `REDIS_URL` | Redis connection URI | `redis://localhost:6379` |
| `SARVAM_API_KEY` | Sarvam AI outbound call API key | Leave placeholder for Mock Mode, or set real key for Live |
| `SARVAM_API_BASE_URL` | Base URL for Sarvam API | `https://apps.sarvam.ai` |
| `SARVAM_MOCK_MODE` | Force mock telephony simulator (`true` or `false`) | `true` |
| `WEBHOOK_SECRET` | Secret token to authenticate incoming webhooks | `local-dev-webhook-secret` |
| `NEXT_PUBLIC_APP_URL` | Application root URL for webhooks | `http://localhost:3000` |
| `PORT` | Web server port | `3000` |
| `SUPERADMIN_EMAIL` | Configurable Superadmin login identity | `voiceagent@yopmail.com` |
| `SUPERADMIN_PASSWORD` | Configurable Superadmin password | `12345678` |

---

## 4. Multi-Tenant Architecture & Roles

The system enforces strict multi-tenancy with server-side session resolution and organization-level resource isolation.

### 4.1 Role Permissions Matrix

| Role | Scope | Permissions |
| :--- | :--- | :--- |
| `SUPERADMIN` | Platform-wide | Onboard companies, manage status (ACTIVE/INACTIVE), update organization RPS limits, view platform aggregate metrics, inspect company workspaces and campaigns. |
| `OWNER` | Own Organization | Full management of campaigns, workspaces, cohorts, CSV uploads, and lifecycle execution within their company. |
| `ADMIN` | Own Organization | Create, update, upload cohorts, and operate campaigns within their company's assigned workspaces. |
| `MEMBER` | Own Workspace | View campaigns and cohort progress within their authorized workspace. |

### 4.2 Security & Tenant Isolation Guarantees
1. **Server-Side Session Resolution**: User identity and company affiliation are derived exclusively from verified session tokens stored in secure, `httpOnly`, `sameSite: "lax"` cookies (`session_token`).
2. **Never Trust Client IDs**: Client-supplied `organizationId` or `workspaceId` headers/payloads are never trusted as proof of authorization. All queries and mutations verify ownership through authoritative database relations.
3. **Cross-Tenant Concealment (404/403)**: Attempts by Organization A to view, modify, or upload contacts to Organization B's resources return `404 Not Found` (preventing information disclosure regarding foreign resource IDs) or `403 Forbidden`.
4. **Inactive Company Enforcement**: Inactive organizations (`status: INACTIVE`) are blocked by both API endpoints and the background worker engine from dispatching calls or starting campaigns.
5. **Independent Redis Rate Limits**: Each organization has an isolated sliding-window counter keyed by `ratelimit:org:{orgId}`, dynamically configured by the Superadmin (`maxRequestsPerSecond`).

---

## 5. Quick Start & Startup Instructions

### 5.1 Start Infrastructure Containers

Start PostgreSQL and Redis with persistent volumes via Docker Compose (or use existing local services):

```bash
docker compose up -d
docker compose ps
```

### 5.2 Database Initialization & Idempotent Seeding

```bash
# Push Prisma schema to PostgreSQL
npm run db:push

# Seed Superadmin and demo company (idempotent - safe to rerun)
npm run db:seed
```

**Default Seed Credentials:**
- **Superadmin**: `voiceagent@yopmail.com` / `12345678`
- **Acme Corp Owner**: `admin@acme.com` / `12345678`

### 5.3 Run the Application & Worker

In separate terminal sessions:

```bash
# Terminal 1: Next.js Web Server (Port 3000)
npm run dev

# Terminal 2: BullMQ Background Worker (Outbound call dispatcher)
npm run worker
```

Open [http://localhost:3000/login](http://localhost:3000/login) to log in.

---

## 6. Local Demo Walkthrough

### 6.1 Superadmin Login & Dashboard
1. Navigate to `/login` and select **"Superadmin Demo"** (or enter `voiceagent@yopmail.com` / `12345678`).
2. You will be redirected to the **Superadmin Dashboard** (`/admin`).
3. View real-time database metrics: Total Companies, Total Workspaces, and Total Campaigns.
4. Search companies by name.
5. Adjust permitted requests-per-second (RPS) limits inline.
6. Toggle company status between `ACTIVE` and `INACTIVE` (instantly blocks background dispatches).

### 6.2 Onboarding a New Company
1. In the Superadmin Dashboard, click **"Onboard Company"**.
2. Fill in:
   - Company Name (e.g. `Globex Corporation`)
   - Owner Name (e.g. `Hank Scorpio`)
   - Owner Email (e.g. `hank@globex.com`)
   - Permitted Requests-per-Second Limit (e.g. `10`)
   - Password (defaults to `12345678`)
3. Submit the modal. The onboarding transaction atomically creates:
   - The `Organization` record
   - A default `Workspace`
   - The company `OWNER` user account with hashed password
4. The temporary password and login instructions are displayed for the Superadmin.

### 6.3 Company Owner Experience
1. Click **"Sign Out"** in the navigation bar.
2. Sign in as the company owner (e.g. `admin@acme.com` / `12345678` or newly onboarded owner).
3. The user is scoped strictly to their company:
   - View company campaigns and workspaces
   - Create new voice campaigns
   - Download sample CSV cohort templates tailored to agent variables
   - Upload contact cohorts with duplicate detection and E.164 normalization
   - Start, pause, resume, and stop campaigns
   - Cross-tenant requests to other companies will be rejected with `404 Not Found`

---

## 7. Automated Tests & Verification

### 7.1 Run Full Test Suite (51/51 Passing)

```bash
npm test
```

Executes 51 automated tests across 6 comprehensive suites:
1. `multi-tenant-auth.test.ts`: **Core security and isolation tests** proving:
   - Unauthenticated API access rejection (401)
   - Superadmin company onboarding transactionality and idempotency
   - Company owner campaign viewing and execution
   - Cross-tenant read/write isolation (Org A cannot read/mutate Org B's resources)
   - Cross-tenant workspace creation prevention
   - Non-superadmin rejection from `/api/admin/*` (403)
   - Inactive company dispatch and start blocking (403)
   - Independent Redis rate-limit counters per organization
   - Duplicate onboarding prevention
2. `campaign-api.test.ts`: Campaign CRUD, query filters, pagination, and config validation.
3. `cohort-upload.test.ts`: Multipart CSV upload, header normalization, required variable checks, and sample CSV downloads.
4. `rate-limiter.test.ts`: Atomic sliding-window rate limiter, rolling-second burst prevention, sub-1 RPS (0.5 RPS), fractional limits (8.5 RPS), zero/negative boundaries, and concurrent worker handling.
5. `lifecycle-execution.test.ts`: Start/pause/resume/stop state machine, calling windows, duplicate webhook idempotency, short duration retry rules, and atomic parallel worker claims.
6. `e2e-demo.test.ts`: Complete 12-step automated acceptance flow.

### 7.2 Run the End-to-End Demo Script

```bash
npm run demo
```

Executes an automated, colorized end-to-end verification covering all 12 core acceptance requirements against live PostgreSQL and Redis.

---

## 6. Organisation-Wide Rate Limiting: Algorithm & Guarantees

### 6.1 Strict Rolling One-Second Sliding Window
The platform implements an **atomic Redis Sliding Window Log (`ZSET`)** executed via Lua (`src/lib/rate-limiter.ts`):
- **Organisation Key**: Keyed per organization (`ratelimit:org:{orgId}`), shared across all campaigns, worker processes, and instances.
- **Strict Rolling-Second Policy**: Before admitting any request at millisecond timestamp $T$, the Lua script purges all elements older than $T - 1000\text{ms}$ (`ZREMRANGEBYSCORE`).
- **Zero Bursts Above Limit**: If `ZCARD` $\ge$ `limit`, the request is rejected with exact remaining millisecond backoff (`retryAfterMs`). Unlike naive token buckets which can permit twice the capacity across window boundaries, the sliding window log mathematically prevents more than $N$ requests in **ANY** 1000ms rolling interval.
- **Fail-Closed Safety**: In the event of a Redis network failure, the limiter fails closed (`allowed: false`) to safeguard external provider quotas.

---

## 7. Sarvam API Contract & Telephony Integration

### 7.1 Dispatch Contract
Target endpoint:
`POST https://apps.sarvam.ai/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds`

```json
{
  "app_config": {
    "app_id": "agent_retention_v2",
    "app_version": 1,
    "app_type": "agent",
    "connection_config": {
      "connection_id": "conn_telnyx_01",
      "agent_phone_number": "+14155552671"
    },
    "agent_variables": {
      "account_tier": "Enterprise",
      "renewal_discount": "20%"
    }
  },
  "app_overrides": null,
  "user_config": {
    "user_phone_number": "+919876543201"
  },
  "webhook_config": {
    "url": "http://localhost:3000/api/webhooks/sarvam",
    "metadata": {
      "campaign_id": "cmv...",
      "contact_id": "cmv...",
      "lead_id": "lead_101",
      "attempt_id": "cmv..."
    }
  }
}
```

- `app_type` is strictly `"agent"` conforming directly to the Sarvam Outbound Voice Agent API contract.
- `app_version` is parsed strictly as an **integer** (e.g. `"v1.2"` $\to$ `1`).
- Variable mapping maps cohort custom variables to `agent_variables`.
- `app_overrides` supports campaign-level agent overrides where configured.
- **Strict Production Live Validation**: In live mode (`SARVAM_MOCK_MODE=false`), the client strictly requires non-placeholder values for `appId`, `connectionId`, and `callerPhoneNumber`, refusing silent placeholder substitutions.

### 7.2 Safe Mock Mode vs Live Operation
- When `SARVAM_MOCK_MODE=true` (or when `SARVAM_API_KEY` is not provided), the client simulates realistic provider responses returning `mock_att_{timestamp}_{random}` without triggering external telephony.
- To switch to live telephony, set `SARVAM_MOCK_MODE=false` and provide a valid `SARVAM_API_KEY`.

---

## 8. Webhook Outcome & Retry Rules

The webhook endpoint (`POST /api/webhooks/sarvam`) ingests telephony events:
1. **Idempotency**: Webhook events check `callAttempt.endedAt`. Re-delivered duplicate webhooks are acknowledged immediately without duplicating retries or altering contact status.
2. **Outcome Mapping**:
   - `completed` / `answered`: Evaluates call duration. If `retryOnShortDuration` is enabled and `duration < shortDurationThresholdSeconds`, triggers retry backoff. Otherwise marks contact `COMPLETED`.
   - `busy`: If `retryOnBusy` is enabled, reschedules retry with exponential backoff if `contact.retryCount < campaign.maxRetries`.
   - `no_answer`: If `retryOnNoAnswer` is enabled, reschedules retry.
3. **Paused / Cancelled Campaigns**: Paused campaigns retain contacts in `PENDING` state with backoff timestamps for resumption; stopped/cancelled campaigns halt all retries immediately (`FAILED` / `DO_NOT_CALL`).

---

## 9. REST API Summary

A ready-to-import Postman collection is located at [`docs/campaign-manager-postman-collection.json`](docs/campaign-manager-postman-collection.json).

| Method | Endpoint | Description |
| :--- | :--- | :--- |
| `POST` | `/api/auth/login` | Authenticate user with scrypt password hash; issues HTTP-only session cookie. |
| `POST` | `/api/auth/logout` | Revoke active session token and clear HTTP-only cookie. |
| `GET` | `/api/auth/me` | Fetch authenticated user profile, organization, and role permissions. |
| `GET` | `/api/admin/metrics` | **[Superadmin]** Live platform stats: total companies, workspaces, campaigns. |
| `GET` | `/api/admin/companies` | **[Superadmin]** Paginated company list with user count, campaign count, RPS, status. |
| `POST` | `/api/admin/companies` | **[Superadmin]** Transactional onboarding: Organization, Workspace, and Owner. |
| `GET` | `/api/admin/companies/[id]` | **[Superadmin]** Company inspection with workspaces, users, and campaigns. |
| `PATCH` | `/api/admin/companies/[id]` | **[Superadmin]** Update company RPS limit or toggle status (ACTIVE/INACTIVE). |
| `GET` | `/api/workspaces` | List authorized workspaces scoped to the user's organization. |
| `POST` | `/api/workspaces` | Provision a new workspace within an authorized organization context. |
| `POST` | `/api/campaigns` | Create a campaign with validated calling window, agent, and retry configuration. |
| `GET` | `/api/campaigns` | List campaigns with contact counts, search, status filters, and pagination. |
| `GET` | `/api/campaigns/[id]` | Get detailed campaign configuration, aggregate outcome metrics, and paginated contacts. |
| `PATCH` | `/api/campaigns/[id]` | Update campaign configuration safely while preventing invalid state transitions. |
| `POST` | `/api/campaigns/[id]/start` | Start campaign; validates $\ge 1$ contact, enqueues pending contacts to BullMQ. |
| `POST` | `/api/campaigns/[id]/pause` | Pause campaign; halts pending dispatches immediately. |
| `POST` | `/api/campaigns/[id]/resume` | Resume paused campaign and re-enqueue eligible contacts. |
| `POST` | `/api/campaigns/[id]/stop` | Stop campaign permanently; sets remaining contacts to `DO_NOT_CALL`. |
| `GET` | `/api/campaigns/[id]/contacts/sample` | Download sample CSV template tailored to campaign required variables. |
| `POST` | `/api/campaigns/[id]/contacts/upload` | Upload multipart CSV cohort; validates E.164 phone numbers and required variables. |
| `POST` | `/api/webhooks/sarvam` | Ingest call outcome telemetry, calculate durations, and execute retry rules. |

---

## 10. Reliability & Security Considerations

1. **Race Conditions Across Workers**: When parallel workers pick up jobs for the exact same contact, PostgreSQL conditional locking (`UPDATE contacts SET status = 'IN_PROGRESS' WHERE status IN ('QUEUED', 'PENDING')`) guarantees that exactly **one** worker succeeds, while subsequent workers skip execution safely.
2. **Worker Crash & Stale Job Recovery**: If a worker process abruptly terminates or crashes while contacts are marked `IN_PROGRESS`, contacts could otherwise become stranded. The background worker runs `recoverStaleContacts(maxStaleAgeMs)` on startup and during a recurring 60-second background maintenance sweep. Contacts stranded in `IN_PROGRESS` beyond the staleness threshold without active attempts are recovered back to `PENDING` or scheduled for reconciliation.
3. **Ambiguous Provider Failures**: If an external network timeout or 5xx occurs after dispatch, the attempt is marked with `isAmbiguous: true` and a reconciliation backoff is applied rather than blindly re-calling the customer and risking duplicate calls.
4. **Tenant Isolation**: Campaigns and rate limits are scoped to verified workspaces and organizations. Client-supplied organization IDs are never trusted blindly.
5. **Credential Safety**: No API keys or secrets are exposed in API responses or logs. `.env.example` contains only non-sensitive placeholders. Temporary passwords are cryptographically generated using 72-bit secure random tokens.
