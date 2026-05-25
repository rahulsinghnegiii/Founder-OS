# FounderOS

An AI-native operating system for founders — a dark, immersive command center with multi-agent orchestration, CRM, project management, revenue tracking, and real-time intelligence.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5 (port 8080, proxied at `/api`)
- Frontend: React + Vite + Tailwind + shadcn/ui + Framer Motion (port 19291, proxied at `/`)
- DB: PostgreSQL + Drizzle ORM
- Routing: wouter (client-side)
- Charts: Recharts
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle for API)

## Where things live

- `lib/api-spec/openapi.yaml` — source of truth for all API contracts (50+ endpoints)
- `lib/db/src/schema/` — 16 Drizzle schema files (departments, agents, projects, tasks, leads, etc.)
- `lib/api-zod/src/generated/` — generated Zod schemas (do not edit manually)
- `lib/api-client-react/src/generated/` — generated React Query hooks (do not edit manually)
- `artifacts/api-server/src/routes/` — all Express route handlers
- `artifacts/api-server/src/lib/serialize.ts` — `toJson()` helper for Drizzle → Zod serialization
- `artifacts/founder-os/src/` — React frontend
- `artifacts/founder-os/src/components/layout.tsx` — app shell with sidebar + notifications
- `artifacts/founder-os/src/App.tsx` — wouter router with all page routes

## Architecture decisions

- Contract-first API: OpenAPI spec is written first, Zod schemas and React Query hooks are generated from it via Orval
- `toJson()` wrapper required on all Drizzle query results before passing to Zod `.parse()` — Drizzle returns `Date` objects but generated Zod schemas expect ISO strings
- `numeric` DB columns (revenue amounts) stored as strings in Postgres; converted to `Number()` in route handlers before sending to clients
- `$defaultFn(() => crypto.randomUUID())` used for all primary keys (text UUIDs)
- No auth yet — single-founder mode; all data is global

## Product

- **Command Center (Dashboard)** — live metrics, AI daily briefing, activity feed
- **Projects** — manage initiatives with status, priority, task counts
- **Tasks** — cross-project task board with priorities and due dates
- **Leads / Pipeline** — kanban CRM with scoring, estimated value, and pipeline stages
- **AI Agents** — 5 named autonomous agents (Sales, Growth, Build Ops, Ops, Finance) with capabilities and status
- **Workflows** — automation builder with trigger events and step definitions
- **Revenue** — financial tracking with received/invoiced/projected breakdown and monthly trend chart
- **Reports** — AI-generated operational, revenue and briefing reports
- **Activity Log** — full audit trail of all entity changes

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

- Always wrap Drizzle query results with `toJson()` before calling any Zod `.parse()` — Date objects from Drizzle fail Zod string validation
- Task status enum: `todo | in_progress | review | done | cancelled` (NOT `in_review`)
- Revenue `amount` column is Drizzle `numeric` — store as `String()`, read as `Number()`
- Agent POST/PATCH handlers use inline Zod schemas (not generated) since agents write operations weren't in the original OpenAPI spec
- `pnpm --filter @workspace/api-server run build` requires the workflow env vars (`PORT`, `BASE_PATH`) but works fine from bash because esbuild bundles everything

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
