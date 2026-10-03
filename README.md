# Fernleaf Kitchen Operations Admin Panel

This repository currently contains the platform foundation, staff identity modeling, backend-only staff authentication, and backend permission authorization. It is a small TypeScript monorepo with a Next.js frontend, a NestJS API, and Prisma configured for PostgreSQL.

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
npm run test:authorization --workspace=@fernleaf/api
npm run test:common --workspace=@fernleaf/api
npm run test:settings --workspace=@fernleaf/api
npm run test:reference-data --workspace=@fernleaf/api
```

## Backend authentication

Foundation Step 2B adds backend-only staff authentication. There is deliberately no frontend login page, frontend session state, or frontend route protection yet.

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

## Backend permission authorization

Foundation Step 2C adds reusable, backend-only permission authorization. It does not introduce a business module or any production business endpoint yet.

Use it on a future protected controller or handler with both guards and the permission decorator:

```ts
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PermissionCode.KITCHEN_UPDATE)
```

`JwtAuthGuard` authenticates the request and attaches the current `staffUser`. `PermissionsGuard` then reads the required permissions and queries the current role-permission mappings in PostgreSQL through `AuthorizationService`.

All declared permissions are required. Missing authentication returns `401`; an authenticated user without every required permission receives `403`. Permissions are deliberately not stored in JWTs, so a changed database mapping takes effect for an existing valid JWT on its next request.

Permission codes are defined once in `apps/api/src/authorization/permission-code.ts` and are also used by the idempotent Prisma seed. The focused integration suite validates the ADMIN, KITCHEN, and DRIVER mappings; authentication failures; all-permission semantics; and live database mapping changes.

## Common backend infrastructure

Foundation Step 3 adds small backend-only technical infrastructure for future feature modules. It does not add database models, business rules, or frontend features.

### Validation and errors

The NestJS application has one global `ValidationPipe` with `whitelist: true`, `forbidNonWhitelisted: true`, and `transform: true`. Future DTOs therefore reject unexpected fields and transform validated query/path values without each controller configuring its own pipe.

All thrown HTTP errors are normalized to this response shape:

```json
{
  "statusCode": 400,
  "code": "VALIDATION_ERROR",
  "message": "Some fields are invalid",
  "details": [{ "field": "pageSize", "message": "pageSize must not be greater than 100" }],
  "path": "/api/example",
  "timestamp": "2026-10-03T00:00:00.000Z"
}
```

The filter preserves `401` authentication and `403` authorization statuses, provides generic codes for future `404` and `409` cases, and returns a safe generic `500` message instead of stack traces or internal details.

### Money, time, and pagination conventions

- Final persisted monetary amounts use non-negative integer minor units: `1299` represents `$12.99`. Future derived-price calculations may use decimal arithmetic inside the Pricing module before resolving to integer minor units.
- `src/common/money/` provides validation, summing, multiplication, and `roundUpToNearestFiveCents`. It is not a pricing or tax engine.
- `src/common/time/` uses Luxon and accepts a caller-provided IANA timezone. It handles generic time mechanics only; kitchen dates, holidays, cutoffs, and configured kitchen timezones belong to future business modules.
- Pagination uses `page` (default `1`) and `pageSize` (default `25`, maximum `100`). The backend helper converts these to `skip` and `take`; page 2 with a page size of 25 is `skip: 25, take: 25`.
- The transport-only `PaginatedResponse<T>` contract is in `packages/contracts`. Feature modules must supply their own safe API item type rather than exposing Prisma types.

### Future concurrency convention

No generic lock manager, mutex, Redis lock, or concurrency framework exists. A future state transition that can race must use a database transaction when needed and an atomic/conditional update against its expected current state. If no row changes because another request already changed that state, the endpoint should return `409 CONFLICT`.

## Settings backend

The first business module stores the single kitchen-wide configuration and kitchen closure dates. It does not calculate actual order cutoff dates and does not provide a frontend Settings screen.

The idempotent seed creates the `GLOBAL` kitchen-settings record only when it does not already exist. Its defaults are `Asia/Kolkata`, Monday–Friday, a two-working-day cutoff count, and a `16:00` cutoff time. Re-running the seed deliberately preserves administrator changes. No fictional holidays are seeded.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/settings/kitchen` | `SETTINGS_READ` | Read current kitchen-wide configuration. |
| `PATCH` | `/api/settings/kitchen` | `SETTINGS_WRITE` | Update one or more settings fields. |
| `GET` | `/api/settings/kitchen/holidays` | `SETTINGS_READ` | List holidays by ascending date with standard pagination. |
| `POST` | `/api/settings/kitchen/holidays` | `SETTINGS_WRITE` | Add one kitchen closure date. |
| `DELETE` | `/api/settings/kitchen/holidays/:id` | `SETTINGS_WRITE` | Delete a closure date. |

The API exposes the cutoff as an `HH:mm` local kitchen time, such as `"16:00"`; internally it persists integer minutes from midnight (`960`). Working days use the fixed weekday values, must be non-empty and unique, and are normalized to Monday–Sunday order. The timezone is an IANA string validated through Luxon.

Kitchen holidays use PostgreSQL `DATE` values and the strict API format `YYYY-MM-DD`. Duplicate dates are protected by a database unique constraint and return `409 CONFLICT`; deleting an unknown holiday returns `404 NOT_FOUND`. A holiday on a normally non-working weekday is valid and remains useful as a named closure.

Future Orders code should consume read-only kitchen configuration through `SettingsService`, not through the Settings HTTP controller. The future Orders/CutoffCalculator owns the business calculation that combines a delivery date with working days, holidays, cutoff count, cutoff time, and timezone. Company calendars are a separate future Companies concern.

## Reference Data backend

Reference Data provides the canonical values that future Catalogue records will reference. It currently manages allergens, dietary tags, and kitchen stations; it is not the Catalogue and does not include Dish models or relationships.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/reference-data/allergens` | `CATALOGUE_READ` | List all allergens. |
| `POST` | `/api/reference-data/allergens` | `CATALOGUE_WRITE` | Create an allergen. |
| `PATCH` | `/api/reference-data/allergens/:id` | `CATALOGUE_WRITE` | Rename, deactivate, or reactivate an allergen. |
| `GET` | `/api/reference-data/dietary-tags` | `CATALOGUE_READ` | List all dietary tags. |
| `POST` | `/api/reference-data/dietary-tags` | `CATALOGUE_WRITE` | Create a dietary tag. |
| `PATCH` | `/api/reference-data/dietary-tags/:id` | `CATALOGUE_WRITE` | Rename, deactivate, or reactivate a dietary tag. |
| `GET` | `/api/reference-data/kitchen-stations` | `CATALOGUE_READ` | List all kitchen stations. |
| `POST` | `/api/reference-data/kitchen-stations` | `CATALOGUE_WRITE` | Create a kitchen station. |
| `PATCH` | `/api/reference-data/kitchen-stations/:id` | `CATALOGUE_WRITE` | Rename, deactivate, or reactivate a kitchen station. |

Reference names are trimmed and internal whitespace is collapsed, while their display capitalization is preserved. A private lowercase `normalizedName` field has a database unique constraint, so `Milk`, `milk`, and ` MILK ` cannot coexist. Duplicate create or rename attempts return `409 CONFLICT`; updating an unknown UUID returns `404 NOT_FOUND`.

There are no delete endpoints. Setting `isActive: false` preserves existing and future historical references while establishing the Catalogue contract that inactive values should not normally be selectable for new or updated dishes. Lists intentionally remain unpaginated because these lookup datasets are small; they return active and inactive records sorted by name.

The seed adds a small local/reviewer starter set: six allergens, four dietary tags, and four kitchen stations. It upserts by `normalizedName` with a no-op update, so repeated runs do not create duplicates or overwrite an existing matching record. It is not a production data-synchronization mechanism; a deliberate administrator rename can result in a baseline item being reintroduced if a developer reruns the seed.

## Environment variables

| File | Variable | Purpose |
| --- | --- | --- |
| `apps/api/.env` | `DATABASE_URL` | PostgreSQL connection string for Prisma. |
| `apps/api/.env` | `FRONTEND_URL` | Allowed frontend origin for API CORS. |
| `apps/api/.env` | `PORT` | API listening port. |
| `apps/api/.env` | `JWT_SECRET` | Backend-only signing secret for authentication JWTs. Never expose it to the frontend. |
| `apps/api/.env` | `JWT_EXPIRES_IN` | JWT and cookie duration, such as `8h`. |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL` | Public base URL for the NestJS API, including `/api`. |
