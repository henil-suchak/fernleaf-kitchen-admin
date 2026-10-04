import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { normalizeCatalogueName } from '../catalogue/catalogue-name.util';
import { PrismaService } from '../prisma/prisma.service';
import { PricingResolver } from '../pricing/pricing-resolver.service';
import type { CreateMenuCategoryItemDto, UpdateMenuCategoryItemDto } from './dto/menu-category-item.dto';
import type { CreateMenuCategoryDto, UpdateMenuCategoryDto } from './dto/menu-category.dto';
import type { ReplaceCompanyMenuHidingDto } from './dto/replace-company-menu-hiding.dto';

const categoryInclude = Prisma.validator<Prisma.MenuCategoryInclude>()({
  items: {
    orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
    include: {
      dish: {
        include: {
          dishAllergens: { include: { allergen: true }, orderBy: { allergen: { name: 'asc' } } },
          dishDietaryTags: { include: { dietaryTag: true }, orderBy: { dietaryTag: { name: 'asc' } } },
          dishOptionGroups: {
            orderBy: { sortOrder: 'asc' },
            include: {
              optionGroup: {
                include: {
                  optionGroupOptions: {
                    orderBy: { sortOrder: 'asc' },
                    include: {
                      option: {
                        include: {
                          optionAllergens: { include: { allergen: true }, orderBy: { allergen: { name: 'asc' } } },
                          optionDietaryTags: { include: { dietaryTag: true }, orderBy: { dietaryTag: { name: 'asc' } } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  },
});

type CategoryRecord = Prisma.MenuCategoryGetPayload<{ include: typeof categoryInclude }>;

@Injectable()
export class MenuService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly pricingResolver: PricingResolver,
  ) {}

  async listCategories() {
    const categories = await this.prisma.menuCategory.findMany({
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: { items: { orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }], include: { dish: { select: { id: true, name: true, isActive: true } } } } },
    });
    return categories;
  }

  async getCategory(id: string) {
    const category = await this.prisma.menuCategory.findUnique({ where: { id }, include: categoryInclude });
    if (!category) throw new NotFoundException('Menu category not found.');
    return category;
  }

  async createCategory(input: CreateMenuCategoryDto) {
    try {
      return await this.prisma.menuCategory.create({
        data: { ...normalizeCatalogueName(input.name), sortOrder: input.sortOrder, isSecret: input.isSecret ?? false, isActive: input.isActive ?? true },
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('Menu category name already exists.');
      throw error;
    }
  }

  async updateCategory(id: string, input: UpdateMenuCategoryDto) {
    if (Object.values(input).every((value) => value === undefined)) {
      throw new BadRequestException('At least one menu category field must be provided.');
    }
    try {
      return await this.prisma.menuCategory.update({
        where: { id },
        data: {
          ...(input.name === undefined ? {} : normalizeCatalogueName(input.name)),
          ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }),
          ...(input.isSecret === undefined ? {} : { isSecret: input.isSecret }),
          ...(input.isActive === undefined ? {} : { isActive: input.isActive }),
        },
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('Menu category name already exists.');
      if (isNotFoundError(error)) throw new NotFoundException('Menu category not found.');
      throw error;
    }
  }

  async createItem(categoryId: string, input: CreateMenuCategoryItemDto) {
    const [category, dish] = await Promise.all([
      this.prisma.menuCategory.findUnique({ where: { id: categoryId }, select: { isActive: true } }),
      this.prisma.dish.findUnique({ where: { id: input.dishId }, select: { isActive: true } }),
    ]);
    if (!category) throw new NotFoundException('Menu category not found.');
    if (!dish) throw new NotFoundException('Dish not found.');
    if (!category.isActive || !dish.isActive) throw new BadRequestException('Category and Dish must be active for a new Menu placement.');
    try {
      return await this.prisma.menuCategoryItem.create({
        data: { categoryId, dishId: input.dishId, sortOrder: input.sortOrder, isActive: input.isActive ?? true },
      });
    } catch (error) {
      if (isUniqueError(error)) throw new ConflictException('Dish already exists in this Menu category.');
      throw error;
    }
  }

  async updateItem(categoryId: string, itemId: string, input: UpdateMenuCategoryItemDto) {
    if (input.sortOrder === undefined && input.isActive === undefined) {
      throw new BadRequestException('At least one menu item field must be provided.');
    }
    const item = await this.prisma.menuCategoryItem.findFirst({ where: { id: itemId, categoryId }, select: { id: true } });
    if (!item) throw new NotFoundException('Menu category item not found.');
    return this.prisma.menuCategoryItem.update({
      where: { id: itemId },
      data: { ...(input.sortOrder === undefined ? {} : { sortOrder: input.sortOrder }), ...(input.isActive === undefined ? {} : { isActive: input.isActive }) },
    });
  }

  async replaceCompanyHiding(companyId: string, input: ReplaceCompanyMenuHidingDto) {
    assertUnique(input.categoryIds, 'categoryIds');
    assertUnique(input.menuItemIds, 'menuItemIds');
    return this.prisma.$transaction(async (tx) => {
      const [company, categories, items] = await Promise.all([
        tx.company.findUnique({ where: { id: companyId }, select: { id: true } }),
        tx.menuCategory.findMany({ where: { id: { in: input.categoryIds } }, select: { id: true } }),
        tx.menuCategoryItem.findMany({ where: { id: { in: input.menuItemIds } }, select: { id: true } }),
      ]);
      if (!company) throw new NotFoundException('Company not found.');
      if (categories.length !== input.categoryIds.length) throw new NotFoundException('Menu category not found.');
      if (items.length !== input.menuItemIds.length) throw new NotFoundException('Menu category item not found.');
      await tx.companyHiddenMenuCategory.deleteMany({ where: { companyId } });
      await tx.companyHiddenMenuItem.deleteMany({ where: { companyId } });
      if (input.categoryIds.length) await tx.companyHiddenMenuCategory.createMany({ data: input.categoryIds.map((categoryId) => ({ companyId, categoryId })) });
      if (input.menuItemIds.length) await tx.companyHiddenMenuItem.createMany({ data: input.menuItemIds.map((menuCategoryItemId) => ({ companyId, menuCategoryItemId })) });
      return { categoryIds: input.categoryIds, menuItemIds: input.menuItemIds };
    });
  }

  async previewEmployeeMenu(employeeId: string) {
    return this.preview(employeeId, null, false);
  }

  async previewEmployeeCategory(employeeId: string, categoryId: string) {
    const preview = await this.preview(employeeId, categoryId, true);
    if (!preview.categories.length) throw new NotFoundException('Menu category is not available for this Employee.');
    return { ...preview, category: preview.categories[0] };
  }

  async getOrderableDishForEmployee(employeeId: string, dishId: string) {
    const preview = await this.preview(employeeId, null, true);
    const item = preview.categories.flatMap((category) => category.items).find((candidate) => candidate.dish.id === dishId);
    if (!item) throw new NotFoundException('Dish is not orderable for this Employee.');
    return { ...item, effectivePricingTier: preview.effectivePricingTier };
  }

  private async preview(employeeId: string, categoryId: string | null, includeSecret: boolean) {
    const employee = await this.prisma.employee.findUnique({
      where: { id: employeeId },
      select: {
        id: true, name: true, isActive: true,
        company: { select: { id: true, name: true, isActive: true, pricingTierId: true, hiddenMenuCategories: { select: { categoryId: true } }, hiddenMenuItems: { select: { menuCategoryItemId: true } } } },
      },
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    if (!employee.isActive || !employee.company.isActive) throw new BadRequestException('Employee and Company must be active to preview Menu.');
    const tier = await this.pricingResolver.resolveEffectivePricingTier(employee.company.pricingTierId);
    const categories = await this.prisma.menuCategory.findMany({
      where: categoryId ? { id: categoryId } : { isActive: true, ...(includeSecret ? {} : { isSecret: false }) },
      orderBy: [{ sortOrder: 'asc' }, { id: 'asc' }],
      include: categoryInclude,
    });
    const hiddenCategories = new Set(employee.company.hiddenMenuCategories.map((row) => row.categoryId));
    const hiddenItems = new Set(employee.company.hiddenMenuItems.map((row) => row.menuCategoryItemId));
    const resolved = await Promise.all(categories.map((category) => this.resolveCategory(category, tier.id, hiddenCategories, hiddenItems, includeSecret)));
    const visible = resolved.filter((category): category is NonNullable<typeof category> => category !== null);
    return { employee: { id: employee.id, name: employee.name }, company: { id: employee.company.id, name: employee.company.name }, effectivePricingTier: tier, categories: visible };
  }

  private async resolveCategory(category: CategoryRecord, tierId: string, hiddenCategories: Set<string>, hiddenItems: Set<string>, includeSecret: boolean) {
    if (!category.isActive || hiddenCategories.has(category.id) || (!includeSecret && category.isSecret)) return null;
    const items = await Promise.all(category.items.map((item) => this.resolveItem(item, tierId, hiddenItems)));
    const visibleItems = items.filter((item): item is NonNullable<typeof item> => item !== null);
    return visibleItems.length ? { id: category.id, name: category.name, sortOrder: category.sortOrder, items: visibleItems } : null;
  }

  private async resolveItem(item: CategoryRecord['items'][number], tierId: string, hiddenItems: Set<string>) {
    if (!item.isActive || hiddenItems.has(item.id) || !item.dish.isActive) return null;
    const dishPrice = await this.pricingResolver.resolveDishPrice(item.dishId, tierId);
    if (!dishPrice.available) return null;
    const optionGroups = [] as Array<{ id: string; name: string; isRequired: boolean; sortOrder: number; options: Array<{ id: string; name: string; allergens: Array<{ id: string; name: string }>; dietaryTags: Array<{ id: string; name: string }>; resolvedPriceMinorUnits: number }> }>;
    for (const groupLink of item.dish.dishOptionGroups) {
      const group = groupLink.optionGroup;
      const options = [] as (typeof optionGroups)[number]['options'];
      if (group.isActive) {
        for (const optionLink of group.optionGroupOptions) {
          const option = optionLink.option;
          if (!option.isActive) continue;
          const optionPrice = await this.pricingResolver.resolveOptionPrice(option.id, tierId);
          if (!optionPrice.available) continue;
          options.push({ id: option.id, name: option.name, allergens: option.optionAllergens.map(({ allergen }) => ({ id: allergen.id, name: allergen.name })), dietaryTags: option.optionDietaryTags.map(({ dietaryTag }) => ({ id: dietaryTag.id, name: dietaryTag.name })), resolvedPriceMinorUnits: optionPrice.priceMinorUnits });
        }
      }
      if (groupLink.isRequired && !options.length) return null;
      if (options.length) optionGroups.push({ id: group.id, name: group.name, isRequired: groupLink.isRequired, sortOrder: groupLink.sortOrder, options });
    }
    return { menuItemId: item.id, dish: { id: item.dish.id, name: item.dish.name, description: item.dish.description, imageUrl: item.dish.imageUrl, sku: item.dish.sku, temperature: item.dish.temperature, minimumOrderQuantity: item.dish.minimumQuantity, allergens: item.dish.dishAllergens.map(({ allergen }) => ({ id: allergen.id, name: allergen.name })), dietaryTags: item.dish.dishDietaryTags.map(({ dietaryTag }) => ({ id: dietaryTag.id, name: dietaryTag.name })) }, resolvedPriceMinorUnits: dishPrice.priceMinorUnits, optionGroups };
  }
}

function assertUnique(values: readonly string[], field: string): void {
  if (new Set(values).size !== values.length) throw new BadRequestException(`${field} must not contain duplicate IDs.`);
}

function isUniqueError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
}

function isNotFoundError(error: unknown): boolean {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025';
}
