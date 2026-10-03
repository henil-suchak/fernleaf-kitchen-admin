import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaModule } from '../prisma/prisma.module';
import { DishesController } from './dishes.controller';
import { DishService } from './dish.service';
import { OptionGroupsController } from './option-groups.controller';
import { OptionGroupService } from './option-group.service';
import { OptionsController } from './options.controller';
import { OptionService } from './option.service';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [DishesController, OptionsController, OptionGroupsController],
  providers: [DishService, OptionService, OptionGroupService],
})
export class CatalogueModule {}
