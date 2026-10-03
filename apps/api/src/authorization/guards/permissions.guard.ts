import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';

import type { AuthenticatedRequest } from '../../auth/types/authenticated-staff.type';
import { AuthorizationService } from '../authorization.service';
import {
  REQUIRED_PERMISSIONS_KEY,
} from '../decorators/require-permissions.decorator';
import type { PermissionCode } from '../permission-code';

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const requiredPermissions = this.reflector.getAllAndOverride<PermissionCode[]>(
      REQUIRED_PERMISSIONS_KEY,
      [context.getHandler(), context.getClass()],
    );

    if (!requiredPermissions || requiredPermissions.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const staffUser = request.staffUser;

    if (!staffUser) {
      throw new UnauthorizedException();
    }

    const hasPermissions = await this.authorizationService.hasPermissions(
      staffUser.id,
      requiredPermissions,
    );

    if (!hasPermissions) {
      throw new ForbiddenException();
    }

    return true;
  }
}
