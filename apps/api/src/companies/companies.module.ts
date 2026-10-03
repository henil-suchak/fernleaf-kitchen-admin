import { Module } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { AuthorizationModule } from '../authorization/authorization.module';
import { PrismaModule } from '../prisma/prisma.module';
import { CompaniesController } from './companies.controller';
import { CompanyService } from './company.service';

@Module({
  imports: [PrismaModule, AuthModule, AuthorizationModule],
  controllers: [CompaniesController],
  providers: [CompanyService],
})
export class CompaniesModule {}
