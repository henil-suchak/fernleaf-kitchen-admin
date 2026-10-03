import type { Request } from 'express';

export interface AuthenticatedStaff {
  id: string;
  email: string;
  role: {
    code: string;
    name: string;
  };
}

export interface AuthenticatedRequest extends Request {
  staffUser?: AuthenticatedStaff;
}

export interface JwtPayload {
  sub: string;
}
