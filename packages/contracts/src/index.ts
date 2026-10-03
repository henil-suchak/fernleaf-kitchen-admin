/**
 * HTTP response shape for the API reachability endpoint.
 *
 * Keep this package limited to transport contracts and shared enums. It must
 * never expose persistence or Prisma-generated types to the frontend.
 */
export interface HealthResponse {
  status: 'ok';
}
