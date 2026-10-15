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
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:StrongPassword123@localhost:5432/campaign_manager?schema=public` |
| `REDIS_URL` | Redis connection URI | `redis://localhost:6379` |
| `SARVAM_API_KEY` | Sarvam AI outbound call API key | Leave placeholder for Mock Mode, or set real key for Live |
| `SARVAM_API_BASE_URL` | Base URL for Sarvam API | `https://apps.sarvam.ai` |
| `SARVAM_MOCK_MODE` | Force mock telephony simulator (`true` or `false`) | `true` |
| `WEBHOOK_SECRET` | Secret token to authenticate incoming webhooks | `local-dev-webhook-secret` |
| `NEXT_PUBLIC_APP_URL` | Application root URL for webhooks | `http://localhost:3000` |
| `PORT` | Web server port | `3000` |

---

## 4. Quick Start & Startup Instructions

### 4.1 Start Infrastructure Containers

Start PostgreSQL and Redis with persistent volumes and health checks via Docker Compose:

```bash
docker compose up -d
docker compose ps
```

### 4.2 Database Initialization & Seeding

```bash
# Push Prisma schema to PostgreSQL
npm run db:push

# Seed default organization and workspace
npm run db:seed
```

### 4.3 Run the Application & Worker

In separate terminal sessions:

```bash
# Terminal 1: Next.js Web Server (Dashboard & REST APIs)
npm run dev

# Terminal 2: BullMQ Background Worker (Outbound call dispatcher)
npm run worker
```

Open [http://localhost:3000](http://localhost:3000) to access the Campaign Manager UI.

---

## 5. Automated Tests & Demo Script

### 5.1 Run Full Test Suite (40/40 Passing)

```bash
npm test
```

Executes 40 unit and integration tests across 5 test suites:
1. `campaign-api.test.ts`: Campaign CRUD, query filters, pagination, and config validation.
2. `cohort-upload.test.ts`: Multipart CSV upload, header normalization, required variable checks, and sample CSV downloads.
3. `rate-limiter.test.ts`: Atomic sliding-window rate limiter, rolling-second burst prevention, and 30-worker concurrency.
4. `lifecycle-execution.test.ts`: Start/pause/resume/stop state machine, calling windows, duplicate webhook idempotency, short duration retry rules, and atomic parallel worker claims.
5. `e2e-demo.test.ts`: Complete 12-step automated acceptance flow.

### 5.2 Run the End-to-End Demo Script

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
    "app_type": "outbound_voice",
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

- `app_version` is parsed strictly as an **integer** (e.g. `"v1.2"` $\to$ `1`).
- Variable mapping maps cohort custom variables to `agent_variables`.
- `app_overrides` supports campaign-level agent overrides where configured.

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
| `POST` | `/api/campaigns` | Create a campaign with validated calling window, agent, and retry configuration. |
| `GET` | `/api/campaigns` | List campaigns with contact counts, search, status filters, and pagination. |
| `GET` | `/api/campaigns/[id]` | Get detailed campaign configuration and paginated cohort contacts. |
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
2. **Ambiguous Provider Failures**: If an external network timeout or 5xx occurs after dispatch, the attempt is marked with `isAmbiguous: true` rather than blindly re-calling the customer.
3. **Tenant Isolation**: Campaigns and rate limits are scoped to verified workspaces and organizations. Client-supplied organization IDs are never trusted blindly.
4. **Credential Safety**: No API keys or secrets are exposed in API responses or logs. `.env.example` contains only non-sensitive placeholders.
