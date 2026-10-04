import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DispatchController, DriverDropsController } from './dispatch.controller';
import { DispatchDropManager } from './dispatch-drop-manager.service';
import { DispatchService } from './dispatch.service';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [DispatchController, DriverDropsController],
  providers: [DispatchService, DispatchDropManager],
  exports: [DispatchDropManager],
})
export class DispatchModule {}
