import type { PricingDerivationSource } from '@prisma/client';

export interface PricingTierResponse {
  id: string;
  name: string;
  isDefault: boolean;
  isActive: boolean;
  derivationSource: PricingDerivationSource | null;
  baseTierId: string | null;
  multiplierBps: number | null;
  createdAt: string;
  updatedAt: string;
}

export type PriceResolution =
  | {
      available: true;
      priceMinorUnits: number;
      source:
        | 'DIRECT'
        | 'MANUAL_OVERRIDE'
        | 'DERIVED_BASE_TIER'
        | 'DERIVED_ITEM_COST';
    }
  | {
      available: false;
      reason: 'MISSING_PRICE' | 'INACTIVE_ITEM' | 'INACTIVE_TIER';
    };

export type PricingMatrixItem = PriceResolution & {
  id: string;
  name: string;
  costMinorUnits: number;
  explicitPriceMinorUnits: number | null;
};

export type PricingDishMatrixItem = PricingMatrixItem & {
  sku: string;
};

export interface PricingMatrixResponse {
  tier: PricingTierResponse;
  dishes: PricingDishMatrixItem[];
  options: PricingMatrixItem[];
}

export interface BulkPriceUpdateResponse {
  updated: number;
  removed: number;
}
