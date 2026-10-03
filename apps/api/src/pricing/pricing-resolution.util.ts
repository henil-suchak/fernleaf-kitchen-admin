import {
  derivePriceMinorUnits,
  assertSupportedPersistedMinorUnits,
} from '../common/money/money.util';
import type { PriceResolution } from './pricing.types';

export interface ResolvablePricingItem {
  isActive: boolean;
  costMinorUnits: number;
}

export interface ResolvablePricingTier {
  isActive: boolean;
  derivationSource: 'BASE_TIER' | 'ITEM_COST' | null;
  multiplierBps: number | null;
}

export function resolvePriceFromValues(
  item: ResolvablePricingItem,
  tier: ResolvablePricingTier,
  explicitPriceMinorUnits: number | null,
  baseExplicitPriceMinorUnits: number | null,
): PriceResolution {
  if (!item.isActive) return { available: false, reason: 'INACTIVE_ITEM' };
  if (!tier.isActive) return { available: false, reason: 'INACTIVE_TIER' };

  if (explicitPriceMinorUnits !== null) {
    assertSupportedPersistedMinorUnits(
      explicitPriceMinorUnits,
      'explicitPriceMinorUnits',
    );
    return {
      available: true,
      priceMinorUnits: explicitPriceMinorUnits,
      source: tier.derivationSource === null ? 'DIRECT' : 'MANUAL_OVERRIDE',
    };
  }

  if (tier.derivationSource === null) {
    return { available: false, reason: 'MISSING_PRICE' };
  }

  if (tier.derivationSource === 'ITEM_COST' && tier.multiplierBps !== null) {
    return {
      available: true,
      priceMinorUnits: derivePriceMinorUnits(
        item.costMinorUnits,
        tier.multiplierBps,
      ),
      source: 'DERIVED_ITEM_COST',
    };
  }

  if (
    tier.derivationSource === 'BASE_TIER' &&
    tier.multiplierBps !== null &&
    baseExplicitPriceMinorUnits !== null
  ) {
    return {
      available: true,
      priceMinorUnits: derivePriceMinorUnits(
        baseExplicitPriceMinorUnits,
        tier.multiplierBps,
      ),
      source: 'DERIVED_BASE_TIER',
    };
  }

  return { available: false, reason: 'MISSING_PRICE' };
}
