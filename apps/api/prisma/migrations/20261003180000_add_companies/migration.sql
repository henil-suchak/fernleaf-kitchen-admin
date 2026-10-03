CREATE TABLE "Company" (
    "id" UUID NOT NULL,
    "name" VARCHAR(160) NOT NULL,
    "normalizedName" VARCHAR(160) NOT NULL,
    "billingContactName" VARCHAR(120) NOT NULL,
    "billingContactEmail" VARCHAR(320) NOT NULL,
    "billingContactPhone" VARCHAR(32),
    "workingDays" "Weekday"[] DEFAULT ARRAY['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY']::"Weekday"[],
    "defaultDeliveryTimeMinutes" INTEGER NOT NULL DEFAULT 750,
    "deliveryMinutesBefore" INTEGER NOT NULL DEFAULT 60,
    "defaultPackaging" VARCHAR(40) NOT NULL,
    "driverInstructions" VARCHAR(1000),
    "pricingTierId" UUID,
    "defaultDriverId" UUID,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Company_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyEmailDomain" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "domain" VARCHAR(253) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyEmailDomain_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyAddress" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "label" VARCHAR(80) NOT NULL,
    "addressLine1" VARCHAR(160) NOT NULL,
    "addressLine2" VARCHAR(160),
    "city" VARCHAR(80) NOT NULL,
    "stateRegion" VARCHAR(80) NOT NULL,
    "postalCode" VARCHAR(32) NOT NULL,
    "country" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CompanyAddress_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CompanyHoliday" (
    "id" UUID NOT NULL,
    "companyId" UUID NOT NULL,
    "date" DATE NOT NULL,
    "name" VARCHAR(120),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CompanyHoliday_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "CompanyEmailDomain_domain_key" ON "CompanyEmailDomain"("domain");
CREATE UNIQUE INDEX "CompanyHoliday_companyId_date_key" ON "CompanyHoliday"("companyId", "date");

ALTER TABLE "Company" ADD CONSTRAINT "Company_pricingTierId_fkey" FOREIGN KEY ("pricingTierId") REFERENCES "PricingTier"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Company" ADD CONSTRAINT "Company_defaultDriverId_fkey" FOREIGN KEY ("defaultDriverId") REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyEmailDomain" ADD CONSTRAINT "CompanyEmailDomain_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CompanyAddress" ADD CONSTRAINT "CompanyAddress_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CompanyHoliday" ADD CONSTRAINT "CompanyHoliday_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;
