import { Injectable } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import type { PermissionCode } from './permission-code';

@Injectable()
export class AuthorizationService {
  constructor(private readonly prisma: PrismaService) {}

  async hasPermissions(
    staffUserId: string,
    requiredPermissions: readonly PermissionCode[],
  ): Promise<boolean> {
    if (requiredPermissions.length === 0) {
      return true;
    }

    const staffUser = await this.prisma.staffUser.findUnique({
      where: { id: staffUserId },
      select: {
        role: {
          select: {
            rolePermissions: {
              where: {
                permission: {
                  code: { in: [...requiredPermissions] },
                },
              },
              select: {
                permission: {
                  select: { code: true },
                },
              },
            },
          },
        },
      },
    });

    if (!staffUser) {
      return false;
    }

    const grantedPermissions = new Set(
      staffUser.role.rolePermissions.map(({ permission }) => permission.code),
    );

    return requiredPermissions.every((permission) =>
      grantedPermissions.has(permission),
    );
  }
}
