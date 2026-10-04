-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('DRAFT', 'PLACED', 'CONFIRMED', 'DELIVERED', 'CANCELLED', 'REJECTED');

-- CreateTable
CREATE TABLE "Order" (
    "id" UUID NOT NULL,
    "employeeId" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "effectivePricingTierId" UUID NOT NULL,
    "pricingTierNameSnapshot" VARCHAR(80) NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'DRAFT',
    "deliveryDate" DATE NOT NULL,
    "cutoffAt" TIMESTAMPTZ(3) NOT NULL,
    "sourceCompanyAddressId" UUID NOT NULL,
    "deliveryAddressLabel" VARCHAR(80) NOT NULL,
    "deliveryAddressLine1" VARCHAR(160) NOT NULL,
    "deliveryAddressLine2" VARCHAR(160),
    "deliveryCity" VARCHAR(80) NOT NULL,
    "deliveryStateRegion" VARCHAR(80) NOT NULL,
    "deliveryPostalCode" VARCHAR(32) NOT NULL,
    "deliveryCountry" VARCHAR(80) NOT NULL,
    "deliveryTimeMinutes" INTEGER NOT NULL,
    "deliveryMinutesBeforeSnapshot" INTEGER NOT NULL,
    "packaging" VARCHAR(40) NOT NULL,
    "driverInstructionsSnapshot" VARCHAR(1000),
    "totalMinorUnits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderLine" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "dishId" UUID NOT NULL,
    "dishNameSnapshot" VARCHAR(120) NOT NULL,
    "dishSkuSnapshot" VARCHAR(64) NOT NULL,
    "kitchenStationId" UUID,
    "kitchenStationNameSnapshot" VARCHAR(80),
    "quantity" INTEGER NOT NULL,
    "dishUnitPriceMinorUnits" INTEGER NOT NULL,
    "lineTotalMinorUnits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderLine_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCombination" (
    "id" UUID NOT NULL,
    "orderLineId" UUID NOT NULL,
    "selectionKey" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceMinorUnits" INTEGER NOT NULL,
    "totalMinorUnits" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderCombination_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OrderCombinationOption" (
    "orderCombinationId" UUID NOT NULL,
    "optionGroupId" UUID NOT NULL,
    "optionId" UUID NOT NULL,
    "optionGroupNameSnapshot" VARCHAR(80) NOT NULL,
    "optionNameSnapshot" VARCHAR(80) NOT NULL,
    "optionUnitPriceMinorUnits" INTEGER NOT NULL,

    CONSTRAINT "OrderCombinationOption_pkey" PRIMARY KEY ("orderCombinationId","optionGroupId")
);

-- CreateTable
CREATE TABLE "OrderStatusEvent" (
    "id" UUID NOT NULL,
    "orderId" UUID NOT NULL,
    "fromStatus" "OrderStatus",
    "toStatus" "OrderStatus" NOT NULL,
    "occurredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorStaffUserId" UUID,
    "note" VARCHAR(500),

    CONSTRAINT "OrderStatusEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Order_deliveryDate_status_idx" ON "Order"("deliveryDate", "status");
CREATE INDEX "Order_companyId_deliveryDate_idx" ON "Order"("companyId", "deliveryDate");
CREATE INDEX "Order_employeeId_deliveryDate_idx" ON "Order"("employeeId", "deliveryDate");
CREATE INDEX "Order_effectivePricingTierId_idx" ON "Order"("effectivePricingTierId");
CREATE UNIQUE INDEX "OrderLine_orderId_dishId_key" ON "OrderLine"("orderId", "dishId");
CREATE INDEX "OrderLine_kitchenStationId_idx" ON "OrderLine"("kitchenStationId");
CREATE UNIQUE INDEX "OrderCombination_orderLineId_selectionKey_key" ON "OrderCombination"("orderLineId", "selectionKey");
CREATE INDEX "OrderCombinationOption_optionId_idx" ON "OrderCombinationOption"("optionId");
CREATE INDEX "OrderStatusEvent_orderId_occurredAt_idx" ON "OrderStatusEvent"("orderId", "occurredAt");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_employeeId_fkey" FOREIGN KEY ("employeeId") REFERENCES "Employee"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_effectivePricingTierId_fkey" FOREIGN KEY ("effectivePricingTierId") REFERENCES "PricingTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Order" ADD CONSTRAINT "Order_sourceCompanyAddressId_fkey" FOREIGN KEY ("sourceCompanyAddressId") REFERENCES "CompanyAddress"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderLine" ADD CONSTRAINT "OrderLine_kitchenStationId_fkey" FOREIGN KEY ("kitchenStationId") REFERENCES "KitchenStation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderCombination" ADD CONSTRAINT "OrderCombination_orderLineId_fkey" FOREIGN KEY ("orderLineId") REFERENCES "OrderLine"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderCombinationOption" ADD CONSTRAINT "OrderCombinationOption_orderCombinationId_fkey" FOREIGN KEY ("orderCombinationId") REFERENCES "OrderCombination"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderCombinationOption" ADD CONSTRAINT "OrderCombinationOption_optionGroupId_fkey" FOREIGN KEY ("optionGroupId") REFERENCES "OptionGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderCombinationOption" ADD CONSTRAINT "OrderCombinationOption_optionId_fkey" FOREIGN KEY ("optionId") REFERENCES "Option"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrderStatusEvent" ADD CONSTRAINT "OrderStatusEvent_actorStaffUserId_fkey" FOREIGN KEY ("actorStaffUserId") REFERENCES "StaffUser"("id") ON DELETE SET NULL ON UPDATE CASCADE;
