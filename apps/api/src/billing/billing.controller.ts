import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { BillingService } from './billing.service';
import { CreateInvoiceDto } from './dto/create-invoice.dto';
import { InvoiceListQueryDto } from './dto/invoice-list-query.dto';
import { UninvoicedOrderQueryDto } from './dto/uninvoiced-order-query.dto';

@Controller('billing')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class BillingController {
  constructor(private readonly billingService: BillingService) {}

  @Get('companies/:companyId/uninvoiced-orders')
  @RequirePermissions(PermissionCode.BILLING_READ)
  uninvoicedOrders(@Param('companyId', new ParseUUIDPipe({ version: '4' })) companyId: string, @Query() query: UninvoicedOrderQueryDto) {
    return this.billingService.listUninvoicedOrders(companyId, query);
  }

  @Post('invoices')
  @RequirePermissions(PermissionCode.BILLING_WRITE)
  create(@Body() input: CreateInvoiceDto) { return this.billingService.createInvoice(input); }

  @Get('invoices')
  @RequirePermissions(PermissionCode.BILLING_READ)
  list(@Query() query: InvoiceListQueryDto) { return this.billingService.listInvoices(query); }

  @Get('invoices/:id')
  @RequirePermissions(PermissionCode.BILLING_READ)
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.billingService.getInvoice(id); }

  @Post('invoices/:id/paid')
  @RequirePermissions(PermissionCode.BILLING_WRITE)
  markPaid(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.billingService.markPaid(id); }
}
