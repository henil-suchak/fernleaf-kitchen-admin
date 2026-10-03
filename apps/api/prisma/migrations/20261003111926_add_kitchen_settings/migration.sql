-- CreateEnum
CREATE TYPE "KitchenSettingsKey" AS ENUM ('GLOBAL');

-- CreateEnum
CREATE TYPE "Weekday" AS ENUM ('MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY');

-- CreateTable
CREATE TABLE "KitchenSettings" (
    "key" "KitchenSettingsKey" NOT NULL DEFAULT 'GLOBAL',
    "timezone" VARCHAR(64) NOT NULL,
    "workingDays" "Weekday"[],
    "cutoffWorkingDays" INTEGER NOT NULL,
    "cutoffTimeMinutes" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenSettings_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "KitchenHoliday" (
    "id" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KitchenHoliday_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KitchenHoliday_date_key" ON "KitchenHoliday"("date");
