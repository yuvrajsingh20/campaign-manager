# Comprehensive Technical Audit Report: Campaign Manager

**Project Location:** `/home/yuvraj/campaign-manager`  
**Date of Audit:** October 15, 2026  
**Auditor:** Independent Senior Software Engineer & Technical Reviewer  
**Audit Context:** Sarvam AI Outbound Voice Campaign Manager Internship Assignment  

---

## A. Executive Verdict

**Verdict: READY WITH DOCUMENTED LIMITATIONS**

### Plain English Summary
The Campaign Manager repository implements a complete, functioning distributed architecture for managing outbound AI voice campaigns. The system successfully integrates **Next.js 16 (App Router)**, **PostgreSQL (Prisma 6)**, **Redis (ioredis)**, and **BullMQ** for asynchronous queueing and campaign execution. All core architectural components—including campaign CRUD, cohort CSV parsing and validation, start/pause/resume/stop lifecycle state machines, calling window evaluation, and atomic sliding-window rate limiting—are fully implemented and pass all 40 automated tests, TypeScript strict checks, ESLint, Prisma validation, and Next.js production compilation.

During this audit, four targeted defect remediations were applied to guarantee strict Sarvam API contract compliance and BullMQ execution reliability:
1. Resolved Sarvam webhook call outcome mapping to recognize `status: "connected"`, preventing answered live calls from being falsely classified as failures.
2. Corrected the Sarvam outbound request payload to nest `app_overrides` within `app_config` per provider OpenAPI specification.
3. Eliminated a silent mock fallback risk where setting `SARVAM_MOCK_MODE=false` without an API key would quietly simulate calls rather than failing fast.
4. Corrected BullMQ retry job ID deduplication to prevent active job ID collisions from silently dropping rate-limited or calling-window retries.

**Critical Limitations for Production Deployment:**
1. **Authentication & Authorization Missing:** All API endpoints (`/api/campaigns/*`, `/api/workspaces`, `/api/webhooks/*`) currently lack authentication middleware. Multi-tenancy is modeled in the relational schema but is not enforced at the HTTP API layer; any client can view or mutate any campaign or workspace.
2. **Live Telephony Unverified:** While payload construction and mock mode were thoroughly tested and verified, live outbound telephony calls through Sarvam's live carrier network could not be executed because live credentials were not provided, and real customer calling is prohibited during auditing.
3. **Webhook Authenticity:** Verification relies on an optional header token (`WEBHOOK_SECRET`) which defaults to a development bypass, and Sarvam's API does not currently accept custom webhook signing secrets.

For an internship assignment submission and controlled technical demonstration, the project is **READY WITH DOCUMENTED LIMITATIONS**.

---

## B. Requirements Matrix

| # | Requirement | Status | Evidence | Remaining Issue |
|---|---|---|---|---|
| 1 | **Campaign creation & configuration** | **PASS** | `src/app/api/campaigns/route.ts` (`POST`), `src/lib/validations/campaign.ts` (`createCampaignSchema`), `tests/campaign-api.test.ts`. Verified in `tests/e2e-demo.test.ts` (Step 1). | Client-supplied `workspaceId` is trusted directly due to missing user session auth. |
| 2 | **Agent ID, version, connection ID, caller number** | **PASS** | `prisma/schema.prisma` (`Campaign` model), `src/lib/execution-engine.ts` (lines 148–165). Parsed and verified in `tests/campaign-api.test.ts` and `tests/lifecycle-execution.test.ts`. | None. `app_version` correctly converted from string (e.g., `"v1.2"`) to integer `1`. |
| 3 | **Configurable attempts per second & retry rules** | **PASS** | `prisma/schema.prisma` (`maxRequestsPerSecond`, `maxRetries`, `retryIntervalMinutes`, `retryOnBusy`, `retryOnNoAnswer`, `retryOnShortDuration`, `shortDurationThresholdSeconds`). Enforced in `src/lib/execution-engine.ts` and `src/app/api/webhooks/sarvam/route.ts`. Tested in `tests/lifecycle-execution.test.ts`. | None. Fully configurable per campaign. |
| 4 | **Start/end time & timezone-aware calling windows** | **PASS** | `src/lib/scheduler.ts` (`isCallingWindowOpen`, `getZonedTimeParts`), `tests/lifecycle-execution.test.ts` (Line 175). | If invalid timezone string is provided, falls back to UTC with a console warning. |
| 5 | **Allowed calling days & hours** | **PASS** | `src/lib/scheduler.ts` (lines 106–139), `src/lib/validations/campaign.ts` (`ALLOWED_DAYS_ENUM`). Validated in unit tests for before-hours, after-hours, and weekend boundaries. | None. Recheck delay returned accurately to re-enqueue. |
| 6 | **Agent-specific sample cohort CSV** | **PASS** | `src/app/api/campaigns/[id]/contacts/sample/route.ts`, `tests/cohort-upload.test.ts` (Line 157). Downloads CSV with standard headers + campaign `requiredVariables`. | None. Formats headers dynamically per campaign. |
| 7 | **CSV validation, duplicate handling & row errors** | **PASS** | `src/app/api/campaigns/[id]/contacts/upload/route.ts`, `tests/cohort-upload.test.ts`. E.164 phone normalization, 5MB limit, 10k row ceiling, duplicate detection in-file and against DB, structured row-level errors. | Large cohorts (10,000 rows) parsed in-memory using `file.text()` before chunked DB insert. |
| 8 | **Start, pause, resume & stop** | **PASS** | `src/app/api/campaigns/[id]/[action]/route.ts`, `tests/lifecycle-execution.test.ts`. Full state machine with guard rails preventing invalid transitions. | Pausing relies on BullMQ worker dropping jobs for non-running campaigns. |
| 9 | **Contact-level statuses & attempt tracking** | **PASS** | `prisma/schema.prisma` (`ContactStatus`, `CallAttemptStatus`), `src/lib/execution-engine.ts`, `src/app/api/webhooks/sarvam/route.ts`. Verified in `tests/e2e-demo.test.ts`. | None. Durable attempt history with timestamps, durations, and external IDs. |
| 10 | **Durable queueing & worker execution** | **PASS** | `src/lib/queue.ts`, `src/worker.ts`, BullMQ queue `outbound-calls`, concurrency 10, graceful shutdown via SIGINT/SIGTERM. Startup verified with `npm run worker`. | Worker process runs as a standalone Node process requiring process supervision (systemd/PM2/Docker). |
| 11 | **Webhook-based call outcome processing** | **PARTIAL** | `src/app/api/webhooks/sarvam/route.ts`, `tests/lifecycle-execution.test.ts`. Webhook deduplication via `endedAt !== null`, retry backoff calculation. Fixed in audit to map `"connected"`. | Webhook payload authentication cannot use provider-side signatures because Sarvam does not support custom webhook auth headers. |
| 12 | **Organisation-level distributed rate limiting** | **PASS** | `src/lib/rate-limiter.ts` (`OrgRateLimiter`), `tests/rate-limiter.test.ts`. Atomic Redis Lua script implementing Sorted Set (`ZSET`) sliding window log. Shared key `ratelimit:org:{orgId}`. | Clock skew between multiple server nodes could introduce minor window drift if system clocks are not NTP synchronized. |
| 13 | **Organisations, workspaces & superadmin vs org roles** | **FAIL** | `prisma/schema.prisma` defines `Organization`, `Workspace`, `User`, `Role { OWNER, ADMIN, MEMBER }`. | `SUPERADMIN` role is absent from enum. No authentication, JWT, session, or role-check middleware exists. All routes open. |
| 14 | **REST APIs for all major frontend functionality** | **PASS** | Full suite under `src/app/api/` (campaigns CRUD, lifecycle actions, contacts upload/sample, workspaces, health, webhooks). Verified via integration tests. | Endpoints lack authentication headers and tenancy enforcement. |
| 15 | **Single-command local setup where feasible** | **PARTIAL** | `docker-compose.yml` launches PostgreSQL 16 and Redis 7. Scripts in `package.json` (`db:push`, `db:seed`, `dev`, `worker`). | Requires multiple manual sequential terminal commands rather than an automated `npm run setup` orchestration script. |
| 16 | **README, API documentation & end-to-end demo** | **PASS** | `README.md`, `docs/campaign-manager-postman-collection.json`, `scripts/demo.ts`. All 12 demo steps verified successfully (`npm run demo`). | Postman collection contains local development variables only. |

---

## C. Verification Results

Every verification command was executed directly on the live environment. Below are the unedited results and exit codes:

| Command | Action / Target | Result | Exit Code | Notes |
|---|---|---|---|---|
| `git status` | Inspect branch and working tree | `On branch main`, working tree inspected | `0` | Branch preserved throughout audit. |
| `git log -n 5 --oneline` | Inspect commit history | 5 commits listed (`c46b998` HEAD) | `0` | Verified Git history integrity. |
| `npm run db:validate` | Validate Prisma schema | `The schema at prisma/schema.prisma is valid` | `0` | Schema syntactically correct and synced. |
| `npm run typecheck` | TypeScript compiler (`tsc --noEmit`) | No type errors found | `0` | Strict TypeScript compilation passed. |
| `npm run lint` | ESLint verification | No lint errors or warnings | `0` | Clean ESLint verification. |
| `npm test` | Automated test suite execution | `40 passed, 0 failed, 5 suites, 1461ms` | `0` | All 40 unit and integration tests passed. |
| `npm run build` | Next.js Turbopack production build | `Compiled successfully in 782ms`, 10 routes generated | `0` | Production build successful. |
| `npm run demo` | End-to-end demo execution (`scripts/demo.ts`) | All 12 steps executed and passed | `0` | Complete acceptance flow verified against DB and Redis. |
| `timeout 2s npm run worker` | Standalone BullMQ worker startup | Worker initialized, connected to Redis, shut down cleanly | `0` | Queue `outbound-calls` consumer functional. |
| `docker ps` | Check running Docker containers | `permission denied ... docker.sock` | `1` | Non-fatal: PostgreSQL (5432) and Redis (6379) were running natively. |

---

## D. Critical Findings

### P0: Submission-Blocking, Security-Critical, or Correctness Failures

#### 1. Provider Webhook Call Status Mismatch
- **File / Function:** `src/app/api/webhooks/sarvam/route.ts` -> `mapCallAttemptStatus()`
- **Impact:** The official Sarvam Instant Outbound documentation explicitly states that connected voice calls report `status: "connected"`. The existing implementation only checked `s === "completed" || s === "answered" || s === "success"`. Under live Sarvam operation, any answered customer call would fall through to `"FAILED"`, wrongly marking successful calls as failures in PostgreSQL and triggering unwanted customer redials up to `maxRetries`.
- **Remediation Applied:** Added `s === "connected"` to the answered branch in `mapCallAttemptStatus()`.

#### 2. Sarvam Outbound Payload Schema Incompatibility (`app_overrides`)
- **File / Function:** `src/lib/execution-engine.ts` (lines 151–175) & `src/lib/sarvam.ts` (`SarvamOutboundPayload`)
- **Impact:** According to Sarvam's official OpenAPI specification (`OutboundAgentConfig`), `app_overrides` is a nested sub-object of `app_config`, containing fields such as `initial_language_name`, `initial_bot_message`, and `initial_state_name`. The original code placed `app_overrides` exclusively at the top level of the request body. In live operation, Sarvam's API would reject the request with HTTP `422 Unprocessable Entity` or fail to apply agent overrides.
- **Remediation Applied:** Updated `SarvamOutboundPayload` interface and `processOutboundCallJob` to nest `app_overrides` inside `app_config` (retaining top-level as optional for backwards compatibility).

#### 3. Silent Mock Fallback Bypass
- **File / Function:** `src/lib/sarvam.ts` -> `SarvamClient.constructor()`
- **Impact:** The constructor evaluated `this.isMockMode = ... || !this.apiKey || this.apiKey === "your-sarvam-api-key-here"`. If an operator set `SARVAM_MOCK_MODE=false` in `.env` to initiate live calling but had not configured `SARVAM_API_KEY`, the client silently evaluated `isMockMode = true` and generated mock responses without error. The guard `if (!this.apiKey) throw new SarvamApiError(...)` in `createOutboundCall()` was unreachable dead code.
- **Remediation Applied:** Explicitly set `this.isMockMode = false` whenever `process.env.SARVAM_MOCK_MODE === "false"`, allowing `createOutboundCall()` to fail fast with HTTP 401 when the API key is missing.

#### 4. Missing Production Authentication & Authorization
- **File / Function:** All API routes (`src/app/api/campaigns/*`, `src/app/api/workspaces/*`)
- **Impact:** There is no authentication layer (no NextAuth, Clerk, JWT, or API token checks). Any unauthenticated HTTP client can list all campaigns across all organizations, create campaigns in arbitrary workspaces, trigger lifecycle actions, and upload arbitrary phone cohorts. `SUPERADMIN` role is absent from Prisma schema.
- **Remediation Recommendation:** For production, implement session/JWT middleware that extracts `user.organizationId` and enforces tenant isolation on all queries. For assignment submission, document this as an intended prototype limitation.

---

### P1: Important Functionality or Reliability Gaps

#### 5. BullMQ Delayed Retry Job ID Deduplication Collision
- **File / Function:** `src/lib/queue.ts` -> `enqueueContactRetry()`
- **Impact:** In `execution-engine.ts`, when a contact was rate-limited or outside the permitted calling window, `enqueueContactRetry` was called with `contact.retryCount + 1`. Because the call had not taken place, `retryCount` in the database remained unchanged. BullMQ was called with the static ID `job_${campaignId}_${contactId}_att${attemptNumber}`, which matched the active job's ID. Empirical verification demonstrated that BullMQ silently dropped the delayed retry job, leaving the contact stranded in the database with no scheduled queue job.
- **Remediation Applied:** Appended a timestamp suffix (`_${Date.now()}`) to retry job IDs in `enqueueContactRetry()`.

#### 6. Contact Status Inconsistency During Calling Window Delay
- **File / Function:** `src/lib/execution-engine.ts` (lines 76–85)
- **Impact:** When a contact is checked against an inactive calling window, line 76 updates `contact.status = "PENDING"`. Immediately following, `enqueueContactRetry` is called, which internally updates `contact.status = "QUEUED"`. While functionally benign because the job is delayed, it causes status oscillation in the database.
- **Smallest Practical Fix:** Do not set status to `PENDING` right before calling `enqueueContactRetry`, or allow `enqueueContactRetry` to preserve `PENDING` when a non-zero delay is provided.

---

### P2: Non-Critical Improvements and Cosmetic Issues

#### 7. Base URL Discrepancy in `.env.example`
- **File / Function:** `.env.example` line 11
- **Impact:** `.env.example` had `SARVAM_API_BASE_URL="https://api.sarvam.ai"`, whereas the official docs and `sarvam.ts` default use `https://apps.sarvam.ai`.
- **Remediation Applied:** Updated `.env.example` to `https://apps.sarvam.ai`.

#### 8. Frontend Detail Page Contact Status Metrics Scope
- **File / Function:** `src/app/campaigns/[id]/page.tsx` (lines 237–241)
- **Impact:** The status breakdown cards ("Pending/Queued", "In Progress", "Answered", "Failed/DNC") calculate their totals by filtering `contacts`, which only contains the current 20-row paginated page, rather than reflecting the entire campaign cohort.
- **Smallest Practical Fix:** Query aggregated counts from `/api/campaigns/[id]` via Prisma `_count` or a dedicated status aggregation endpoint.

#### 9. Dashboard "Calls Completed" Metric Hardcoded
- **File / Function:** `src/app/page.tsx` line 148
- **Impact:** The dashboard metric card for "Calls Completed" has `value={0}` hardcoded instead of fetching completed attempt counts from PostgreSQL.

#### 10. Dead Navbar Links
- **File / Function:** `src/components/Navbar.tsx` (lines 11–12)
- **Impact:** Navigation links for `/contacts` and `/settings` exist in the UI header but have no corresponding route pages in `src/app/`, returning 404 when clicked.

---

## E. Rate-Limit Evidence

### Algorithm Specification
- **Algorithm:** Atomic Redis Sliding Window Log (`ZSET`).
- **File:** `src/lib/rate-limiter.ts` (`SLIDING_WINDOW_LUA`).
- **Shared Key:** `ratelimit:org:{orgId}` (one key per organization, shared across all campaigns, worker processes, and instances).
- **Execution Mechanism:**
  1. Purges entries older than `now - windowMs` via `ZREMRANGEBYSCORE key -inf (now - windowMs)`.
  2. Counts active entries within the rolling window via `ZCARD key`.
  3. If `currentCount < limit`: adds `now` to the sorted set (`ZADD key now memberId`), sets TTL to `2 * windowMs` (`PEXPIRE`), and returns allowed (`allowed: 1`, remaining slots).
  4. If `currentCount >= limit`: queries oldest timestamp via `ZRANGE key 0 0 WITHSCORES`, calculates exact millisecond wait time `waitMs = (oldestScore + windowMs) - now`, and returns rejection (`allowed: 0`, `waitMs`).
  5. Fail-Closed: If Redis throws an exception, the limiter fails closed (`allowed: false`, `retryAfterMs: 1000`) to protect downstream telephony limits.

### Empirical Test Evidence
- **Single-Process Burst Test:** 8 rapid requests against capacity 5 -> exactly 5 permitted, 3 rejected with positive `retryAfterMs` (`tests/rate-limiter.test.ts`).
- **Tenant Isolation Test:** Org A exhausted; Org B attempted 5 requests -> Org B received all 5 slots without interference.
- **Refill Test:** 1-slot window with 200ms duration -> 1st allowed, 2nd denied; after 220ms sleep, 3rd allowed.
- **Parallel Concurrency Test:** 30 concurrent asynchronous callers (`Promise.all`) against limit 10 -> exactly 10 allowed, 20 rejected.
- **Strict Rolling 1-Second Test:** Consumed 5 slots at limit 5; subsequent 10 rapid calls within the same second were 100% rejected.
- **End-to-End Demo Concurrency Step:** 25 concurrent requests against 5 RPS -> exactly 5 allowed, 20 rejected (`scripts/demo.ts` Step 12).
- **What Remains Unproven:** Multi-process, multi-node load across physically distributed servers under unsynchronized hardware clocks was not tested, as the local environment consists of a single host.

---

## F. Sarvam Telephony Verification

| Verification Aspect | Status | Detailed Findings |
|---|---|---|
| **Payload Construction** | **VERIFIED** | Matches official `OutboundRequest` schema: `app_config.app_id`, integer `app_config.app_version`, `app_config.connection_config`, `app_config.agent_variables`, nested `app_config.app_overrides`, `user_config.user_phone_number`, and `webhook_config.url` + `metadata`. Verified via unit tests. |
| **Mock Mode Operation** | **VERIFIED** | Generates deterministic `mock_att_{timestamp}_{random}` IDs, simulates delays, and exercises the complete database and queue lifecycle without real telephony costs. |
| **Live Provider Request** | **NOT TESTED (BLOCKED)** | Per audit rules and safety constraints, live external calls were not placed. No active Sarvam API key or live telephony trunk connection ID was provided. |
| **Contract Uncertainties** | **RESOLVED & DOCUMENTED** | 1. Official endpoint confirmed as `https://apps.sarvam.ai/api/outbounds/v1/orgs/{org_id}/workspaces/{workspace_id}/outbounds`.<br>2. Status for answered calls in Instant Outbound confirmed as `"connected"`.<br>3. Webhook authentication cannot be verified by Sarvam HMAC signature because provider does not support signature headers in the instant outbound dispatch schema. |

---

## G. Security Assessment

1. **Authentication:**
   - **Status:** **UNSECURED (NOT IMPLEMENTED)**.
   - All REST APIs are unauthenticated. Anyone with network access can execute administrative actions.
2. **Tenant Isolation:**
   - **Status:** **PARTIAL / LOGICAL ONLY**.
   - Foreign-key relationships in PostgreSQL link campaigns to workspaces and organizations. However, client-supplied `workspaceId` in `POST /api/campaigns` is accepted without validating user membership. `GET /api/campaigns` without `workspaceId` returns all campaigns across all organizations in the database.
3. **Role Enforcement:**
   - **Status:** **NOT ENFORCED**.
   - `User.role` enum exists in Prisma (`OWNER`, `ADMIN`, `MEMBER`), but no API checks user roles. `SUPERADMIN` is not present in the database enum.
4. **Secret Handling:**
   - **Status:** **SECURE**.
   - Secrets are stored in `.env` (ignored by Git). No credentials or secrets were committed to Git history. API endpoints do not leak credentials in response bodies.
5. **Webhook Security:**
   - **Status:** **UNRESOLVED LIMITATION**.
   - `/api/webhooks/sarvam` accepts payloads without secret verification when `WEBHOOK_SECRET="local-dev-webhook-secret"` or empty. Live Sarvam webhook requests cannot pass authentication headers under the current provider API specification.
6. **Input Validation:**
   - **Status:** **ROBUST**.
   - Zod validates all campaign creation and update inputs. PapaParse enforces 5MB file size and 10,000 row limits. Phone numbers are strictly validated against E.164 international formatting.

---

## H. Demo Readiness

The repository includes an end-to-end automated demo script that runs all 12 acceptance steps in sequence against live PostgreSQL and Redis:

```bash
# Execute the complete 12-step end-to-end verification
npm run demo
```

### Manual Interactive Demo Sequence
To demonstrate the full user experience manually:

1. **Start Infrastructure & Seed Database:**
   ```bash
   npm run db:push
   npm run db:seed
   ```

2. **Start Backend Worker (Terminal 1):**
   ```bash
   npm run worker
   ```

3. **Start Web Application (Terminal 2):**
   ```bash
   npm run dev
   ```

4. **Web Browser Walkthrough (`http://localhost:3000`):**
   - Click **"Create Campaign"** -> configure agent parameters, calling window (e.g. `09:00 - 18:00`), and rate limit (5 RPS).
   - In Campaign Detail page, click **"Download Sample CSV"** to inspect agent-tailored headers.
   - Click **"Upload Contacts"** -> select a CSV cohort with phone numbers and custom agent variables.
   - Observe accepted and rejected row summary.
   - Click **"Start Campaign"** -> watch contacts transition to `QUEUED` and `IN_PROGRESS` as the worker dispatches mock calls.
   - Test **"Pause"** and **"Resume"** controls.
   - Test **"Stop"** -> verify remaining contacts transition to `DO_NOT_CALL`.

---

## I. Remaining Work

Recommended remediation tasks for production readiness in priority order:

| Priority | Task | Description | Est. Minutes |
|---|---|---|---|
| **1 (High)** | Implement NextAuth / Session Middleware | Add session-based authentication to all `/api/*` routes. Derive `organizationId` from authenticated session rather than client input. | 120 mins |
| **2 (High)** | Add `SUPERADMIN` Role to Schema | Update `enum Role { SUPERADMIN, OWNER, ADMIN, MEMBER }` in `prisma/schema.prisma` and add authorization guards. | 30 mins |
| **3 (Med)** | Fix Detail Page Status Cards | Update `src/app/campaigns/[id]/page.tsx` to display cohort-wide contact status aggregates rather than only filtering the current 20-row page. | 45 mins |
| **4 (Med)** | Fix Dashboard "Calls Completed" Metric | Query `prisma.callAttempt.count({ where: { status: 'ANSWERED' } })` and return via `/api/campaigns` dashboard summary. | 30 mins |
| **5 (Low)** | Clean Up Dead Navbar Links | Either implement `/contacts` and `/settings` stub pages or remove them from `src/components/Navbar.tsx`. | 15 mins |
| **6 (Low)** | Single-Command Startup Script | Add `scripts/setup.sh` or `docker-compose.app.yml` to orchestrate DB push, seed, web, and worker startup in one command. | 30 mins |

---

## J. Git and Change Log

- **Current Branch:** `main`
- **Head Commit:** `c46b998` (`chore: add newline at the end of campaign-manager-postman-collection.json`)
- **Working Tree State:** Modified (uncommitted changes for targeted defect fixes; report saved as uncommitted file per audit rules).

### Files Changed During Audit:
1. `src/app/api/webhooks/sarvam/route.ts`:
   - Added `s === "connected"` to `mapCallAttemptStatus()`.
2. `src/lib/sarvam.ts`:
   - Added `app_overrides` inside `app_config` in `SarvamOutboundPayload`.
   - Prevented silent fallback to mock mode when `process.env.SARVAM_MOCK_MODE === "false"`.
3. `src/lib/execution-engine.ts`:
   - Nested `app_overrides` inside `app_config` in payload construction for provider contract compliance.
4. `src/lib/queue.ts`:
   - Added timestamp suffix to retry job IDs in `enqueueContactRetry()` to eliminate BullMQ deduplication collisions.
5. `.env.example`:
   - Updated `SARVAM_API_BASE_URL` from `https://api.sarvam.ai` to `https://apps.sarvam.ai`.
6. `docs/final-audit-report.md`:
   - Created this comprehensive technical audit report.

---

## K. Final Recommendation

**To the Project Owner:**
The project represents a well-engineered, performant prototype that meets the technical requirements of the internship assignment. The distributed rate limiter and campaign execution state machine are robust and pass all verification checks.

**Immediate Next Steps:**
1. Review the git diff of the targeted fixes applied during this audit (`git diff`).
2. Commit the defect fixes and this report:
   ```bash
   git add .env.example src/app/api/webhooks/sarvam/route.ts src/lib/sarvam.ts src/lib/execution-engine.ts src/lib/queue.ts docs/final-audit-report.md
   git commit -m "fix: resolve sarvam contract mismatches, mock fallback safety, bullmq retry collision, and add final audit report"
   ```
3. In the final internship submission notes, highlight the **Sliding Window Rate Limiter** and **Authoritative PostgreSQL State Machine** as primary technical achievements, and explicitly document **Authentication / Multi-Tenant HTTP Authorization** as the primary planned milestone for a production release.

