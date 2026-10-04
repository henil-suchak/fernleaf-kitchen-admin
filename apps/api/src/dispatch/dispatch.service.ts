import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { DispatchDropStatus, OrderStatus, Prisma } from '@prisma/client';
import { DateTime } from 'luxon';

import { calculateOrderPlan } from '../common/time/order-planning.util';
import { PrismaService } from '../prisma/prisma.service';
import { parseHolidayDate } from '../settings/settings-date.util';
import type { DeliverDropDto } from './dto/deliver-drop.dto';
import { dateKey } from './dispatch-grouping.util';
import { DispatchDropManager } from './dispatch-drop-manager.service';

type Transaction = Prisma.TransactionClient;

const dropInclude = Prisma.validator<Prisma.DispatchDropInclude>()({
  company: { select: { id: true, name: true, defaultDriver: { select: { id: true, email: true } } } },
  assignedDriver: { select: { id: true, email: true } },
  orders: { orderBy: { createdAt: 'asc' }, include: { employee: { select: { id: true, name: true, email: true } }, lines: { include: { combinations: { include: { selectedOptions: true } } } } } },
});

@Injectable()
export class DispatchService {
  constructor(private readonly prisma: PrismaService, private readonly drops: DispatchDropManager) {}

  async board(deliveryDateValue: string) {
    const deliveryDate = parseDate(deliveryDateValue);
    const settings = await this.prisma.kitchenSettings.findUniqueOrThrow({ where: { key: 'GLOBAL' } });
    const drops = await this.serializable(async (tx) => {
      await this.drops.syncDate(tx, deliveryDate);
      return tx.dispatchDrop.findMany({ where: { deliveryDate }, orderBy: [{ deliveryTimeMinutes: 'asc' }, { createdAt: 'asc' }], include: dropInclude });
    });
    return drops.map((drop) => toDropResponse(drop, settings.timezone));
  }

  async listDrivers() {
    return this.drops.listDeliveryCapableStaff();
  }

  async assignDriver(id: string, driverId: string) {
    return this.serializable(async (tx) => {
      const drop = await tx.dispatchDrop.findUnique({ where: { id } });
      if (!drop) throw new NotFoundException('Dispatch Drop not found.');
      if (drop.status === DispatchDropStatus.OUT_FOR_DELIVERY || drop.status === DispatchDropStatus.DELIVERED) throw new ConflictException('Driver cannot change after delivery execution starts.');
      if (!await this.drops.isDeliveryCapable(tx, driverId)) throw new ConflictException('Assigned driver must be active and have delivery permissions.');
      return tx.dispatchDrop.update({ where: { id }, data: { assignedDriverId: driverId }, include: dropInclude });
    });
  }

  async dispatchReady(id: string) {
    return this.serializable(async (tx) => {
      const drop = await tx.dispatchDrop.findUnique({ where: { id }, include: { orders: { include: { lines: { include: { combinations: true } } } } } });
      if (!drop) throw new NotFoundException('Dispatch Drop not found.');
      if (drop.status !== DispatchDropStatus.WAITING_KITCHEN) throw new ConflictException('Drop is already operationally advanced.');
      if (!drop.orders.length || drop.orders.some((order) => order.status !== OrderStatus.CONFIRMED || !isKitchenReady(order))) throw new ConflictException('Every Drop Order must be Confirmed and kitchen-ready.');
      const now = new Date();
      const changed = await tx.dispatchDrop.updateMany({ where: { id, status: DispatchDropStatus.WAITING_KITCHEN }, data: { status: DispatchDropStatus.DISPATCH_READY, dispatchReadyAt: now } });
      if (changed.count !== 1) throw new ConflictException('Drop changed before dispatch readiness.');
      return tx.dispatchDrop.findUniqueOrThrow({ where: { id }, include: dropInclude });
    });
  }

  async outForDelivery(id: string) {
    return this.serializable(async (tx) => {
      const drop = await tx.dispatchDrop.findUnique({ where: { id } });
      if (!drop) throw new NotFoundException('Dispatch Drop not found.');
      if (drop.status !== DispatchDropStatus.DISPATCH_READY) throw new ConflictException('Drop is not dispatch-ready.');
      if (!drop.assignedDriverId || !await this.drops.isDeliveryCapable(tx, drop.assignedDriverId)) throw new ConflictException('Drop requires an active delivery-capable Driver.');
      const now = new Date();
      const changed = await tx.dispatchDrop.updateMany({ where: { id, status: DispatchDropStatus.DISPATCH_READY, assignedDriverId: drop.assignedDriverId }, data: { status: DispatchDropStatus.OUT_FOR_DELIVERY, outForDeliveryAt: now } });
      if (changed.count !== 1) throw new ConflictException('Drop changed before departure.');
      return tx.dispatchDrop.findUniqueOrThrow({ where: { id }, include: dropInclude });
    });
  }

  async deliver(id: string, actorStaffUserId: string, input: DeliverDropDto) {
    return this.serializable(async (tx) => {
      const drop = await tx.dispatchDrop.findUnique({ where: { id }, include: { orders: true } });
      if (!drop) throw new NotFoundException('Dispatch Drop not found.');
      if (drop.assignedDriverId !== actorStaffUserId) throw new ConflictException('Driver may deliver only their assigned Drop.');
      if (!await this.drops.isDeliveryCapable(tx, actorStaffUserId)) throw new ConflictException('Assigned Driver is no longer delivery-capable.');
      if (drop.status !== DispatchDropStatus.OUT_FOR_DELIVERY) throw new ConflictException('Drop is not out for delivery.');
      if (drop.orders.some((order) => order.status !== OrderStatus.CONFIRMED)) throw new ConflictException('Drop contains a non-deliverable Order.');
      const settings = await tx.kitchenSettings.findUniqueOrThrow({ where: { key: 'GLOBAL' } });
      const now = new Date();
      const plannedDeliveryAt = calculateOrderPlan({ deliveryDate: drop.deliveryDate, deliveryTimeMinutes: drop.deliveryTimeMinutes, deliveryMinutesBeforeSnapshot: 0 }, settings.timezone).plannedDeliveryAt;
      const changed = await tx.dispatchDrop.updateMany({ where: { id, status: DispatchDropStatus.OUT_FOR_DELIVERY, assignedDriverId: actorStaffUserId }, data: { status: DispatchDropStatus.DELIVERED, deliveredAt: now, deliveryNote: input.note?.trim() || null, deliveryPhotoUrl: input.photoUrl?.trim() || null, wasOnTime: now <= plannedDeliveryAt } });
      if (changed.count !== 1) throw new ConflictException('Drop changed before delivery completion.');
      for (const order of drop.orders) {
        const transitioned = await tx.order.updateMany({ where: { id: order.id, status: OrderStatus.CONFIRMED, dispatchDropId: id }, data: { status: OrderStatus.DELIVERED } });
        if (transitioned.count !== 1) throw new ConflictException('Order changed before delivery completion.');
        await tx.orderStatusEvent.create({ data: { orderId: order.id, fromStatus: OrderStatus.CONFIRMED, toStatus: OrderStatus.DELIVERED, actorStaffUserId, note: 'Delivered through Dispatch Drop.' } });
      }
      return tx.dispatchDrop.findUniqueOrThrow({ where: { id }, include: dropInclude });
    });
  }

  async driverToday(actorStaffUserId: string) {
    const settings = await this.prisma.kitchenSettings.findUniqueOrThrow({ where: { key: 'GLOBAL' } });
    const today = parseDate(DateTime.now().setZone(settings.timezone).toISODate()!);
    const drops = await this.prisma.dispatchDrop.findMany({ where: { assignedDriverId: actorStaffUserId, deliveryDate: today }, orderBy: { deliveryTimeMinutes: 'asc' }, include: dropInclude });
    return drops.map((drop) => toDropResponse(drop, settings.timezone));
  }

  private async serializable<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Dispatch update conflicted with another request.');
  }
}

function isKitchenReady(order: { lines: Array<{ combinations: Array<{ kitchenCompletedAt: Date | null }> }> }): boolean {
  const combinations = order.lines.flatMap((line) => line.combinations);
  return combinations.length > 0 && combinations.every((combination) => combination.kitchenCompletedAt !== null);
}

function toDropResponse(drop: Prisma.DispatchDropGetPayload<{ include: typeof dropInclude }>, timezone: string) {
  const first = drop.orders[0];
  const combinations = drop.orders.flatMap((order) => order.lines.flatMap((line) => line.combinations));
  const kitchenReadyAt = combinations.length && combinations.every((combination) => combination.kitchenCompletedAt) ? new Date(Math.max(...combinations.map((combination) => combination.kitchenCompletedAt!.getTime()))) : null;
  const plan = calculateOrderPlan({ deliveryDate: drop.deliveryDate, deliveryTimeMinutes: drop.deliveryTimeMinutes, deliveryMinutesBeforeSnapshot: first?.deliveryMinutesBeforeSnapshot ?? 0 }, timezone);
  return {
    id: drop.id, groupingKey: drop.groupingKey, status: drop.status, company: drop.company, assignedDriver: drop.assignedDriver,
    deliveryDate: dateKey(drop.deliveryDate), deliveryTimeMinutes: drop.deliveryTimeMinutes,
    deliveryAddress: first ? { label: first.deliveryAddressLabel, addressLine1: first.deliveryAddressLine1, addressLine2: first.deliveryAddressLine2, city: first.deliveryCity, stateRegion: first.deliveryStateRegion, postalCode: first.deliveryPostalCode, country: first.deliveryCountry } : null,
    orderCount: drop.orders.length, orders: drop.orders, kitchenReadyAt, ...plan,
    dispatchReadyAt: drop.dispatchReadyAt, outForDeliveryAt: drop.outForDeliveryAt, deliveredAt: drop.deliveredAt, wasOnTime: drop.wasOnTime, deliveryNote: drop.deliveryNote, deliveryPhotoUrl: drop.deliveryPhotoUrl,
  };
}

function parseDate(value: string): Date { try { return parseHolidayDate(value); } catch { throw new ConflictException('deliveryDate must be a valid calendar date.'); } }
