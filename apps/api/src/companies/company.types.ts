import type { Weekday } from '@prisma/client';

export interface CompanyPricingTierSummary {
  id: string;
  name: string;
  derivationSource: 'BASE_TIER' | 'ITEM_COST' | null;
}

export interface CompanyDefaultDriverSummary {
  id: string;
  email: string;
  role: { code: string; name: string };
}

export interface CompanyDomainResponse {
  id: string;
  domain: string;
  createdAt: string;
}

export interface CompanyAddressResponse {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateRegion: string;
  postalCode: string;
  country: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyHolidayResponse {
  id: string;
  date: string;
  name: string | null;
  createdAt: string;
}

export interface CompanySummaryResponse {
  id: string;
  name: string;
  isActive: boolean;
  pricingTier: CompanyPricingTierSummary | null;
  createdAt: string;
  updatedAt: string;
}

export interface CompanyResponse extends CompanySummaryResponse {
  billingContact: { name: string; email: string; phone: string | null };
  workingDays: Weekday[];
  defaultDeliveryTime: string;
  deliveryMinutesBefore: number;
  defaultPackaging: string;
  driverInstructions: string | null;
  defaultDriver: CompanyDefaultDriverSummary | null;
  domains: CompanyDomainResponse[];
  addresses: CompanyAddressResponse[];
  holidays: CompanyHolidayResponse[];
}
