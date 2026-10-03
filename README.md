# Fernleaf Kitchen Operations Admin Panel

This repository currently contains the platform foundation, staff identity modeling, and backend-only staff authentication. It is a small TypeScript monorepo with a Next.js frontend, a NestJS API, and Prisma configured for PostgreSQL.

```text
Browser -> Next.js (apps/web) -> HTTP -> NestJS (apps/api) -> Prisma -> PostgreSQL
```

No customer-company, employee, catalogue, menu, order, kitchen, dispatch, or billing models exist yet. The API health endpoint intentionally checks only that the HTTP application is reachable; it does not depend on a database connection.

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

3. Set backend values in `apps/api/.env`:

   - `DATABASE_URL` for your PostgreSQL database.
   - `FRONTEND_URL` for the allowed browser origin.
   - a long, random `JWT_SECRET`.
   - `JWT_EXPIRES_IN`, such as `8h`.

4. Apply the existing identity migration and seed the local test staff users:

   ```bash
   DATABASE_URL="your-postgres-url" npx prisma migrate dev --schema apps/api/prisma/schema.prisma
   DATABASE_URL="your-postgres-url" npm run db:seed --workspace=@fernleaf/api
   ```

5. Start both applications:

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

## Backend authentication

Foundation Step 2B adds backend-only staff authentication. There is deliberately no frontend login page, frontend session state, frontend route protection, or permission-based authorization yet.

Authentication uses an HttpOnly cookie containing a short JWT payload:

```json
{ "sub": "staff-user-uuid" }
```

The API verifies the token and then loads the current staff user from PostgreSQL for every protected request. An inactive staff user is rejected immediately, even if their JWT has not expired.

| Method | Endpoint | Purpose |
| --- | --- | --- |
| `POST` | `/api/auth/login` | Validates active staff credentials and sets the `fernleaf_session` HttpOnly cookie. |
| `GET` | `/api/auth/me` | Returns the safe current staff identity when a valid cookie is present. |
| `POST` | `/api/auth/logout` | Clears the `fernleaf_session` cookie. |
| `GET` | `/api/health` | Confirms the HTTP API is reachable. |

Login accepts:

```json
{ "email": "admin@test.com", "password": "Test@1234" }
```

The idempotent seed also creates `kitchen@test.com`, `dispatch@test.com`, and `driver@test.com`, each with password `Test@1234`. These are required local/reviewer test accounts, not production credentials.

Authentication identifies the current staff user. Permission-based authorization is intentionally deferred to the next step; permissions are not stored in JWTs.

## Environment variables

| File | Variable | Purpose |
| --- | --- | --- |
| `apps/api/.env` | `DATABASE_URL` | PostgreSQL connection string for Prisma. |
| `apps/api/.env` | `FRONTEND_URL` | Allowed frontend origin for API CORS. |
| `apps/api/.env` | `PORT` | API listening port. |
| `apps/api/.env` | `JWT_SECRET` | Backend-only signing secret for authentication JWTs. Never expose it to the frontend. |
| `apps/api/.env` | `JWT_EXPIRES_IN` | JWT and cookie duration, such as `8h`. |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL` | Public base URL for the NestJS API, including `/api`. |
