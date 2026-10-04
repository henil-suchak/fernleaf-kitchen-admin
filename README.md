# Fernleaf Kitchen Operations Admin Panel

This repository currently contains the platform foundation, staff identity modeling, authentication and authorization, kitchen settings, reference data, Catalogue, Pricing, Companies, Employees, Menu, Orders, Kitchen, Dispatch, Billing, and Dashboard backends. It is a small TypeScript monorepo with a Next.js frontend, a NestJS API, and Prisma configured for PostgreSQL.

```text
Browser -> Next.js (apps/web) -> HTTP -> NestJS (apps/api) -> Prisma -> PostgreSQL
```

Portions do not exist yet. The Next.js frontend provides an authenticated operations workspace for the implemented backend modules. The API health endpoint intentionally checks only that the HTTP application is reachable; it does not depend on a database connection.

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
   - `SEED_STAFF_PASSWORD` only if you will run the intentional demo-data seed.

4. Apply the migrations and seed local test data:

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

   Open http://localhost:3000 and sign in with `admin@test.com` and the
   `SEED_STAFF_PASSWORD` you deliberately configured before seeding.

## Frontend workspace

The frontend uses the App Router and one small browser API client. It sends
requests to `NEXT_PUBLIC_API_URL` with `credentials: 'include'`; the API's
HttpOnly session cookie is never stored in browser storage. A `401` clears the
local session view and returns the user to `/login`.

The role supplied by `/api/auth/me` selects a useful workspace: Admin opens the
operations dashboard, Kitchen opens Kitchen, Dispatch opens Dispatch, and Driver
opens the compact `/driver` delivery view. Navigation is a convenience layer;
the NestJS permission checks remain the security boundary.

The admin workspace exposes real API-connected screens for dashboards,
reference data, catalogue, pricing matrices, Companies, Employees, Menu preview,
Orders, Kitchen, Dispatch, Billing, Settings, and Staff. Money is formatted
consistently as INR from integer minor units. Staff management reuses the existing
StaffUser, Role, Permission, and RolePermission model; it does not create a second
role system.

## Local PostgreSQL with Docker

If Docker is available, start the supplied local database:

```bash
docker compose up -d db
```

Then use the development connection string in `apps/api/.env.example` as the basis for `DATABASE_URL`.

After a Prisma schema change, generate the client with:

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
npm run test:catalogue --workspace=@fernleaf/api
npm run test:pricing --workspace=@fernleaf/api
npm run test:companies --workspace=@fernleaf/api
npm run test:employees --workspace=@fernleaf/api
npm run test:menu --workspace=@fernleaf/api
npm run test:orders --workspace=@fernleaf/api
npm run test:kitchen --workspace=@fernleaf/api
npm run test:dispatch --workspace=@fernleaf/api
npm run test:billing --workspace=@fernleaf/api
npm run test:dashboard --workspace=@fernleaf/api
```

## Production deployment

Deploy the Next.js workspace to Vercel, the NestJS workspace to Render, and use
a managed PostgreSQL database. The frontend and API URLs are configuration, not
source-code constants.

On Render, set `NODE_ENV=production`, configure the backend variables below,
and use the repository root as the build context:

```bash
npm ci
npm run db:generate --workspace=@fernleaf/api
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run build --workspace=@fernleaf/api
npm run start --workspace=@fernleaf/api
```

`prisma migrate deploy` is the production migration command. Do not use
`prisma migrate dev` in production. Run the following separate, intentional
operation only when the reviewer/demo seed data is wanted; the application
never seeds automatically at startup:

```bash
npm run db:seed --workspace=@fernleaf/api
```

On Vercel, configure `NEXT_PUBLIC_API_URL` with the public Render API URL
including `/api` before building. A suitable build command is:

```bash
npm ci
npm run build --workspace=@fernleaf/web
```

In production the API sets the HttpOnly session cookie with `Secure` and
`SameSite=None` so a Vercel frontend can call a Render API on another origin.
`FRONTEND_URL` is an exact HTTPS CORS allowlist in production (one or more comma-separated origins),
credentials are enabled, and authenticated mutation requests must carry an
allowed `Origin`. This is the assignment's lightweight CSRF control. Browsers
or privacy extensions that block third-party cookies can still prevent a
cross-site Vercel/Render session from working; a same-site custom-domain setup
is the more reliable production topology.

## Backend authentication

Foundation Step 2B adds the staff authentication API. The frontend now uses it for its login screen, session bootstrap, role-aware navigation, and logout flow; authorization remains enforced by the API.

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
{ "email": "admin@test.com", "password": "your-seed-staff-password" }
```

The idempotent seed also creates `kitchen@test.com`, `dispatch@test.com`, and `driver@test.com`. All seeded reviewer accounts receive the value supplied through `SEED_STAFF_PASSWORD`; it is never stored in the repository. These accounts are intentional demo data, so use a unique deployment secret and rotate or deactivate them outside reviewer deployments.

## Staff management

Administrators can list Staff Users and roles, create Staff Users with a bcrypt-hashed
password, change a role, and activate or deactivate an account. Password hashes are
never returned. Every endpoint requires `STAFF_MANAGE`; the frontend hides the Staff
navigation item for other roles, but the API is the enforcement boundary. The final
active Administrator cannot be deactivated or moved to a non-Admin role.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/staff` | `STAFF_MANAGE` | List safe Staff User summaries. |
| `GET` | `/api/staff/roles` | `STAFF_MANAGE` | List assignable existing roles. |
| `POST` | `/api/staff` | `STAFF_MANAGE` | Create a Staff User with a bcrypt-hashed password. |
| `PATCH` | `/api/staff/:id` | `STAFF_MANAGE` | Change role and/or active status. |

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

Foundation Step 3 adds small technical infrastructure used by the feature modules. It does not add database models or business rules itself; the frontend consumes the later feature APIs through the shared browser client.

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

The first business module stores the single kitchen-wide configuration and kitchen closure dates. It does not calculate actual order cutoff dates. The frontend Settings screen manages the supported kitchen settings and closure dates.

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

Reference Data provides the canonical values used by Catalogue records. It manages allergens, dietary tags, and kitchen stations; it remains a small lookup-data module rather than owning dishes or catalogue configuration.

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

There are no delete endpoints. Setting `isActive: false` preserves historical references while preventing the value from being selected for new or updated dishes. Lists intentionally remain unpaginated because these lookup datasets are small; they return active and inactive records sorted by name.

The seed adds a small local/reviewer starter set: six allergens, four dietary tags, and four kitchen stations. It upserts by `normalizedName` with a no-op update, so repeated runs do not create duplicates or overwrite an existing matching record. It is not a production data-synchronization mechanism; a deliberate administrator rename can result in a baseline item being reintroduced if a developer reruns the seed.

## Catalogue backend

Catalogue defines reusable dishes and their selectable configuration. It deliberately does **not** define customer-facing prices: `Dish.costMinorUnits` and `Option.costMinorUnits` are internal, non-negative integer-minor-unit costs only. Pricing tiers are configured separately; Menu, Orders, Kitchen, Dispatch, Billing, and their frontend workflows use these records without redefining the catalogue model.

The relational model is explicit so that options and groups can be reused without JSON arrays:

```text
Dish --< DishOptionGroup >-- OptionGroup --< OptionGroupOption >-- Option
  |                                  |
  |--< DishAllergen >-- Allergen      |
  `--< DishDietaryTag >-- DietaryTag  |
  `--------------> KitchenStation (zero or one)
```

`DishOptionGroup` stores the relationship-specific `isRequired` flag and `sortOrder`. A required group means a future order combination must select exactly one option; an optional group means it may select zero or one. This module only stores that configuration—future Orders code will enforce selection rules.

`OptionGroupOption` stores ordered option membership. Both join tables have composite primary keys to prevent duplicate memberships, plus a database unique constraint on their parent and `sortOrder`. The API uses one-based order values (`1`, `2`, …) because the project has no existing zero-based ordering convention.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/catalogue/dishes?page=1&pageSize=25&search=&isActive=true` | `CATALOGUE_READ` | Paginated dish list with optional case-insensitive name/SKU search and active filter. |
| `GET` | `/api/catalogue/dishes/:id` | `CATALOGUE_READ` | Read the dish aggregate, including reference data and ordered group/option configuration. |
| `POST` | `/api/catalogue/dishes` | `CATALOGUE_WRITE` | Create a dish and optionally set its station, allergens, and dietary tags. |
| `PATCH` | `/api/catalogue/dishes/:id` | `CATALOGUE_WRITE` | Update dish fields; supplied allergen/tag lists replace the corresponding full membership. |
| `PUT` | `/api/catalogue/dishes/:id/option-groups` | `CATALOGUE_WRITE` | Atomically replace the dish’s full ordered option-group configuration. |
| `GET` | `/api/catalogue/options` | `CATALOGUE_READ` | List reusable options, including inactive values. |
| `POST` | `/api/catalogue/options` | `CATALOGUE_WRITE` | Create an option. |
| `PATCH` | `/api/catalogue/options/:id` | `CATALOGUE_WRITE` | Rename, deactivate, or reactivate an option. |
| `GET` | `/api/catalogue/option-groups` | `CATALOGUE_READ` | List reusable option groups, including inactive values. |
| `GET` | `/api/catalogue/option-groups/:id` | `CATALOGUE_READ` | Read a group and its ordered options. |
| `POST` | `/api/catalogue/option-groups` | `CATALOGUE_WRITE` | Create an option group. |
| `PATCH` | `/api/catalogue/option-groups/:id` | `CATALOGUE_WRITE` | Rename, deactivate, or reactivate an option group. |
| `PUT` | `/api/catalogue/option-groups/:id/options` | `CATALOGUE_WRITE` | Atomically replace the group’s full ordered option membership. |

Dish reference data follows API approach A: `kitchenStationId`, `allergenIds`, and `dietaryTagIds` belong in the create/update payload. When a list is supplied to `PATCH`, it replaces that complete relationship list; omitting it leaves the existing list unchanged. A new or changed station, allergen, dietary tag, option group, or option must exist and be active. Existing relationships remain readable after a referenced value is deactivated.

Names for Options and OptionGroups are trimmed, internal whitespace is collapsed, and a lowercase `normalizedName` is uniquely stored. Dish SKUs are trimmed and stored in uppercase, so `PPB-001` and `ppb-001` conflict under the database’s unique SKU constraint. Dishes, Options, and OptionGroups use soft deactivation only; there are no delete endpoints.

Multi-table operations run in Prisma transactions: dish creation/update with allergen and dietary-tag rows, replacing a group’s options, and replacing a dish’s groups. Input duplicates are rejected before writes, and database constraints remain the final concurrency protection. Unique conflicts return `409 CONFLICT`; missing records return `404 NOT_FOUND`; assigning an inactive value returns the project’s `400 BUSINESS_RULE_VIOLATION` response.

The idempotent local seed adds two dishes (`Paneer Power Bowl` and `Paneer Garden Salad`), seven options with their internal costs/reference data, three option groups, their ordered join rows, and reference-data links. Every matching seed upsert uses a no-op update: rerunning it creates only missing baseline records and does not overwrite matching administrator changes.

## Pricing backend

Pricing assigns prices to catalogue Dishes and Options. Companies may reference an active tier, but the module does not calculate tax. The frontend provides pricing-tier and matrix screens for the implemented API operations.

A tier has no persisted direct/derived mode. Its behavior is inferred from `derivationSource`:

- No derivation source: prices are entered explicitly for Dishes and Options.
- `BASE_TIER`: prices are calculated from an active, manually priced base tier.
- `ITEM_COST`: prices are calculated from the item’s internal cost.

An item-level explicit price takes precedence as a manual override. A default tier must be active and manually priced. The seed creates `Standard` as the default manually priced tier and `Premium` as a `BASE_TIER` tier at `11500` basis points (1.15×).

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/pricing/tiers` | `PRICING_READ` | List tiers and configuration. |
| `GET` | `/api/pricing/tiers/:id` | `PRICING_READ` | Read one tier. |
| `POST` | `/api/pricing/tiers` | `PRICING_WRITE` | Create a tier. |
| `PATCH` | `/api/pricing/tiers/:id` | `PRICING_WRITE` | Update tier configuration, activity, or default status. |
| `PUT` | `/api/pricing/tiers/:id/dish-prices` | `PRICING_WRITE` | Atomically upsert/delete explicit Dish prices. |
| `PUT` | `/api/pricing/tiers/:id/option-prices` | `PRICING_WRITE` | Atomically upsert/delete explicit Option prices. |
| `GET` | `/api/pricing/tiers/:id/matrix` | `PRICING_READ` | Read active Dish/Option resolved prices and availability. |

## Companies backend

Companies are corporate customers with delivery defaults, addresses, allowed email domains, delivery calendars, an optional active PricingTier, and an optional internal default driver. Company names are deliberately not unique: canonical lowercase email domains are the globally unique business identity.

Company creation is atomic and requires at least one valid domain and one active delivery address. Domains reject URLs, paths, email addresses, wildcards, and a deliberately small blocklist of public domains. Domain replacement is also atomic and always requires at least one domain.

Addresses are soft-deactivated because future Orders will need historical delivery context. An active Company must retain at least one active address. Company working days and holidays only determine whether that Company may receive a delivery; they never modify Kitchen Settings or cutoff calculation.

Delivery time is stored as integer minutes since midnight and exposed as strict `HH:mm`. Packaging is a validated administrator-provided operational string; there is no Packaging table. A default driver must be an active StaffUser with both delivery-own permissions, which is domain validation rather than request authorization.

Any active PricingTier, including a derived tier, can be assigned to a Company. Pricing refuses to deactivate a tier while an active Company references it. A Company now has an optional `ownerEmployeeId` foreign key. Owner assignment is handled through the existing Company `PATCH` endpoint because the Company owns that relationship.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/companies` | `COMPANY_READ` | Paginated Company summaries with search and active filter. |
| `GET` | `/api/companies/:id` | `COMPANY_READ` | Company details, domains, addresses, holidays, tier, and driver summary. |
| `POST` | `/api/companies` | `COMPANY_WRITE` | Atomically create a usable Company. |
| `PATCH` | `/api/companies/:id` | `COMPANY_WRITE` | Update Company fields and assignments. |
| `PUT` | `/api/companies/:id/domains` | `COMPANY_WRITE` | Atomically replace the complete domain set. |
| `POST` | `/api/companies/:id/addresses` | `COMPANY_WRITE` | Add an address. |
| `PATCH` | `/api/companies/:id/addresses/:addressId` | `COMPANY_WRITE` | Update or soft-deactivate an address. |
| `GET` | `/api/companies/:id/holidays` | `COMPANY_READ` | List Company holidays. |
| `POST` | `/api/companies/:id/holidays` | `COMPANY_WRITE` | Add a delivery-blocking holiday. |
| `DELETE` | `/api/companies/:id/holidays/:holidayId` | `COMPANY_WRITE` | Remove a holiday. |

The idempotent seed adds Acme Technologies and Northstar Consulting with distinct domains, active addresses, Monday–Friday defaults, delivery details, PricingTier assignments, a default driver, and seeded Employees with owners.

## Employees backend

Employees are people at a Company who can later place or manage meal orders. They are not `StaffUser` accounts and cannot authenticate to the admin API. This module intentionally stores one required full `name` field rather than prematurely inventing first/middle/last-name rules.

An Employee belongs to exactly one Company. The database stores the trimmed, lowercase email directly in `Employee.email` and enforces `@@unique([companyId, email])`: the same email may exist at different Companies but not twice within one Company. The API does not apply an email-domain-to-Company rule because that would make an Employee's identity depend on a mutable Company-domain setting.

Employees can optionally record a phone number and three self-service preferences: `canChooseDeliveryAddress`, `canChangeDeliveryTime`, and `canChangePackaging`. All flags default to `false`. Allergens and dietary tags use explicit join tables (`EmployeeAllergen` and `EmployeeDietaryTag`) rather than JSON arrays, so their foreign keys protect data integrity and future queries remain straightforward.

New Employees, moves, reactivations, and new preference assignments require active referenced records. Existing Employee details remain readable after their Company, allergen, or dietary tag becomes inactive, preserving historical context. A supplied `allergenIds` or `dietaryTagIds` array replaces that complete membership; omitting it leaves the corresponding membership unchanged.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/employees` | `EMPLOYEE_READ` | Paginated Employee summaries with optional name/email search, Company, and active filters. |
| `GET` | `/api/employees/:id` | `EMPLOYEE_READ` | Employee details, including preferences and active/inactive reference visibility. |
| `POST` | `/api/employees` | `EMPLOYEE_WRITE` | Create an Employee at an active Company. |
| `PATCH` | `/api/employees/:id` | `EMPLOYEE_WRITE` | Update Employee fields, replace supplied preferences, move, activate, or deactivate. |
| `PATCH` | `/api/companies/:id` | `COMPANY_WRITE` | Assign or replace the optional `ownerEmployeeId` for that Company. |

Company ownership is a guarded compatibility rule: an owner must be active, belong to that same active Company, and may not own another Company. An existing owner must be replaced rather than cleared. The current owner cannot be moved or deactivated until reassigned. Simple Employee create/update work uses normal Prisma transactions; the ownership-sensitive move, deactivation, and owner-assignment paths use serializable transactions because they can race with ownership changes.

The idempotent local seed creates two Employees for Acme Technologies and two for Northstar Consulting, gives each Company an owner only when no owner exists, and upserts their baseline reference memberships. Re-running it does not update matching Employee scalar data or ownership; it does add any missing baseline membership rows. CSV import and portions are intentionally not implemented.

## Menu backend

Menu controls which Catalogue Dishes are exposed to an Employee; it does not copy Dish data or persist selling prices. Catalogue owns what exists, Pricing owns what it costs, Menu owns category placement and visibility, and future Orders will own what was purchased.

Menu Categories are globally ordered, may be active/inactive, and may be secret. A secret category is omitted from the normal preview but can be directly previewed when it is active, not hidden for the Employee's Company, and still contains orderable items. A Dish may appear in multiple Categories through `MenuCategoryItem`; Company item hiding applies to that placement rather than globally hiding the Dish.

Employee allergen and dietary-preference records are informational only and do not automatically filter the Menu. There is no date-based, seasonal, or scheduled Menu behavior.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/menu/categories` | `MENU_READ` | List Menu configuration. |
| `GET` | `/api/menu/categories/:id` | `MENU_READ` | Read one Category and placements. |
| `POST` / `PATCH` | `/api/menu/categories` | `MENU_WRITE` | Create or update Category configuration. |
| `POST` | `/api/menu/categories/:id/items` | `MENU_WRITE` | Place an existing Dish in a Category. |
| `PATCH` | `/api/menu/categories/:categoryId/items/:itemId` | `MENU_WRITE` | Update placement order or activity. |
| `PUT` | `/api/companies/:id/menu-hiding` | `MENU_WRITE` | Atomically replace Company category/item hiding. |
| `GET` | `/api/menu/preview/employees/:employeeId` | `MENU_READ` | Preview the normal Employee Menu. |
| `GET` | `/api/menu/preview/employees/:employeeId/categories/:categoryId` | `MENU_READ` | Preview one Category, including a secret Category. |

Preview dynamically uses the Employee's Company tier or the active default tier through PricingResolver. Unpriced Dishes and Options are hidden; a Dish is hidden when a required OptionGroup has no active, priced Option. Future Orders will validate a Dish through Menu availability but will not persist Menu placement identity or let later Menu changes rewrite historical orders.

## Orders backend

Orders owns the immutable commercial record of what an Employee ordered for the Company that employed them at the time. It uses five models only: `Order`, `OrderLine`, `OrderCombination`, `OrderCombinationOption`, and `OrderStatusEvent`.

An Order stores both `employeeId` and `companyId`; this is intentional historical denormalization because an Employee may later move Company. It snapshots the effective PricingTier identity/name, resolved selling prices, Dish/Option names, delivery address, delivery defaults, kitchen routing, and cutoff instant. It never recalculates historical money or names from current Catalogue, Pricing, Company, or Kitchen Settings data.

In the frontend Order editor, selecting an Employee loads that Employee's Company and
prefills the Company's active delivery address, default delivery time, and packaging.
The editor only enables each delivery-logistics field when the existing Employee
capability permits it; the API remains the authoritative validation and persists the
resulting values as the Order's historical snapshot. The screen also shows the derived
kitchen-ready and dispatch-ready planning times without changing the server-side
cutoff or planning rules.

Each Order line represents one Dish. Its combinations represent distinct selected OptionGroup/Option pairs, and their quantities must sum to the line quantity. `selectionKey` uses sorted `optionGroupId:optionId` pairs, so duplicate preparation configurations cannot be persisted. Historical selections reference OptionGroup and Option individually, but deliberately do not reference mutable `OptionGroupOption` membership rows.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/orders` | `ORDER_CREATE` | Create a fully valid Draft Order. |
| `GET` | `/api/orders` | `ORDER_READ` | Paginated Order list with delivery, status, Company, and search filters. |
| `GET` | `/api/orders/:id` | `ORDER_READ` | Read full historical Order detail and lifecycle timeline. |
| `PUT` | `/api/orders/:id` | `ORDER_EDIT` | Edit Draft/Placed content before cutoff. Food replacement reprices submitted food only. |
| `POST` | `/api/orders/:id/place` | `ORDER_EDIT` | Transition Draft to Placed before cutoff. |
| `POST` | `/api/orders/:id/cancel` | `ORDER_EDIT` or `ORDER_OVERRIDE` | Cancel under the lifecycle rules. |
| `PATCH` | `/api/orders/:id/delivery` | `ORDER_OVERRIDE` | Change confirmed delivery address/time/packaging only. |
| `POST` | `/api/orders/cutoff/process` | `ORDER_OVERRIDE` | Idempotently cancel Drafts and confirm Placed Orders after their persisted cutoff. |

Normal staff can cancel Draft/Placed Orders before cutoff. A user with `ORDER_OVERRIDE` can cancel eligible Draft/Placed Orders after cutoff and Confirmed Orders; Delivered, Cancelled, and Rejected Orders cannot be cancelled. Every state transition writes an `OrderStatusEvent`.

The idempotent Prisma seed creates deterministic UUID-backed examples for Draft, Placed, Confirmed, Delivered, Cancelled, and Rejected Orders using dates relative to the configured Kitchen timezone. It does not overwrite an existing seeded Order.

## Kitchen backend

Kitchen executes the food preparation of confirmed Orders. It does not create a second kitchen-task model: one immutable `OrderCombination` is exactly one prep unit, so Kitchen writes only `kitchenStartedAt` and `kitchenCompletedAt` on that existing record. This keeps the work identity tied to the historical Dish, station, selected Options, and quantity already snapshotted by Orders.

Timestamp state is intentionally minimal:

- neither timestamp: not started;
- `kitchenStartedAt` only: started;
- both timestamps: completed.

Completing an unstarted prep unit sets both timestamps to the same instant. Repeating start or completion returns `409 CONFLICT`. `ORDER_OVERRIDE` may force-complete all unfinished units on a Confirmed Order; completed units retain their original timestamps, so a repeated force-complete is a safe no-op for them.

There is no duplicated Order-level Kitchen state. The API derives an Order’s kitchen start as the earliest prep-unit start, and its kitchen ready time only when every prep unit is completed (the latest completion time). The Kitchen board uses the Order’s immutable delivery snapshot plus `KitchenSettings.timezone` to derive these non-persisted plan values:

```text
plannedDeliveryAt       = deliveryDate + deliveryTimeMinutes in Kitchen timezone
plannedDispatchReadyAt  = plannedDeliveryAt - deliveryMinutesBeforeSnapshot
plannedKitchenReadyAt   = plannedDispatchReadyAt - 30 minutes
```

The board calculates `late` when an Order is not kitchen-ready and the current instant is past `plannedKitchenReadyAt`. It calculates `atRisk` during the documented 30-minute interval before that plan time, while the Order is still not kitchen-ready. Because these values are derived, an authorized confirmed-Order delivery-time override automatically updates the plan without a stale cached timestamp.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/kitchen/board?deliveryDate=YYYY-MM-DD&stationId=` | `KITCHEN_READ` | Show Confirmed Order prep units, optionally for one snapshotted station. |
| `POST` | `/api/kitchen/units/:combinationId/start` | `KITCHEN_UPDATE` | Start one prep unit once. |
| `POST` | `/api/kitchen/units/:combinationId/complete` | `KITCHEN_UPDATE` | Complete one prep unit once. |
| `POST` | `/api/kitchen/orders/:orderId/force-complete` | `ORDER_OVERRIDE` | Complete every unfinished prep unit of a Confirmed Order. |

The seed supplies three operational Confirmed Orders for the current Kitchen-local date: completed, started, and not started. These deterministic fixtures are refreshed to that date when the seed runs, so `driver@test.com` and the Kitchen/Dispatch boards remain demonstrable after repeated local setup.

## Dispatch backend

Dispatch manages the physical delivery aggregate, `DispatchDrop`. An Order belongs to at most one current Drop through nullable `Order.dispatchDropId`; there is no unnecessary join table. A Confirmed Order is attached idempotently when cutoff processing confirms it, and the Dispatch board also performs the same idempotent sync for Confirmed Orders on its requested date.

The deterministic Drop grouping key is a SHA-256 hash of normalized (trimmed, collapsed whitespace, lowercase) snapshots of:

```text
Order.companyId + deliveryDate + exact deliveryTimeMinutes +
delivery address label + line 1 + line 2 + city + state/region + postal code + country
```

It deliberately uses the original Company and Order’s full historical delivery snapshot—not a mutable CompanyAddress record or current Company defaults. The lifecycle is one-way:

```text
WAITING_KITCHEN -> DISPATCH_READY -> OUT_FOR_DELIVERY -> DELIVERED
```

Dispatch readiness requires at least one member, every member still `CONFIRMED`, and every prep unit completed. Departure additionally requires an assigned, active StaffUser who currently has both delivery-own permissions. A Company’s default driver is assigned only when a Drop is first created and only if that same permission-based validity check succeeds; no role-code check is used.

Dispatch can also list active Staff Users who hold both delivery-own permissions and
select any of them for a Drop. The Company default driver is shown as the initial
selection where present; the existing assignment endpoint revalidates capability
server-side before persisting the choice.

The driver’s own endpoints always require delivery-own permissions. Delivery additionally confirms that the authenticated StaffUser is the Drop’s assigned driver. In the same serializable transaction, delivery records optional note/photo data, calculates `wasOnTime` from the configured Kitchen timezone and exact delivery time, transitions every member Order from `CONFIRMED` to `DELIVERED`, and creates one `OrderStatusEvent` per successful Order transition.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/dispatch/board?deliveryDate=YYYY-MM-DD` | `DISPATCH_READ` | List grouped Drops for a delivery date. |
| `GET` | `/api/dispatch/drivers` | `DISPATCH_READ` | List active Staff Users with delivery capability. |
| `PATCH` | `/api/dispatch/drops/:id/driver` | `DISPATCH_UPDATE` | Assign an active delivery-capable driver before departure. |
| `POST` | `/api/dispatch/drops/:id/dispatch-ready` | `DISPATCH_UPDATE` | Advance a kitchen-ready Drop once. |
| `POST` | `/api/dispatch/drops/:id/out-for-delivery` | `DISPATCH_UPDATE` | Mark a dispatch-ready, assigned Drop as departed. |
| `GET` | `/api/driver/drops/today` | `DELIVERY_OWN_READ` | Show only the current driver’s Drops for today in Kitchen timezone. |
| `POST` | `/api/driver/drops/:id/deliver` | `DELIVERY_OWN_UPDATE` | Let only the assigned driver complete a departed Drop. |

An `ORDER_OVERRIDE` delivery address or time change before departure detaches and regroupes the Confirmed Order in the same transaction. Packaging-only changes do not regroup. Address/time changes and Confirmed cancellation are rejected once the Drop is out for delivery; before departure, cancellation detaches the Order and removes an empty non-departed Drop. This prevents a Drop’s grouping key from ever disagreeing with its remaining Order snapshots.

## Billing backend

Billing creates internal Company Invoices from historical Order snapshots. An `Invoice` belongs to one original Company, and an `Order` has at most one nullable `invoiceId`; no `InvoiceOrder` join table is needed. Invoice creation accepts only unique Orders from the requested Company that are still `CONFIRMED` or already `DELIVERED`, and calculates `totalMinorUnits` as the exact integer sum of their stored Order totals.

An Invoice is a frozen financial snapshot. Its total and attached Order membership never automatically change after creation. An otherwise-authorized Confirmed Order cancellation remains allowed even when invoiced; the Invoice keeps the originally invoiced amount and relation. Later delivery address/time changes likewise do not recalculate the Invoice. A short delivery creates no automatic adjustment. Refunds, credit notes, tax, external accounting, Invoice adjustments, and Invoice voiding are deliberately out of scope.

Invoices have only `OPEN` and terminal `PAID` states. Marking an Open Invoice paid records `paidAt`; repeated payment returns `409 CONFLICT`.

| Method | Endpoint | Permission | Purpose |
| --- | --- | --- | --- |
| `GET` | `/api/billing/companies/:companyId/uninvoiced-orders` | `BILLING_READ` | Paginated billable Orders for one Company with no Invoice. |
| `POST` | `/api/billing/invoices` | `BILLING_WRITE` | Create one Open Invoice from same-Company Orders. |
| `GET` | `/api/billing/invoices` | `BILLING_READ` | Paginated Invoices, optionally by Company or status. |
| `GET` | `/api/billing/invoices/:id` | `BILLING_READ` | Read an Invoice and its historical Orders. |
| `POST` | `/api/billing/invoices/:id/paid` | `BILLING_WRITE` | Mark an Open Invoice paid once. |

Creation runs in a serializable transaction: it validates non-empty unique IDs, loads every selected Order, verifies Company/status/uninvoiced eligibility, creates the frozen Invoice total, conditionally attaches every Order with `invoiceId = null`, and verifies that every attachment succeeded. A concurrent Invoice or Order mutation therefore rolls back and returns `409 CONFLICT`.

The seed creates one Open Invoice for a seeded Confirmed Order and one Paid Invoice for a seeded Delivered Order. The current Kitchen/Dispatch Orders remain uninvoiced and demonstrable.

## Dashboard backend

Dashboards are read-only derived views. `DashboardModule` adds no database models, snapshots, metrics tables, events, or analytics persistence. Every dashboard determines “today” from `KitchenSettings.timezone`; Cancelled and Rejected Orders never increase billable or operational metrics.

| Endpoint | Permission | Contents |
| --- | --- | --- |
| `GET /api/dashboard/admin` | `ORDER_READ`, `KITCHEN_READ`, `DISPATCH_READ`, `BILLING_READ` | Today’s commercial Order counts, confirmed value, uninvoiced value, Kitchen risk, and Drop status summary. |
| `GET /api/dashboard/kitchen` | `KITCHEN_READ` | Today’s Confirmed prep-unit state counts, snapshot station breakdown, and Kitchen risk. |
| `GET /api/dashboard/dispatch` | `DISPATCH_READ` | Today’s operational Drop counts, unassigned drivers, delivery risk, and overdue Drops. |
| `GET /api/dashboard/driver` | `DELIVERY_OWN_READ` | Only the authenticated Driver’s today Drops, next Drop, remaining work, delivered count, and on-time count. |

`todayConfirmedOrderValue` is the integer sum of today’s `CONFIRMED` and `DELIVERED` Order snapshots regardless of Invoice membership. `todayUninvoicedBillableValue` uses the same statuses/date with `invoiceId = null`. Kitchen late/at-risk calculations reuse the existing Order planning and Kitchen-risk utilities. Dispatch delivery risk is active, non-Delivered work within 30 minutes of its planned delivery instant; overdue active work is past that instant.

## Environment variables

| File | Variable | Purpose |
| --- | --- | --- |
| `apps/api/.env` | `DATABASE_URL` | PostgreSQL connection string for Prisma. |
| `apps/api/.env` | `NODE_ENV` | `development`, `test`, or `production`; production enables cross-site secure cookies. |
| `apps/api/.env` | `FRONTEND_URL` | One or more exact comma-separated frontend origins allowed by CORS. |
| `apps/api/.env` | `PORT` | API listening port. |
| `apps/api/.env` | `JWT_SECRET` | Backend-only signing secret for authentication JWTs. It must be a non-placeholder value of at least 32 characters in production; never expose it to the frontend. |
| `apps/api/.env` | `JWT_EXPIRES_IN` | JWT and cookie duration, such as `8h`. |
| `apps/api/.env` | `SEED_STAFF_PASSWORD` | Required only by the intentional seed command; sets the seeded reviewer-account password and must never be committed. |
| `apps/web/.env.local` | `NEXT_PUBLIC_API_URL` | Public base URL for the NestJS API, including `/api`. |
