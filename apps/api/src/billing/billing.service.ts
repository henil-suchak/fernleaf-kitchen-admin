import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InvoiceStatus, OrderStatus, Prisma } from '@prisma/client';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { sumMinorUnits } from '../common/money/money.util';
import { createPaginatedResponse, toPaginationOptions } from '../common/pagination/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateInvoiceDto } from './dto/create-invoice.dto';
import type { InvoiceListQueryDto } from './dto/invoice-list-query.dto';
import type { UninvoicedOrderQueryDto } from './dto/uninvoiced-order-query.dto';

type Transaction = Prisma.TransactionClient;
const billableStatuses: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.DELIVERED];

const invoiceInclude = Prisma.validator<Prisma.InvoiceInclude>()({
  company: { select: { id: true, name: true, billingContactName: true, billingContactEmail: true } },
  orders: { orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }], include: { employee: { select: { id: true, name: true, email: true } } } },
});

@Injectable()
export class BillingService {
  constructor(private readonly prisma: PrismaService) {}

  async listUninvoicedOrders(companyId: string, query: UninvoicedOrderQueryDto): Promise<PaginatedResponse<unknown>> {
    const company = await this.prisma.company.findUnique({ where: { id: companyId }, select: { id: true } });
    if (!company) throw new NotFoundException('Company not found.');
    const { skip, take } = toPaginationOptions(query);
    const where: Prisma.OrderWhereInput = { companyId, invoiceId: null, status: { in: billableStatuses } };
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, skip, take, orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }], include: { employee: { select: { id: true, name: true, email: true } } } }),
      this.prisma.order.count({ where }),
    ]);
    return createPaginatedResponse(orders.map((order) => ({ ...order, deliveryDate: order.deliveryDate.toISOString().slice(0, 10), cutoffAt: order.cutoffAt.toISOString() })), total, query);
  }

  async createInvoice(input: CreateInvoiceDto) {
    return this.serializable(async (tx) => {
      if (!input.orderIds.length || new Set(input.orderIds).size !== input.orderIds.length) throw new ConflictException('Invoice requires one or more unique Orders.');
      const company = await tx.company.findUnique({ where: { id: input.companyId }, select: { id: true } });
      if (!company) throw new NotFoundException('Company not found.');
      const orders = await tx.order.findMany({ where: { id: { in: input.orderIds } }, select: { id: true, companyId: true, status: true, invoiceId: true, totalMinorUnits: true } });
      if (orders.length !== input.orderIds.length) throw new ConflictException('One or more selected Orders do not exist.');
      if (orders.some((order) => order.companyId !== input.companyId || !billableStatuses.includes(order.status) || order.invoiceId !== null)) throw new ConflictException('Selected Orders must be uninvoiced billable Orders for the requested Company.');
      const invoice = await tx.invoice.create({ data: { companyId: input.companyId, totalMinorUnits: sumMinorUnits(orders.map((order) => order.totalMinorUnits)) } });
      const attached = await tx.order.updateMany({
        where: { id: { in: input.orderIds }, companyId: input.companyId, status: { in: billableStatuses }, invoiceId: null },
        data: { invoiceId: invoice.id },
      });
      if (attached.count !== input.orderIds.length) throw new ConflictException('An Order changed before Invoice creation.');
      return tx.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: invoiceInclude });
    });
  }

  async listInvoices(query: InvoiceListQueryDto): Promise<PaginatedResponse<unknown>> {
    const { skip, take } = toPaginationOptions(query);
    const where: Prisma.InvoiceWhereInput = { ...(query.companyId ? { companyId: query.companyId } : {}), ...(query.status ? { status: query.status } : {}) };
    const [invoices, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, skip, take, orderBy: { createdAt: 'desc' }, include: { company: { select: { id: true, name: true } }, _count: { select: { orders: true } } } }),
      this.prisma.invoice.count({ where }),
    ]);
    return createPaginatedResponse(invoices, total, query);
  }

  async getInvoice(id: string) {
    const invoice = await this.prisma.invoice.findUnique({ where: { id }, include: invoiceInclude });
    if (!invoice) throw new NotFoundException('Invoice not found.');
    return invoice;
  }

  async markPaid(id: string) {
    return this.serializable(async (tx) => {
      const invoice = await tx.invoice.findUnique({ where: { id }, select: { id: true } });
      if (!invoice) throw new NotFoundException('Invoice not found.');
      const paidAt = new Date();
      const changed = await tx.invoice.updateMany({ where: { id, status: InvoiceStatus.OPEN }, data: { status: InvoiceStatus.PAID, paidAt } });
      if (changed.count !== 1) throw new ConflictException('Invoice is already paid.');
      return tx.invoice.findUniqueOrThrow({ where: { id }, include: invoiceInclude });
    });
  }

  private async serializable<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Billing update conflicted with another request.');
  }
}
