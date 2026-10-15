# Campaign Manager

Enterprise campaign management platform for autonomous outbound AI voice calls, integrated with Sarvam's Outbound Voice Call API.

---

## 1. Project Purpose

Campaign Manager orchestrates multi-tenant outbound AI voice calling campaigns at scale. Organizations can create campaigns, configure AI voice agents with dynamic prompt variables, upload customer cohorts via CSV, define daily calling windows and retry policies, enforce organization-wide API rate limits, and track contact call lifecycles through webhook outcome ingestion.

---

## 2. Technology Stack

- **Framework**: [Next.js](https://nextjs.org/) (v16, App Router)
- **Language**: TypeScript (Strict Mode enabled)
- **Styling**: [Tailwind CSS](https://tailwindcss.com/) (v4)
- **Database**: PostgreSQL (v16) via [Prisma ORM](https://www.prisma.io/) (v6)
- **Job Queue & Cache**: Redis (v7) & [BullMQ](https://bullmq.io/)
- **Validation**: [Zod](https://zod.dev/)
- **Cohort Processing**: [PapaParse](https://www.papaparse.com/)
- **Infrastructure**: Docker Compose with health checks and persistent volumes
- **External Voice API**: [Sarvam AI](https://www.sarvam.ai/) Outbound Voice Call API

---

## 3. Architecture Overview

```mermaid
flowchart TD
    subgraph Frontend["Next.js App Router (UI & API)"]
        Dashboard["Landing Dashboard / UI"]
        RestAPI["REST API Routes (/api/*)"]
        WebhookHandler["Webhook Ingestion (/api/webhooks/sarvam)"]
    end

    subgraph CoreServices["Application Services & Libs"]
        PrismaClient["Prisma ORM Client"]
        RateLimiter["Org Rate Limiter (Token Bucket)"]
        QueueProducer["BullMQ Outbound Queue Producer"]
    end

    subgraph Infrastructure["Infrastructure (Docker Compose)"]
        PostgresDB[("PostgreSQL 16 DB\n(Persistent Volume)")]
        RedisStore[("Redis 7 Cache & Queue\n(Persistent AOF)")]
    end

    subgraph External["External Integrations"]
        SarvamAPI["Sarvam Outbound Voice API"]
    end

    Dashboard --> RestAPI
    RestAPI --> RateLimiter
    RestAPI --> QueueProducer
    RestAPI --> PrismaClient
    WebhookHandler --> PrismaClient

    QueueProducer --> RedisStore
    PrismaClient --> PostgresDB
    RateLimiter --> RedisStore
    QueueProducer -.-> SarvamAPI
    SarvamAPI -.->|Call status events| WebhookHandler
```

### Key Architectural Layers

1. **Multi-Tenancy**: Organizations encapsulate rate limits and users. Workspaces segment campaigns and contact cohorts.
2. **Campaign State Machine**: Supports `DRAFT`, `SCHEDULED`, `RUNNING`, `PAUSED`, `COMPLETED`, and `CANCELLED`.
3. **Contact Lifecycle Tracking**: Explicit states (`PENDING`, `QUEUED`, `IN_PROGRESS`, `COMPLETED`, `FAILED`, `DO_NOT_CALL`) with retry budgets and scheduled backoffs.
4. **Resilient Rate Limiting**: Distributed token bucket in Redis enforcing organization-level API request limits across workers and API handlers.
5. **Call Telemetry**: Each call attempt captures external provider identifiers, duration, transcripts, and outcome statuses.

---

## 4. Prerequisites

- **Node.js**: `v20.x` or higher
- **npm**: `v10.x` or higher
- **Docker & Docker Compose**: For local PostgreSQL and Redis containers

---

## 5. Environment Variable Setup

Copy `.env.example` to `.env`:

```bash
cp .env.example .env
```

### Configuration Variables

| Variable | Description | Default / Example |
| :--- | :--- | :--- |
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://postgres:postgres@localhost:5432/campaign_manager?schema=public` |
| `REDIS_URL` | Redis server connection URI | `redis://localhost:6379` |
| `SARVAM_API_KEY` | Sarvam AI outbound call API key | (Set prior to executing live outbound calls) |
| `SARVAM_API_BASE_URL` | Base URL for Sarvam API | `https://api.sarvam.ai` |
| `WEBHOOK_SECRET` | Secret token to verify webhook payloads | `local-dev-webhook-secret` |
| `NEXT_PUBLIC_APP_URL` | Base URL of Next.js application | `http://localhost:3000` |
| `PORT` | Local web server port | `3000` |

---

## 6. Docker Startup Instructions

To start PostgreSQL and Redis locally with persistent storage:

```bash
docker compose up -d
```

Verify service status and health checks:

```bash
docker compose ps
```

To stop containers:

```bash
docker compose down
```

To stop and remove persistent volumes:

```bash
docker compose down -v
```

---

## 7. Dependency Installation and Development Commands

### Install Dependencies
```bash
npm install
```

### Database Operations
```bash
# Validate Prisma schema
npm run db:validate

# Generate Prisma Client
npm run db:generate

# Push schema directly to database (development)
npm run db:push
```

### Quality & Build Checks
```bash
# Type check with strict TypeScript
npm run typecheck

# Lint with ESLint
npm run lint

# Compile production build
npm run build
```

### Start Development Server
```bash
npm run dev
```
Open [http://localhost:3000](http://localhost:3000) to view the Campaign Manager dashboard.

---

## 8. Current Implementation Status

- [x] **Project Scaffolding**: Next.js App Router, TypeScript strict mode, Tailwind CSS v4.
- [x] **Directory Structure**: Structured `src/app/`, `src/components/`, `src/lib/`, `src/lib/validations/`, `src/types/`, `prisma/`.
- [x] **Infrastructure Configuration**: Production-ready `docker-compose.yml` with health checks and persistent volumes for PostgreSQL and Redis.
- [x] **Database Schema**: Comprehensive Prisma schema modeling `Organization`, `Workspace`, `User`, `Role`, `Campaign`, `Contact`, and `CallAttempt`.
- [x] **Singletons & Queues**: Lazy-initialized Redis connection, BullMQ queue definitions, and Prisma client singleton.
- [x] **Validation Schemas**: Zod schemas for campaign configuration, allowed calling windows, CSV contact cohorts, and lifecycle transitions.
- [x] **Landing Dashboard UI**: Professional dashboard with navigation placeholders, responsive stats cards, and campaign empty-state.
- [x] **Quality Gate**: Verified `db:validate`, `typecheck`, `lint`, and `build` commands pass cleanly.

---

## 9. Known Limitations & Pending Work

1. **Authentication & Session Management**: Multi-tenancy models (`Organization`, `Workspace`, `User`) are implemented in Prisma, but session/auth middleware is deferred to subsequent steps.
2. **Sarvam API Contract Verification**: Live API calls and webhooks will be wired in following steps after validating Sarvam's exact API request/response specification.
3. **Background Worker Process**: BullMQ queue is defined; the active worker processor loop will be implemented in the campaign execution step.
4. **CSV Cohort Upload Route**: PapaParse and Zod schemas are established; the multipart file upload route and frontend drag-and-drop modal are pending implementation.
