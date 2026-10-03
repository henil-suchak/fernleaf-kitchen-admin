import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

import { PrismaService } from '../../prisma/prisma.service';
import type {
  AuthenticatedRequest,
  JwtPayload,
} from '../types/authenticated-staff.type';

export const SESSION_COOKIE_NAME = 'fernleaf_session';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwtService: JwtService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = request.cookies?.[SESSION_COOKIE_NAME];

    if (typeof token !== 'string') {
      throw new UnauthorizedException();
    }

    let payload: JwtPayload;

    try {
      payload = await this.jwtService.verifyAsync<JwtPayload>(token);
    } catch {
      throw new UnauthorizedException();
    }

    if (typeof payload.sub !== 'string') {
      throw new UnauthorizedException();
    }

    const staffUser = await this.prisma.staffUser.findUnique({
      where: { id: payload.sub },
      select: {
        id: true,
        email: true,
        isActive: true,
        role: {
          select: {
            code: true,
            name: true,
          },
        },
      },
    });

    if (!staffUser?.isActive) {
      throw new UnauthorizedException();
    }

    request.staffUser = {
      id: staffUser.id,
      email: staffUser.email,
      role: staffUser.role,
    };

    return true;
  }
}
