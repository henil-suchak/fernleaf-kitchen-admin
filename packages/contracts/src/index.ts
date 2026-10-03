/**
 * HTTP response shape for the API reachability endpoint.
 *
 * Keep this package limited to transport contracts and shared enums. It must
 * never expose persistence or Prisma-generated types to the frontend.
 */
export interface HealthResponse {
  status: 'ok';
}

/**
 * Generic, transport-only shape for a paginated API response.
 *
 * The item type is supplied by the owning feature contract. It must not be a
 * Prisma-generated persistence type.
 */
export interface PaginatedResponse<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}
