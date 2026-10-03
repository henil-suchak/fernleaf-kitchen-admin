# Fernleaf Kitchen Operations Admin Panel

Foundation Step 1 only: a small TypeScript monorepo with a Next.js frontend, a NestJS API, and Prisma configured for PostgreSQL.

```text
Browser -> Next.js (apps/web) -> HTTP -> NestJS (apps/api) -> Prisma -> PostgreSQL
```

No application or business-domain models are included yet. The API health endpoint intentionally checks only that the HTTP application is reachable; it does not depend on a database connection.

## Prerequisites

- Node.js 22 or newer
- npm 11 or newer
- PostgreSQL 16 or newer (or Docker)

## Setup

1. Install dependencies:

   ```bash
   npm install
   ```

2. Create local environment files:

   ```bash
   cp apps/api/.env.example apps/api/.env
   cp apps/web/.env.example apps/web/.env.local
   ```

3. Set `DATABASE_URL` in `apps/api/.env` to your PostgreSQL database.

4. Start both applications:

   ```bash
   npm run dev
   ```

   - Web: http://localhost:3000
   - API: http://localhost:3001/api/health

## Local PostgreSQL with Docker

If Docker is available, start the supplied local database:

```bash
docker compose up -d db
```

Then use the development connection string in `apps/api/.env.example` as the basis for `DATABASE_URL`.

When real Prisma models are added in a later step, generate the client with:

```bash
npm run db:generate --workspace=@fernleaf/api
```

## Checks

```bash
npm run lint
npm run typecheck
npm run build
```

## Environment variables

| File | Variable | Purpose |
| --- | --- | --- |
| `apps/api/.env` | `DATABASE_URL` | PostgreSQL connection string for Prisma. |
| `apps/api/.env` | `FRONTEND_URL` | Allowed frontend origin for API CORS. |
| `apps/api/.env` | `PORT` | API listening port. |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL` | Public base URL for the NestJS API, including `/api`. |
