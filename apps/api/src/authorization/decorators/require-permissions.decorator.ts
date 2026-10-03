import { SetMetadata } from '@nestjs/common';

import type { PermissionCode } from '../permission-code';

export const REQUIRED_PERMISSIONS_KEY = 'authorization:required-permissions';

export const RequirePermissions = (...permissions: PermissionCode[]) =>
  SetMetadata(REQUIRED_PERMISSIONS_KEY, permissions);
