import { DateTime } from 'luxon';

import { combineLocalDateAndTime } from './time.util';

export interface OrderPlanningInput {
  deliveryDate: Date;
  deliveryTimeMinutes: number;
  deliveryMinutesBeforeSnapshot: number;
}

export function calculateOrderPlan(input: OrderPlanningInput, timezone: string) {
  const localDate = DateTime.fromJSDate(input.deliveryDate, { zone: 'utc' }).toISODate();
  if (!localDate) throw new RangeError('Could not determine the Order delivery date.');
  const hours = Math.floor(input.deliveryTimeMinutes / 60);
  const minutes = input.deliveryTimeMinutes % 60;
  const plannedDeliveryAt = combineLocalDateAndTime(localDate, `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`, timezone).toUTC().toJSDate();
  const plannedDispatchReadyAt = DateTime.fromJSDate(plannedDeliveryAt).minus({ minutes: input.deliveryMinutesBeforeSnapshot }).toJSDate();
  const plannedKitchenReadyAt = DateTime.fromJSDate(plannedDispatchReadyAt).minus({ minutes: 30 }).toJSDate();
  return { plannedDeliveryAt, plannedDispatchReadyAt, plannedKitchenReadyAt };
}

export function kitchenRisk(kitchenReadyAt: Date | null, plannedKitchenReadyAt: Date, now = new Date()) {
  if (kitchenReadyAt) return { late: false, atRisk: false };
  const planned = plannedKitchenReadyAt.getTime();
  const instant = now.getTime();
  return {
    late: instant > planned,
    atRisk: instant <= planned && instant >= planned - 30 * 60 * 1000,
  };
}
