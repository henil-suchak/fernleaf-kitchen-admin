import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaModule } from '../prisma/prisma.module';
import { KitchenController } from './kitchen.controller';
import { KitchenService } from './kitchen.service';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [KitchenController],
  providers: [KitchenService],
})
export class KitchenModule {}
