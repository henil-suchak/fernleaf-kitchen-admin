import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';

import { calculateOrderPlan, kitchenRisk } from '../common/time/order-planning.util';
import { PrismaService } from '../prisma/prisma.service';
import { parseHolidayDate } from '../settings/settings-date.util';
import type { KitchenBoardQueryDto } from './dto/kitchen-board-query.dto';

type Transaction = Prisma.TransactionClient;

@Injectable()
export class KitchenService {
  constructor(private readonly prisma: PrismaService) {}

  async board(query: KitchenBoardQueryDto) {
    const deliveryDate = parseDate(query.deliveryDate);
    const settings = await this.prisma.kitchenSettings.findUniqueOrThrow({ where: { key: 'GLOBAL' } });
    const orders = await this.prisma.order.findMany({
      where: { status: OrderStatus.CONFIRMED, deliveryDate, ...(query.stationId ? { lines: { some: { kitchenStationId: query.stationId } } } : {}) },
      orderBy: [{ deliveryTimeMinutes: 'asc' }, { createdAt: 'asc' }],
      include: {
        company: { select: { id: true, name: true } },
        employee: { select: { id: true, name: true, email: true } },
        lines: { orderBy: { createdAt: 'asc' }, include: { combinations: { orderBy: { createdAt: 'asc' }, include: { selectedOptions: { orderBy: { optionGroupId: 'asc' } } } } } },
      },
    });
    return orders.map((order) => {
      const units = order.lines.flatMap((line) => line.combinations.map((combination) => ({
        id: combination.id, quantity: combination.quantity, startedAt: combination.kitchenStartedAt, completedAt: combination.kitchenCompletedAt,
        dish: { id: line.dishId, name: line.dishNameSnapshot, sku: line.dishSkuSnapshot },
        station: line.kitchenStationId ? { id: line.kitchenStationId, name: line.kitchenStationNameSnapshot } : { id: null, name: 'Unassigned' },
        selectedOptions: combination.selectedOptions,
      }))).filter((unit) => !query.stationId || unit.station.id === query.stationId);
      const allCombinations = order.lines.flatMap((line) => line.combinations);
      const started = allCombinations.map((combination) => combination.kitchenStartedAt).filter((value): value is Date => value !== null);
      const completed = allCombinations.map((combination) => combination.kitchenCompletedAt).filter((value): value is Date => value !== null);
      const kitchenReadyAt = allCombinations.length > 0 && completed.length === allCombinations.length ? new Date(Math.max(...completed.map((value) => value.getTime()))) : null;
      const kitchenStartedAt = started.length ? new Date(Math.min(...started.map((value) => value.getTime()))) : null;
      const plan = calculateOrderPlan(order, settings.timezone);
      return { id: order.id, company: order.company, employee: order.employee, deliveryDate: query.deliveryDate, deliveryTimeMinutes: order.deliveryTimeMinutes, ...plan, kitchenStartedAt, kitchenReadyAt, ...kitchenRisk(kitchenReadyAt, plan.plannedKitchenReadyAt), units };
    });
  }

  async start(combinationId: string) {
    const now = new Date();
    const changed = await this.prisma.orderCombination.updateMany({
      where: { id: combinationId, kitchenStartedAt: null, orderLine: { order: { status: OrderStatus.CONFIRMED } } },
      data: { kitchenStartedAt: now },
    });
    if (changed.count === 1) return { combinationId, kitchenStartedAt: now.toISOString() };
    await this.requireCombination(combinationId);
    throw new ConflictException('Prep unit is already started or is not workable.');
  }

  async complete(combinationId: string) {
    return this.serializable(async (tx) => {
      const unit = await tx.orderCombination.findUnique({ where: { id: combinationId }, include: { orderLine: { include: { order: true } } } });
      if (!unit) throw new NotFoundException('Prep unit not found.');
      if (unit.orderLine.order.status !== OrderStatus.CONFIRMED) throw new ConflictException('Only Confirmed Order prep units can be completed.');
      const now = new Date();
      const where: Prisma.OrderCombinationWhereInput = unit.kitchenStartedAt === null
        ? { id: combinationId, kitchenStartedAt: null, kitchenCompletedAt: null }
        : { id: combinationId, kitchenStartedAt: { not: null }, kitchenCompletedAt: null };
      const changed = await tx.orderCombination.updateMany({ where, data: unit.kitchenStartedAt === null ? { kitchenStartedAt: now, kitchenCompletedAt: now } : { kitchenCompletedAt: now } });
      if (changed.count !== 1) throw new ConflictException('Prep unit was already completed or changed by another user.');
      return { combinationId, kitchenStartedAt: now.toISOString(), kitchenCompletedAt: now.toISOString() };
    });
  }

  async forceComplete(orderId: string) {
    return this.serializable(async (tx) => {
      const order = await tx.order.findUnique({ where: { id: orderId }, include: { lines: { include: { combinations: true } } } });
      if (!order) throw new NotFoundException('Order not found.');
      if (order.status !== OrderStatus.CONFIRMED) throw new ConflictException('Only Confirmed Orders can be force-completed.');
      const now = new Date();
      let completed = 0;
      for (const combination of order.lines.flatMap((line) => line.combinations)) {
        if (combination.kitchenCompletedAt) continue;
        const changed = await tx.orderCombination.updateMany({ where: { id: combination.id, kitchenCompletedAt: null }, data: combination.kitchenStartedAt ? { kitchenCompletedAt: now } : { kitchenStartedAt: now, kitchenCompletedAt: now } });
        completed += changed.count;
      }
      return { orderId, completed, at: now.toISOString() };
    });
  }

  private async requireCombination(id: string) { if (!await this.prisma.orderCombination.findUnique({ where: { id }, select: { id: true } })) throw new NotFoundException('Prep unit not found.'); }

  private async serializable<T>(operation: (tx: Transaction) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      try { return await this.prisma.$transaction(operation, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable }); }
      catch (error) {
        if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2034' && attempt < 2) continue;
        throw error;
      }
    }
    throw new ConflictException('Kitchen update conflicted with another request.');
  }
}

function parseDate(value: string): Date { try { return parseHolidayDate(value); } catch { throw new ConflictException('deliveryDate must be a valid calendar date.'); } }
