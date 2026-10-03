import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaModule } from '../prisma/prisma.module';
import { PricingController } from './pricing.controller';
import { PricingResolver } from './pricing-resolver.service';
import { PricingService } from './pricing.service';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [PricingController],
  providers: [PricingService, PricingResolver],
  exports: [PricingResolver],
})
export class PricingModule {}
