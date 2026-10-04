import { createHash } from 'node:crypto';

export interface DispatchGroupingOrder {
  companyId: string;
  deliveryDate: Date;
  deliveryTimeMinutes: number;
  deliveryAddressLabel: string;
  deliveryAddressLine1: string;
  deliveryAddressLine2: string | null;
  deliveryCity: string;
  deliveryStateRegion: string;
  deliveryPostalCode: string;
  deliveryCountry: string;
}

export function dispatchGroupingKey(order: DispatchGroupingOrder): string {
  const fields = [order.companyId, dateKey(order.deliveryDate), String(order.deliveryTimeMinutes), order.deliveryAddressLabel, order.deliveryAddressLine1, order.deliveryAddressLine2 ?? '', order.deliveryCity, order.deliveryStateRegion, order.deliveryPostalCode, order.deliveryCountry]
    .map(normalize);
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}

export function dateKey(date: Date): string { return date.toISOString().slice(0, 10); }
function normalize(value: string): string { return value.trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-US'); }
