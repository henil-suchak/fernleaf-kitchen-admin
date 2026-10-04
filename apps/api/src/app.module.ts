import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

import { AuthModule } from './auth/auth.module';
import { AuthorizationModule } from './authorization/authorization.module';
import { BillingModule } from './billing/billing.module';
import { CatalogueModule } from './catalogue/catalogue.module';
import { CompaniesModule } from './companies/companies.module';
import { DispatchModule } from './dispatch/dispatch.module';
import { DashboardModule } from './dashboard/dashboard.module';
import { EmployeesModule } from './employees/employees.module';
import { HealthController } from './health/health.controller';
import { MenuModule } from './menu/menu.module';
import { OrdersModule } from './orders/orders.module';
import { KitchenModule } from './kitchen/kitchen.module';
import { PrismaModule } from './prisma/prisma.module';
import { PricingModule } from './pricing/pricing.module';
import { ReferenceDataModule } from './reference-data/reference-data.module';
import { SettingsModule } from './settings/settings.module';
import { StaffModule } from './staff/staff.module';
import { validateEnvironment } from './config/environment.validation';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnvironment }),
    PrismaModule,
    AuthModule,
    AuthorizationModule,
    StaffModule,
    SettingsModule,
    ReferenceDataModule,
    CatalogueModule,
    CompaniesModule,
    EmployeesModule,
    MenuModule,
    PricingModule,
    OrdersModule,
    KitchenModule,
    DispatchModule,
    BillingModule,
    DashboardModule,
  ],
  controllers: [HealthController],
})
export class AppModule {}
