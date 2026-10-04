import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CompaniesModule } from './companies/companies.module';
import { EmployeesModule } from './employees/employees.module';
import { HealthController } from './health/health.controller';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { PrismaModule } from './prisma/prisma.module';
import { PricingModule } from './pricing/pricing.module';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { SettingsModule } from './settings/settings.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    AuthModule,
    AuthorizationModule,
    SettingsModule,
    ReferenceDataModule,
    CatalogueModule,
    CompaniesModule,
    EmployeesModule,
    MenuModule,
    PricingModule,
    OrdersModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
