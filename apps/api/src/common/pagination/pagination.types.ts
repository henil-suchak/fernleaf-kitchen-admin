export interface PaginationInput {
  page: number;
  pageSize: number;
}

export interface PaginationOptions extends PaginationInput {
  skip: number;
  take: number;
}
