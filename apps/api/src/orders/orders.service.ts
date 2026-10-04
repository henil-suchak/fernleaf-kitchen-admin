import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma, type Weekday } from '@prisma/client';
import { DateTime } from 'luxon';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { AuthorizationService } from '../authorization/authorization.service';
import { PermissionCode } from '../authorization/permission-code';
import { multiplyMinorUnits, sumMinorUnits } from '../common/money/money.util';
import { createPaginatedResponse, toPaginationOptions } from '../common/pagination/pagination.util';
import { combineLocalDateAndTime } from '../common/time/time.util';
import { MenuService } from '../menu/menu.service';
import { PrismaService } from '../prisma/prisma.service';
import { PricingResolver } from '../pricing/pricing-resolver.service';
import { parseHolidayDate } from '../settings/settings-date.util';
import { cutoffTimeToMinutes, minutesToCutoffTime } from '../settings/settings-time.util';
import type { CreateOrderDto } from './dto/create-order.dto';
import type { OrderListQueryDto } from './dto/order-list-query.dto';
import type { OrderLineDto, OrderSelectionDto } from './dto/order-content.dto';
import type { UpdateOrderDeliveryDto } from './dto/update-order-delivery.dto';
import type { UpdateOrderDto } from './dto/update-order.dto';

type Transaction = Prisma.TransactionClient;
type OrderContext = Awaited<ReturnType<OrdersService['loadContext']>>;

const detailInclude = Prisma.validator<Prisma.OrderInclude>()({
  employee: { select: { id: true, name: true, email: true } },
  company: { select: { id: true, name: true } },
  effectivePricingTier: { select: { id: true, name: true } },
  lines: {
    orderBy: { createdAt: 'asc' },
    include: {
      combinations: { orderBy: { createdAt: 'asc' }, include: { selectedOptions: { orderBy: { optionGroupId: 'asc' } } } },
    },
  },
  statusEvents: { orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], include: { actorStaffUser: { select: { id: true, email: true } } } },
});

@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingResolver: PricingResolver,
    private readonly menuService: MenuService,
    private readonly authorizationService: AuthorizationService,
  ) {}

  async create(input: CreateOrderDto, actorStaffUserId: string) {
    const deliveryDate = parseDate(input.deliveryDate);
    const id = await this.serializable(async (tx) => {
      const context = await this.loadContext(tx, input.employeeId, deliveryDate);
      this.assertBeforeCutoff(context.cutoffAt);
      const delivery = this.resolveDelivery(context, input);
      const content = await this.resolveContent(tx, context, input.lines);
      const order = await tx.order.create({
        data: {
          employeeId: context.employee.id,
          companyId: context.company.id,
          effectivePricingTierId: context.tier.id,
          pricingTierNameSnapshot: context.tier.name,
          status: OrderStatus.DRAFT,
          deliveryDate,
          cutoffAt: context.cutoffAt,
          ...delivery,
          totalMinorUnits: content.totalMinorUnits,
        },
      });
      await this.persistLines(tx, order.id, content.lines);
      await this.event(tx, order.id, null, OrderStatus.DRAFT, actorStaffUserId, 'Order created as draft.');
      return order.id;
    });
    return this.get(id);
  }

  async list(query: OrderListQueryDto): Promise<PaginatedResponse<unknown>> {
    const { skip, take } = toPaginationOptions(query);
    const deliveryFrom = query.deliveryFrom ? parseDate(query.deliveryFrom) : undefined;
    const deliveryTo = query.deliveryTo ? parseDate(query.deliveryTo) : undefined;
    const where: Prisma.OrderWhereInput = {
      ...(query.status ? { status: query.status } : {}),
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...((deliveryFrom || deliveryTo) ? { deliveryDate: { ...(deliveryFrom ? { gte: deliveryFrom } : {}), ...(deliveryTo ? { lte: deliveryTo } : {}) } } : {}),
      ...(query.search ? { OR: [
        { employee: { is: { OR: [{ name: { contains: query.search, mode: Prisma.QueryMode.insensitive } }, { email: { contains: query.search, mode: Prisma.QueryMode.insensitive } }] } } },
        { company: { is: { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } } } },
      ] } : {}),
    };
    const [orders, total] = await this.prisma.$transaction([
      this.prisma.order.findMany({ where, skip, take, orderBy: [{ deliveryDate: 'asc' }, { createdAt: 'asc' }], include: { employee: { select: { id: true, name: true, email: true } }, company: { select: { id: true, name: true } } } }),
      this.prisma.order.count({ where }),
    ]);
    return createPaginatedResponse(orders.map(toSummary), total, query);
  }

  async get(id: string) {
    const order = await this.prisma.order.findUnique({ where: { id }, include: detailInclude });
    if (!order) throw new NotFoundException('Order not found.');
    return toDetail(order);
  }

  async update(id: string, input: UpdateOrderDto) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one editable Order field must be provided.');
    }
    await this.serializable(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order not found.');
      this.assertEditable(order.status, order.cutoffAt);
      const deliveryDate = input.deliveryDate ? parseDate(input.deliveryDate) : order.deliveryDate;
      const context = await this.loadContext(tx, order.employeeId, deliveryDate, order.companyId);
      if (input.deliveryDate) this.assertBeforeCutoff(context.cutoffAt);
      const deliveryChanged = input.deliveryAddressId !== undefined || input.deliveryTime !== undefined || input.packaging !== undefined || input.deliveryDate !== undefined;
      const delivery = deliveryChanged ? this.resolveDelivery(context, input) : null;
      const content = input.lines ? await this.resolveContent(tx, context, input.lines) : null;
      const now = new Date();
      const guarded = await tx.order.updateMany({
        where: { id, status: { in: [OrderStatus.DRAFT, OrderStatus.PLACED] }, cutoffAt: { gt: now } },
        data: {
          ...(input.deliveryDate ? { deliveryDate, cutoffAt: context.cutoffAt } : {}),
          ...(delivery ?? {}),
          ...(content ? { effectivePricingTierId: context.tier.id, pricingTierNameSnapshot: context.tier.name, totalMinorUnits: content.totalMinorUnits } : {}),
        },
      });
      if (guarded.count !== 1) throw new ConflictException('Order is no longer editable.');
      if (content) {
        await tx.orderLine.deleteMany({ where: { orderId: id } });
        await this.persistLines(tx, id, content.lines);
      }
    });
    return this.get(id);
  }

  async place(id: string, actorStaffUserId: string) {
    await this.serializable(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order not found.');
      if (order.status !== OrderStatus.DRAFT) throw new ConflictException('Only a Draft Order can be placed.');
      this.assertBeforeCutoff(order.cutoffAt);
      await this.loadContext(tx, order.employeeId, order.deliveryDate, order.companyId);
      const changed = await tx.order.updateMany({ where: { id, status: OrderStatus.DRAFT, cutoffAt: { gt: new Date() } }, data: { status: OrderStatus.PLACED } });
      if (changed.count !== 1) throw new ConflictException('Order is no longer placeable.');
      await this.event(tx, id, OrderStatus.DRAFT, OrderStatus.PLACED, actorStaffUserId, 'Order placed.');
    });
    return this.get(id);
  }

  async cancel(id: string, actorStaffUserId: string) {
    const canOverride = await this.authorizationService.hasPermissions(actorStaffUserId, [PermissionCode.ORDER_OVERRIDE]);
    const canEdit = canOverride || await this.authorizationService.hasPermissions(actorStaffUserId, [PermissionCode.ORDER_EDIT]);
    if (!canEdit) throw new ForbiddenException('Staff user lacks Order cancellation permission.');
    await this.serializable(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order not found.');
      if (order.status !== OrderStatus.DRAFT && order.status !== OrderStatus.PLACED && order.status !== OrderStatus.CONFIRMED) throw new ConflictException('Order cannot be cancelled from its current status.');
      if (!canOverride && (order.status === OrderStatus.CONFIRMED || new Date() >= order.cutoffAt)) throw new ConflictException('Order cannot be cancelled after cutoff.');
      const changed = await tx.order.updateMany({ where: { id, status: order.status }, data: { status: OrderStatus.CANCELLED } });
      if (changed.count !== 1) throw new ConflictException('Order status changed before cancellation.');
      await this.event(tx, id, order.status as OrderStatus, OrderStatus.CANCELLED, actorStaffUserId, canOverride ? 'Order cancelled by override.' : 'Order cancelled.');
    });
    return this.get(id);
  }

  async updateDelivery(id: string, input: UpdateOrderDeliveryDto) {
    if (Object.values(input).every((value) => value === undefined)) throw new BadRequestException('At least one delivery field must be provided.');
    await this.serializable(async (tx) => {
      const order = await tx.order.findUnique({ where: { id } });
      if (!order) throw new NotFoundException('Order not found.');
      if (order.status !== OrderStatus.CONFIRMED) throw new ConflictException('Only a Confirmed Order supports a delivery override.');
      const address = input.deliveryAddressId === undefined ? null : await this.requireActiveAddress(tx, order.companyId, input.deliveryAddressId);
      await tx.order.update({ where: { id }, data: {
        ...(address ? addressSnapshot(address) : {}),
        ...(input.deliveryTime === undefined ? {} : { deliveryTimeMinutes: parseTime(input.deliveryTime) }),
        ...(input.packaging === undefined ? {} : { packaging: input.packaging.trim() }),
      } });
    });
    return this.get(id);
  }

  async processCutoff(deliveryDateValue: string, actorStaffUserId: string) {
    const deliveryDate = parseDate(deliveryDateValue);
    return this.serializable(async (tx) => {
      const candidates = await tx.order.findMany({ where: { deliveryDate, status: { in: [OrderStatus.DRAFT, OrderStatus.PLACED] } }, select: { id: true, status: true, cutoffAt: true } });
      const now = new Date();
      if (candidates.some((order) => order.cutoffAt > now) && !candidates.some((order) => order.cutoffAt <= now)) throw new ConflictException('The Order cutoff has not passed.');
      let confirmed = 0;
      let cancelled = 0;
      for (const order of candidates.filter((candidate) => candidate.cutoffAt <= now)) {
        const next = order.status === OrderStatus.DRAFT ? OrderStatus.CANCELLED : OrderStatus.CONFIRMED;
        const changed = await tx.order.updateMany({ where: { id: order.id, status: order.status, cutoffAt: { lte: now } }, data: { status: next } });
        if (changed.count === 1) {
          if (next === OrderStatus.CONFIRMED) confirmed += 1; else cancelled += 1;
          await this.event(tx, order.id, order.status, next, actorStaffUserId, 'Cutoff processed.');
        }
      }
      return { deliveryDate: deliveryDateValue, confirmed, cancelled };
    });
  }

  private async loadContext(tx: Transaction, employeeId: string, deliveryDate: Date, expectedCompanyId?: string) {
    const employee = await tx.employee.findUnique({ where: { id: employeeId }, include: { company: { include: { addresses: { where: { isActive: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }, holidays: { where: { date: deliveryDate } } } } } });
    if (!employee) throw new NotFoundException('Employee not found.');
    if (!employee.isActive || !employee.company.isActive) throw new BadRequestException('Employee and Company must be active.');
    if (expectedCompanyId && employee.companyId !== expectedCompanyId) throw new ConflictException('Employee no longer belongs to the Order Company.');
    if (!employee.company.addresses.length) throw new BadRequestException('Company requires an active delivery address.');
    const weekday = weekdayFor(deliveryDate);
    if (!employee.company.workingDays.includes(weekday) || employee.company.holidays.length) throw new BadRequestException('Company cannot receive a delivery on this date.');
    const settings = await tx.kitchenSettings.findUnique({ where: { key: 'GLOBAL' } });
    if (!settings) throw new Error('The global kitchen settings record is missing. Run the seed.');
    const holidays = await tx.kitchenHoliday.findMany({ select: { date: true } });
    const cutoffAt = calculateCutoff(deliveryDate, settings, holidays.map((holiday) => holiday.date));
    const tier = await this.pricingResolver.resolveEffectivePricingTier(employee.company.pricingTierId);
    return { employee, company: employee.company, tier, cutoffAt };
  }

  private resolveDelivery(context: OrderContext, input: { deliveryAddressId?: string; deliveryTime?: string; packaging?: string }) {
    const address = input.deliveryAddressId === undefined
      ? context.company.addresses[0]
      : context.employee.canChooseDeliveryAddress
        ? context.company.addresses.find((candidate) => candidate.id === input.deliveryAddressId)
        : context.company.addresses[0];
    if (!address) throw new BadRequestException('Delivery address must be active and belong to the Employee Company.');
    const deliveryTimeMinutes = context.employee.canChangeDeliveryTime && input.deliveryTime !== undefined
      ? parseTime(input.deliveryTime)
      : context.company.defaultDeliveryTimeMinutes;
    const packaging = context.employee.canChangePackaging && input.packaging !== undefined
      ? input.packaging.trim()
      : context.company.defaultPackaging;
    if (!packaging) throw new BadRequestException('Packaging must not be blank.');
    return { ...addressSnapshot(address), deliveryTimeMinutes, deliveryMinutesBeforeSnapshot: context.company.deliveryMinutesBefore, packaging, driverInstructionsSnapshot: context.company.driverInstructions };
  }

  private async resolveContent(tx: Transaction, context: OrderContext, lines: OrderLineDto[]) {
    if (new Set(lines.map((line) => line.dishId)).size !== lines.length) throw new BadRequestException('A Dish may appear only once in an Order.');
    const resolved = [] as Array<Awaited<ReturnType<OrdersService['resolveLine']>>>;
    for (const line of lines) resolved.push(await this.resolveLine(tx, context, line));
    return { lines: resolved, totalMinorUnits: sumMinorUnits(resolved.map((line) => line.lineTotalMinorUnits)) };
  }

  private async resolveLine(tx: Transaction, context: OrderContext, input: OrderLineDto) {
    const menuItem = await tx.menuCategoryItem.findFirst({ where: { dishId: input.dishId, isActive: true, category: { isActive: true }, NOT: [{ hiddenForCompanies: { some: { companyId: context.company.id } } }, { category: { hiddenForCompanies: { some: { companyId: context.company.id } } } }] }, include: { dish: { include: { kitchenStation: true, dishOptionGroups: { include: { optionGroup: { include: { optionGroupOptions: { include: { option: true } } } } } } } } } });
    if (!menuItem?.dish.isActive) throw new BadRequestException('Dish is not orderable for this Employee.');
    const dishPrice = await this.pricingResolver.resolveDishPrice(input.dishId, context.tier.id);
    if (!dishPrice.available) throw new BadRequestException('Dish has no available price.');
    if (input.quantity < menuItem.dish.minimumQuantity) throw new BadRequestException('Dish quantity is below its minimum quantity.');
    if (sumQuantities(input.combinations.map((combination) => combination.quantity)) !== input.quantity) throw new BadRequestException('Combination quantities must equal the Order line quantity.');
    const combinations = [] as Array<{ selectionKey: string; quantity: number; unitPriceMinorUnits: number; totalMinorUnits: number; selectedOptions: Array<{ optionGroupId: string; optionId: string; optionGroupNameSnapshot: string; optionNameSnapshot: string; optionUnitPriceMinorUnits: number }> }>;
    for (const combination of input.combinations) {
      const selected = await this.resolveSelections(menuItem.dish.dishOptionGroups, context.tier.id, combination.selections);
      const selectionKey = selected.map((value) => `${value.optionGroupId}:${value.optionId}`).sort().join('|');
      if (combinations.some((value) => value.selectionKey === selectionKey)) throw new BadRequestException('Duplicate option combination in an Order line.');
      const unitPriceMinorUnits = sumMinorUnits([dishPrice.priceMinorUnits, ...selected.map((value) => value.optionUnitPriceMinorUnits)]);
      combinations.push({ selectionKey, quantity: combination.quantity, unitPriceMinorUnits, totalMinorUnits: multiplyMinorUnits(unitPriceMinorUnits, combination.quantity), selectedOptions: selected });
    }
    const lineTotalMinorUnits = sumMinorUnits(combinations.map((combination) => combination.totalMinorUnits));
    return { dishId: menuItem.dish.id, dishNameSnapshot: menuItem.dish.name, dishSkuSnapshot: menuItem.dish.sku, kitchenStationId: menuItem.dish.kitchenStationId, kitchenStationNameSnapshot: menuItem.dish.kitchenStation?.name ?? null, quantity: input.quantity, dishUnitPriceMinorUnits: dishPrice.priceMinorUnits, lineTotalMinorUnits, combinations };
  }

  private async resolveSelections(groups: Array<{ isRequired: boolean; optionGroup: { id: string; name: string; isActive: boolean; optionGroupOptions: Array<{ optionId: string; option: { id: string; name: string; isActive: boolean } }> } }>, tierId: string, selections: OrderSelectionDto[]) {
    if (new Set(selections.map((selection) => selection.optionGroupId)).size !== selections.length) throw new BadRequestException('A combination may choose only one Option per OptionGroup.');
    const groupMap = new Map(groups.map((group) => [group.optionGroup.id, group]));
    const result = [] as Array<{ optionGroupId: string; optionId: string; optionGroupNameSnapshot: string; optionNameSnapshot: string; optionUnitPriceMinorUnits: number }>;
    for (const selection of selections) {
      const group = groupMap.get(selection.optionGroupId);
      const membership = group?.optionGroup.optionGroupOptions.find((option) => option.optionId === selection.optionId);
      if (!group?.optionGroup.isActive || !membership?.option.isActive) throw new BadRequestException('Selected Option is not valid for this Dish.');
      const price = await this.pricingResolver.resolveOptionPrice(selection.optionId, tierId);
      if (!price.available) throw new BadRequestException('Selected Option has no available price.');
      result.push({ optionGroupId: selection.optionGroupId, optionId: selection.optionId, optionGroupNameSnapshot: group.optionGroup.name, optionNameSnapshot: membership.option.name, optionUnitPriceMinorUnits: price.priceMinorUnits });
    }
    for (const group of groups) {
      if (group.isRequired && !result.some((selection) => selection.optionGroupId === group.optionGroup.id)) throw new BadRequestException('A required OptionGroup is missing a selection.');
    }
    return result;
  }

  private async persistLines(tx: Transaction, orderId: string, lines: Array<Awaited<ReturnType<OrdersService['resolveLine']>>>) {
    for (const line of lines) {
      const createdLine = await tx.orderLine.create({ data: { orderId, dishId: line.dishId, dishNameSnapshot: line.dishNameSnapshot, dishSkuSnapshot: line.dishSkuSnapshot, kitchenStationId: line.kitchenStationId, kitchenStationNameSnapshot: line.kitchenStationNameSnapshot, quantity: line.quantity, dishUnitPriceMinorUnits: line.dishUnitPriceMinorUnits, lineTotalMinorUnits: line.lineTotalMinorUnits } });
      for (const combination of line.combinations) {
        const createdCombination = await tx.orderCombination.create({ data: { orderLineId: createdLine.id, selectionKey: combination.selectionKey, quantity: combination.quantity, unitPriceMinorUnits: combination.unitPriceMinorUnits, totalMinorUnits: combination.totalMinorUnits } });
        if (combination.selectedOptions.length) await tx.orderCombinationOption.createMany({ data: combination.selectedOptions.map((option) => ({ orderCombinationId: createdCombination.id, ...option })) });
      }
    }
  }

  private async requireActiveAddress(tx: Transaction, companyId: string, addressId: string) {
    const address = await tx.companyAddress.findFirst({ where: { id: addressId, companyId, isActive: true } });
    if (!address) throw new BadRequestException('Delivery address must be active and belong to the Order Company.');
    return address;
  }

  private assertBeforeCutoff(cutoffAt: Date) { if (new Date() >= cutoffAt) throw new ConflictException('Order cutoff has passed.'); }
  private assertEditable(status: OrderStatus, cutoffAt: Date) { if (status !== OrderStatus.DRAFT && status !== OrderStatus.PLACED) throw new ConflictException('Order is not editable.'); this.assertBeforeCutoff(cutoffAt); }
  private event(tx: Transaction, orderId: string, fromStatus: OrderStatus | null, toStatus: OrderStatus, actorStaffUserId: string | null, note: string) { return tx.orderStatusEvent.create({ data: { orderId, fromStatus, toStatus, actorStaffUserId, note } }); }
  private async serializable<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) { if (isSerializationFailure(error) && attempt < 2) continue; throw error; }
    }
    throw new ConflictException('Order update conflicted with another request.');
  }
}

function parseDate(value: string): Date { try { return parseHolidayDate(value); } catch { throw new BadRequestException('deliveryDate must be a valid calendar date.'); } }
function parseTime(value: string): number { try { return cutoffTimeToMinutes(value); } catch { throw new BadRequestException('deliveryTime must use the HH:mm format.'); } }
function sumQuantities(values: number[]): number { return values.reduce((total, value) => total + value, 0); }
function weekdayFor(date: Date): Weekday { return ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'][DateTime.fromJSDate(date, { zone: 'utc' }).weekday - 1] as Weekday; }
function dateKey(date: Date): string { return DateTime.fromJSDate(date, { zone: 'utc' }).toISODate() ?? ''; }
function calculateCutoff(deliveryDate: Date, settings: { timezone: string; workingDays: Weekday[]; cutoffWorkingDays: number; cutoffTimeMinutes: number }, holidays: Date[]): Date {
  let date = DateTime.fromJSDate(deliveryDate, { zone: 'utc' }).startOf('day');
  const holidayKeys = new Set(holidays.map(dateKey));
  let remaining = settings.cutoffWorkingDays;
  while (remaining > 0) {
    date = date.minus({ days: 1 });
    if (settings.workingDays.includes(weekdayFor(date.toJSDate())) && !holidayKeys.has(date.toISODate() ?? '')) remaining -= 1;
  }
  const instant = combineLocalDateAndTime(date.toISODate()!, minutesToCutoffTime(settings.cutoffTimeMinutes), settings.timezone).toUTC();
  return instant.toJSDate();
}
function addressSnapshot(address: { id: string; label: string; addressLine1: string; addressLine2: string | null; city: string; stateRegion: string; postalCode: string; country: string }) { return { sourceCompanyAddressId: address.id, deliveryAddressLabel: address.label, deliveryAddressLine1: address.addressLine1, deliveryAddressLine2: address.addressLine2, deliveryCity: address.city, deliveryStateRegion: address.stateRegion, deliveryPostalCode: address.postalCode, deliveryCountry: address.country }; }
function isSerializationFailure(error: unknown): boolean { return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034'; }
function toSummary(order: { id: string; status: OrderStatus; deliveryDate: Date; cutoffAt: Date; totalMinorUnits: number; employee: { id: string; name: string; email: string }; company: { id: string; name: string } }) { return { ...order, deliveryDate: dateKey(order.deliveryDate), cutoffAt: order.cutoffAt.toISOString() }; }
function toDetail(order: Prisma.OrderGetPayload<{ include: typeof detailInclude }>) { return { ...toSummary(order), pricingTier: { id: order.effectivePricingTierId, name: order.pricingTierNameSnapshot }, delivery: { sourceCompanyAddressId: order.sourceCompanyAddressId, label: order.deliveryAddressLabel, addressLine1: order.deliveryAddressLine1, addressLine2: order.deliveryAddressLine2, city: order.deliveryCity, stateRegion: order.deliveryStateRegion, postalCode: order.deliveryPostalCode, country: order.deliveryCountry, deliveryTimeMinutes: order.deliveryTimeMinutes, deliveryMinutesBefore: order.deliveryMinutesBeforeSnapshot, packaging: order.packaging, driverInstructions: order.driverInstructionsSnapshot }, lines: order.lines, statusEvents: order.statusEvents.map((event) => ({ ...event, occurredAt: event.occurredAt.toISOString() })), createdAt: order.createdAt.toISOString(), updatedAt: order.updatedAt.toISOString() }; }
