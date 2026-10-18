# Contributing to FounderOS

Thanks for looking. FounderOS is small and opinionated: it ships one department at a time, and right now that department is Sales. Contributions that make the Sales agent more useful for a one-person company are the most welcome.

## Good first contributions

- Integrations that feed the pipeline without typing: Gmail or IMAP sync, calendar, Stripe.
- Better follow-up drafting: tone presets, multi-step sequences, reply detection.
- Tests. The pure rules in `artifacts/api-server/src/services/sales-rules.ts` are covered; the services around them are not.
- Deployment recipes: Fly, Railway, Render, Coolify, a Helm chart.

Please open an issue before starting anything that enables another department (Marketing, Operations, Strategy). Those are gated on purpose until Sales is proven.

## Setup

See the README for the five-minute setup. The short version:

```bash
pnpm install
cp .env.example .env     # add DATABASE_URL and one AI key
pnpm run db:push
pnpm run seed:demo
pnpm run dev:api         # terminal 1 (port 5001)
pnpm run dev:web         # terminal 2 (port 5000)
```

## Project layout

- `lib/api-spec/openapi.yaml` is the contract. Zod schemas and React Query hooks are generated from it with `pnpm --filter @workspace/api-spec run codegen`. Do not hand-edit `lib/api-zod/src/generated` or `lib/api-client-react/src/generated`.
- `lib/db/src/schema` holds the Drizzle schema. `pnpm run db:push` applies it.
- `artifacts/api-server/src/services` holds the engines. `sales-agent.ts` is the one that matters today.
- `artifacts/api-server/src/lib/ai` is the provider layer. Add a provider there, never call a vendor SDK from a service.
- `artifacts/founder-os/src/pages` is the React app. `sales.tsx` is the Sales Desk.

## Before you open a pull request

```bash
pnpm run typecheck
pnpm run test
```

Both must pass. Keep PRs focused on one change, describe what you verified by hand, and include a screenshot for UI changes.

## Conventions

- TypeScript everywhere, strict mode, no `any` in new code.
- Wrap Drizzle results with `toJson()` before passing them to generated Zod schemas.
- Every AI call must have a deterministic fallback. The app has to work with no provider configured.
- New environment variables go in `.env.example` with a one-line comment.

## Code of conduct

Be kind, assume good intent, and keep discussions about the work. Harassment of any kind is not tolerated.
