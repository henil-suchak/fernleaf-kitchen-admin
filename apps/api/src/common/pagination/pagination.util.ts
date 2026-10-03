import type { PaginatedResponse } from '@fernleaf/contracts';

import type { PaginationInput, PaginationOptions } from './pagination.types';

export function toPaginationOptions({
  page,
  pageSize,
}: PaginationInput): PaginationOptions {
  return {
    page,
    pageSize,
    skip: (page - 1) * pageSize,
    take: pageSize,
  };
}

export function createPaginatedResponse<T>(
  items: T[],
  total: number,
  { page, pageSize }: PaginationInput,
): PaginatedResponse<T> {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
