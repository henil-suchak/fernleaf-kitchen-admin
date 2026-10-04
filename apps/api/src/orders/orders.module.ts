import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { DispatchModule } from '../dispatch/dispatch.module';
import { MenuModule } from '../menu/menu.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { SettingsModule } from '../settings/settings.module';
import { OrdersController } from './orders.controller';
import { OrdersService } from './orders.service';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule, MenuModule, PricingModule, SettingsModule, DispatchModule],
  controllers: [OrdersController],
  providers: [OrdersService],
})
export class OrdersModule {}
