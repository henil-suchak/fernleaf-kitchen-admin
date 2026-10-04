import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingModule } from '../pricing/pricing.module';
import { CompanyMenuController, MenuController } from './menu.controller';
import { MenuService } from './menu.service';

@Module({
  imports: [PrismaModule, PricingModule, AuthModule, AuthorizationModule],
  controllers: [MenuController, CompanyMenuController],
  providers: [MenuService],
  exports: [MenuService],
})
export class MenuModule {}
