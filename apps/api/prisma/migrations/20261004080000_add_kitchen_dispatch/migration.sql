-- AlterTable
ALTER TABLE "Order" ADD COLUMN "dispatchDropId" UUID;
ALTER TABLE "OrderCombination" ADD COLUMN "kitchenStartedAt" TIMESTAMPTZ(3), ADD COLUMN "kitchenCompletedAt" TIMESTAMPTZ(3);

-- CreateEnum
CREATE TYPE "DispatchDropStatus" AS ENUM ('WAITING_KITCHEN', 'DISPATCH_READY', 'OUT_FOR_DELIVERY', 'DELIVERED');

-- CreateTable
CREATE TABLE "DispatchDrop" (
    "id" UUID NOT NULL,
    "groupingKey" VARCHAR(64) NOT NULL,
    "companyId" UUID NOT NULL,
    "deliveryDate" DATE NOT NULL,
    "deliveryTimeMinutes" INTEGER NOT NULL,
    "assignedDriverId" UUID,
    "status" "DispatchDropStatus" NOT NULL DEFAULT 'WAITING_KITCHEN',
    "dispatchReadyAt" TIMESTAMPTZ(3),
    "outForDeliveryAt" TIMESTAMPTZ(3),
    "deliveredAt" TIMESTAMPTZ(3),
    "deliveryNote" VARCHAR(1000),
    "deliveryPhotoUrl" VARCHAR(2048),
    "wasOnTime" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DispatchDrop_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DispatchDrop_groupingKey_key" ON "DispatchDrop"("groupingKey");
CREATE INDEX "DispatchDrop_deliveryDate_status_idx" ON "DispatchDrop"("deliveryDate", "status");
CREATE INDEX "DispatchDrop_companyId_deliveryDate_idx" ON "DispatchDrop"("companyId", "deliveryDate");
CREATE INDEX "DispatchDrop_assignedDriverId_deliveryDate_idx" ON "DispatchDrop"("assignedDriverId", "deliveryDate");
CREATE INDEX "Order_dispatchDropId_idx" ON "Order"("dispatchDropId");

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_dispatchDropId_fkey" FOREIGN KEY ("dispatchDropId") REFERENCES "DispatchDrop"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "DispatchDrop" ADD CONSTRAINT "DispatchDrop_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DispatchDrop" ADD CONSTRAINT "DispatchDrop_assignedDriverId_fkey" FOREIGN KEY ("assignedDriverId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
