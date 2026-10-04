import { ConflictException, Injectable } from '@nestjs/common';
import { DispatchDropStatus, OrderStatus, Prisma } from '@prisma/client';

import { PermissionCode } from '../authorization/permission-code';
import { PrismaService } from '../prisma/prisma.service';
import { dispatchGroupingKey } from './dispatch-grouping.util';

type Transaction = Prisma.TransactionClient;
export const DELIVERY_DRIVER_PERMISSIONS = [
  PermissionCode.DELIVERY_OWN_READ,
  PermissionCode.DELIVERY_OWN_UPDATE,
] as const;

@Injectable()
export class DispatchDropManager {
  constructor(private readonly prisma: PrismaService) {}

  async syncDate(tx: Transaction, deliveryDate: Date): Promise<void> {
    const orders = await tx.order.findMany({ where: { deliveryDate, status: OrderStatus.CONFIRMED }, select: { id: true } });
    for (const order of orders) await this.syncOrder(tx, order.id);
  }

  async syncOrder(tx: Transaction, orderId: string): Promise<string | null> {
    const order = await tx.order.findUnique({ where: { id: orderId }, include: { company: { select: { id: true, defaultDriverId: true } } } });
    if (!order || order.status !== OrderStatus.CONFIRMED) return null;
    const groupingKey = dispatchGroupingKey(order);
    if (order.dispatchDropId) {
      const current = await tx.dispatchDrop.findUnique({ where: { id: order.dispatchDropId }, select: { id: true, groupingKey: true, status: true } });
      if (current?.groupingKey === groupingKey) return current.id;
      if (current?.status === DispatchDropStatus.OUT_FOR_DELIVERY || current?.status === DispatchDropStatus.DELIVERED) throw new ConflictException('Order cannot be regrouped after delivery execution has started.');
      await tx.order.update({ where: { id: orderId }, data: { dispatchDropId: null } });
      if (current) await this.cleanupEmptyDrop(tx, current.id);
    }
    let drop = await tx.dispatchDrop.findUnique({ where: { groupingKey } });
    if (!drop) {
      const assignedDriverId = order.company.defaultDriverId && await this.isDeliveryCapable(tx, order.company.defaultDriverId) ? order.company.defaultDriverId : null;
      drop = await tx.dispatchDrop.create({ data: { groupingKey, companyId: order.companyId, deliveryDate: order.deliveryDate, deliveryTimeMinutes: order.deliveryTimeMinutes, assignedDriverId } });
    }
    const updated = await tx.order.updateMany({ where: { id: orderId, status: OrderStatus.CONFIRMED, dispatchDropId: null }, data: { dispatchDropId: drop.id } });
    if (updated.count !== 1) throw new ConflictException('Order changed before Dispatch grouping.');
    return drop.id;
  }

  async detachForCancellation(tx: Transaction, orderId: string): Promise<void> {
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { dispatchDropId: true } });
    if (!order?.dispatchDropId) return;
    const drop = await tx.dispatchDrop.findUnique({ where: { id: order.dispatchDropId }, select: { id: true, status: true } });
    if (drop && (drop.status === DispatchDropStatus.OUT_FOR_DELIVERY || drop.status === DispatchDropStatus.DELIVERED)) throw new ConflictException('Order cannot be cancelled after delivery execution has started.');
    await tx.order.update({ where: { id: orderId }, data: { dispatchDropId: null } });
    if (drop) await this.cleanupEmptyDrop(tx, drop.id);
  }

  async assertLogisticsChangeAllowed(tx: Transaction, orderId: string, changesGrouping: boolean): Promise<void> {
    if (!changesGrouping) return;
    const order = await tx.order.findUnique({ where: { id: orderId }, select: { dispatchDrop: { select: { status: true } } } });
    if (order?.dispatchDrop && (order.dispatchDrop.status === DispatchDropStatus.OUT_FOR_DELIVERY || order.dispatchDrop.status === DispatchDropStatus.DELIVERED)) throw new ConflictException('Address and delivery-time changes are not allowed after delivery execution has started.');
  }

  async regroupAfterLogisticsChange(tx: Transaction, orderId: string): Promise<void> {
    await this.syncOrder(tx, orderId);
  }

  async isDeliveryCapable(tx: Transaction | PrismaService, staffUserId: string): Promise<boolean> {
    const user = await tx.staffUser.findUnique({ where: { id: staffUserId }, select: { isActive: true, role: { select: { rolePermissions: { where: { permission: { code: { in: [...DELIVERY_DRIVER_PERMISSIONS] } } }, select: { permission: { select: { code: true } } } } } } } });
    if (!user?.isActive) return false;
    const granted = new Set(user.role.rolePermissions.map(({ permission }) => permission.code));
    return DELIVERY_DRIVER_PERMISSIONS.every((permission) => granted.has(permission));
  }

  async listDeliveryCapableStaff() {
    return this.prisma.staffUser.findMany({
      where: {
        isActive: true,
        AND: DELIVERY_DRIVER_PERMISSIONS.map((permission) => ({
          role: { rolePermissions: { some: { permission: { code: permission } } } },
        })),
      },
      orderBy: [{ email: 'asc' }, { id: 'asc' }],
      select: { id: true, email: true, role: { select: { code: true, name: true } } },
    });
  }

  private async cleanupEmptyDrop(tx: Transaction, dropId: string): Promise<void> {
    const drop = await tx.dispatchDrop.findUnique({ where: { id: dropId }, select: { status: true, _count: { select: { orders: true } } } });
    if (drop && drop._count.orders === 0 && drop.status !== DispatchDropStatus.OUT_FOR_DELIVERY && drop.status !== DispatchDropStatus.DELIVERED) await tx.dispatchDrop.delete({ where: { id: dropId } });
  }
}
