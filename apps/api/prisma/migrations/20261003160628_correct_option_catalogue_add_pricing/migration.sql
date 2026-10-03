-- CreateEnum
CREATE TYPE "PricingTierMode" AS ENUM ('DIRECT', 'DERIVED');

-- CreateEnum
CREATE TYPE "PricingDerivationSource" AS ENUM ('BASE_TIER', 'ITEM_COST');

-- AlterTable
ALTER TABLE "Option" ADD COLUMN     "costMinorUnits" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "OptionAllergen" (
    "optionId" UUID NOT NULL,
    "allergenId" UUID NOT NULL,

    CONSTRAINT "OptionAllergen_pkey" PRIMARY KEY ("optionId","allergenId")
);

-- CreateTable
CREATE TABLE "OptionDietaryTag" (
    "optionId" UUID NOT NULL,
    "dietaryTagId" UUID NOT NULL,

    CONSTRAINT "OptionDietaryTag_pkey" PRIMARY KEY ("optionId","dietaryTagId")
);

-- CreateTable
CREATE TABLE "PricingTier" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "isDefault" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "pricingMode" "PricingTierMode" NOT NULL,
    "derivationSource" "PricingDerivationSource",
    "baseTierId" UUID,
    "multiplierBps" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingTier_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DishTierPrice" (
    "pricingTierId" UUID NOT NULL,
    "dishId" UUID NOT NULL,
    "explicitPriceMinorUnits" INTEGER NOT NULL,

    CONSTRAINT "DishTierPrice_pkey" PRIMARY KEY ("pricingTierId","dishId")
);

-- CreateTable
CREATE TABLE "OptionTierPrice" (
    "pricingTierId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "explicitPriceMinorUnits" INTEGER NOT NULL,

    CONSTRAINT "OptionTierPrice_pkey" PRIMARY KEY ("pricingTierId","optionId")
);

-- CreateIndex
CREATE UNIQUE INDEX "PricingTier_normalizedName_key" ON "PricingTier"("normalizedName");

-- AddForeignKey
ALTER TABLE "OptionAllergen" ADD CONSTRAINT "OptionAllergen_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionAllergen" ADD CONSTRAINT "OptionAllergen_allergenId_fkey" FOREIGN KEY ("allergenId") REFERENCES "Allergen"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionDietaryTag" ADD CONSTRAINT "OptionDietaryTag_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionDietaryTag" ADD CONSTRAINT "OptionDietaryTag_dietaryTagId_fkey" FOREIGN KEY ("dietaryTagId") REFERENCES "DietaryTag"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingTier" ADD CONSTRAINT "PricingTier_baseTierId_fkey" FOREIGN KEY ("baseTierId") REFERENCES "PricingTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DishTierPrice" ADD CONSTRAINT "DishTierPrice_pricingTierId_fkey" FOREIGN KEY ("pricingTierId") REFERENCES "PricingTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DishTierPrice" ADD CONSTRAINT "DishTierPrice_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionTierPrice" ADD CONSTRAINT "OptionTierPrice_pricingTierId_fkey" FOREIGN KEY ("pricingTierId") REFERENCES "PricingTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OptionTierPrice" ADD CONSTRAINT "OptionTierPrice_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
