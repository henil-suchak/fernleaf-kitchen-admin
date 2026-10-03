import type { DishTemperature } from '@prisma/client';

export interface CatalogueValueResponse {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CatalogueReferenceResponse {
  id: string;
  name: string;
  isActive: boolean;
}

export interface DishListItemResponse {
  id: string;
  name: string;
  sku: string;
  temperature: DishTemperature;
  costMinorUnits: number;
  minimumQuantity: number;
  isActive: boolean;
  kitchenStation: CatalogueReferenceResponse | null;
  updatedAt: string;
}

export interface DishOptionResponse extends CatalogueReferenceResponse {
  sortOrder: number;
}

export interface DishOptionGroupResponse extends CatalogueReferenceResponse {
  isRequired: boolean;
  sortOrder: number;
  options: DishOptionResponse[];
}

export interface DishDetailResponse extends DishListItemResponse {
  description: string | null;
  imageUrl: string | null;
  allergens: CatalogueReferenceResponse[];
  dietaryTags: CatalogueReferenceResponse[];
  optionGroups: DishOptionGroupResponse[];
  createdAt: string;
}

export interface OptionGroupDetailResponse extends CatalogueValueResponse {
  options: DishOptionResponse[];
}
