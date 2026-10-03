import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaModule } from '../prisma/prisma.module';
import { AllergensController } from './allergens.controller';
import { DietaryTagsController } from './dietary-tags.controller';
import { KitchenStationsController } from './kitchen-stations.controller';
import { ReferenceDataService } from './reference-data.service';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [
    AllergensController,
    DietaryTagsController,
    KitchenStationsController,
  ],
  providers: [ReferenceDataService],
  exports: [ReferenceDataService],
})
export class ReferenceDataModule {}
