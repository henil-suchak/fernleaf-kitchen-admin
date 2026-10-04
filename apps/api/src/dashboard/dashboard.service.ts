import { Injectable } from '@nestjs/common';
import { DispatchDropStatus, OrderStatus } from '@prisma/client';

import { sumMinorUnits } from '../common/money/money.util';
import { calculateOrderPlan, kitchenRisk } from '../common/time/order-planning.util';
import { todayInTimeZone } from '../common/time/time.util';
import { dateKey } from '../dispatch/dispatch-grouping.util';
import { PrismaService } from '../prisma/prisma.service';
import { parseHolidayDate } from '../settings/settings-date.util';

const billableStatuses: OrderStatus[] = [OrderStatus.CONFIRMED, OrderStatus.DELIVERED];

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaService) {}

  async admin() {
    const { date, label, timezone } = await this.today();
    const [orders, drops] = await Promise.all([
      this.prisma.order.findMany({ where: { deliveryDate: date }, include: { lines: { include: { combinations: true } } } }),
      this.findOperationalDrops(date),
    ]);
    const kitchen = this.kitchenRiskSummary(orders, timezone);
    return {
      today: label,
      ordersByStatus: countByEnum(orders, (order) => order.status, Object.values(OrderStatus)),
      todayConfirmedOrderValue: sumMinorUnits(orders.filter((order) => billableStatuses.includes(order.status)).map((order) => order.totalMinorUnits)),
      todayUninvoicedBillableValue: sumMinorUnits(orders.filter((order) => billableStatuses.includes(order.status) && order.invoiceId === null).map((order) => order.totalMinorUnits)),
      lateKitchenOrderCount: kitchen.late,
      atRiskKitchenOrderCount: kitchen.atRisk,
      dropsByStatus: countByEnum(drops, (drop) => drop.status, Object.values(DispatchDropStatus)),
      unassignedActiveDropCount: drops.filter((drop) => drop.assignedDriverId === null && (drop.status === DispatchDropStatus.WAITING_KITCHEN || drop.status === DispatchDropStatus.DISPATCH_READY)).length,
    };
  }

  async kitchen() {
    const { date, label, timezone } = await this.today();
    const orders = await this.prisma.order.findMany({
      where: { deliveryDate: date, status: OrderStatus.CONFIRMED },
      include: { lines: { include: { combinations: true } } },
    });
    const units = orders.flatMap((order) => order.lines.flatMap((line) => line.combinations.map((combination) => ({ line, combination }))));
    const stations = new Map<string, { stationId: string | null; stationName: string; total: number; notStarted: number; inProgress: number; completed: number }>();
    for (const unit of units) {
      const key = unit.line.kitchenStationId ?? 'UNASSIGNED';
      const current = stations.get(key) ?? { stationId: unit.line.kitchenStationId, stationName: unit.line.kitchenStationNameSnapshot ?? 'Unassigned', total: 0, notStarted: 0, inProgress: 0, completed: 0 };
      current.total += 1;
      if (unit.combination.kitchenCompletedAt) current.completed += 1;
      else if (unit.combination.kitchenStartedAt) current.inProgress += 1;
      else current.notStarted += 1;
      stations.set(key, current);
    }
    const risk = this.kitchenRiskSummary(orders, timezone);
    return {
      today: label,
      prepUnitCounts: {
        total: units.length,
        notStarted: units.filter((unit) => unit.combination.kitchenStartedAt === null && unit.combination.kitchenCompletedAt === null).length,
        inProgress: units.filter((unit) => unit.combination.kitchenStartedAt !== null && unit.combination.kitchenCompletedAt === null).length,
        completed: units.filter((unit) => unit.combination.kitchenCompletedAt !== null).length,
      },
      lateOrderCount: risk.late,
      atRiskOrderCount: risk.atRisk,
      stationBreakdown: [...stations.values()].sort((left, right) => left.stationName.localeCompare(right.stationName)),
    };
  }

  async dispatch() {
    const { date, label, timezone } = await this.today();
    const drops = await this.findOperationalDrops(date);
    const now = new Date();
    const deliveryTimes = drops.map((drop) => ({ drop, plannedDeliveryAt: calculateOrderPlan({ deliveryDate: drop.deliveryDate, deliveryTimeMinutes: drop.deliveryTimeMinutes, deliveryMinutesBeforeSnapshot: 0 }, timezone).plannedDeliveryAt }));
    return {
      today: label,
      dropsByStatus: countByEnum(drops, (drop) => drop.status, Object.values(DispatchDropStatus)),
      unassignedDriverCount: drops.filter((drop) => drop.assignedDriverId === null && (drop.status === DispatchDropStatus.WAITING_KITCHEN || drop.status === DispatchDropStatus.DISPATCH_READY)).length,
      deliveryAtRiskCount: deliveryTimes.filter(({ drop, plannedDeliveryAt }) => drop.status !== DispatchDropStatus.DELIVERED && now >= new Date(plannedDeliveryAt.getTime() - 30 * 60_000) && now <= plannedDeliveryAt).length,
      overdueActiveDropCount: deliveryTimes.filter(({ drop, plannedDeliveryAt }) => drop.status !== DispatchDropStatus.DELIVERED && now > plannedDeliveryAt).length,
    };
  }

  async driver(staffUserId: string) {
    const { date, label, timezone } = await this.today();
    const drops = await this.prisma.dispatchDrop.findMany({
      where: { assignedDriverId: staffUserId, deliveryDate: date, orders: { some: { status: { in: billableStatuses } } } },
      orderBy: { deliveryTimeMinutes: 'asc' },
      include: { company: { select: { id: true, name: true } }, orders: { orderBy: { createdAt: 'asc' }, take: 1, select: { id: true, deliveryAddressLabel: true, deliveryAddressLine1: true, deliveryAddressLine2: true, deliveryCity: true, deliveryStateRegion: true, deliveryPostalCode: true, deliveryCountry: true } } },
    });
    const responses = drops.map((drop) => ({
      id: drop.id,
      status: drop.status,
      company: drop.company,
      deliveryDate: dateKey(drop.deliveryDate),
      deliveryTimeMinutes: drop.deliveryTimeMinutes,
      plannedDeliveryAt: calculateOrderPlan({ deliveryDate: drop.deliveryDate, deliveryTimeMinutes: drop.deliveryTimeMinutes, deliveryMinutesBeforeSnapshot: 0 }, timezone).plannedDeliveryAt,
      deliveryAddress: drop.orders[0] ? { label: drop.orders[0].deliveryAddressLabel, addressLine1: drop.orders[0].deliveryAddressLine1, addressLine2: drop.orders[0].deliveryAddressLine2, city: drop.orders[0].deliveryCity, stateRegion: drop.orders[0].deliveryStateRegion, postalCode: drop.orders[0].deliveryPostalCode, country: drop.orders[0].deliveryCountry } : null,
      wasOnTime: drop.wasOnTime,
    }));
    return {
      today: label,
      totalDropCount: responses.length,
      nextDelivery: responses.find((drop) => drop.status !== DispatchDropStatus.DELIVERED) ?? null,
      remainingDeliveryCount: responses.filter((drop) => drop.status !== DispatchDropStatus.DELIVERED).length,
      deliveredCount: responses.filter((drop) => drop.status === DispatchDropStatus.DELIVERED).length,
      onTimeDeliveredCount: responses.filter((drop) => drop.status === DispatchDropStatus.DELIVERED && drop.wasOnTime === true).length,
      drops: responses,
    };
  }

  private async today() {
    const settings = await this.prisma.kitchenSettings.findUniqueOrThrow({ where: { key: 'GLOBAL' } });
    const label = todayInTimeZone(settings.timezone);
    return { date: parseHolidayDate(label), label, timezone: settings.timezone };
  }

  private findOperationalDrops(deliveryDate: Date) {
    return this.prisma.dispatchDrop.findMany({ where: { deliveryDate, orders: { some: { status: { in: billableStatuses } } } } });
  }

  private kitchenRiskSummary(orders: Array<{ status: OrderStatus; deliveryDate: Date; deliveryTimeMinutes: number; deliveryMinutesBeforeSnapshot: number; lines: Array<{ combinations: Array<{ kitchenCompletedAt: Date | null }> }> }>, timezone: string) {
    let late = 0;
    let atRisk = 0;
    for (const order of orders.filter((candidate) => candidate.status === OrderStatus.CONFIRMED)) {
      const combinations = order.lines.flatMap((line) => line.combinations);
      const completed = combinations.map((combination) => combination.kitchenCompletedAt).filter((value): value is Date => value !== null);
      const kitchenReadyAt = combinations.length > 0 && completed.length === combinations.length ? new Date(Math.max(...completed.map((value) => value.getTime()))) : null;
      const risk = kitchenRisk(kitchenReadyAt, calculateOrderPlan(order, timezone).plannedKitchenReadyAt);
      if (risk.late) late += 1;
      if (risk.atRisk) atRisk += 1;
    }
    return { late, atRisk };
  }
}

function countByEnum<T, TValue extends string>(items: T[], value: (item: T) => TValue, values: TValue[]): Record<TValue, number> {
  const counts = Object.fromEntries(values.map((entry) => [entry, 0])) as Record<TValue, number>;
  for (const item of items) counts[value(item)] += 1;
  return counts;
}
