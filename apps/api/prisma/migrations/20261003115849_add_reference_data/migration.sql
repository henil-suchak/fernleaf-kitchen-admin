-- CreateTable
CREATE TABLE "Allergen" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Allergen_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DietaryTag" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "DietaryTag_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KitchenStation" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenStation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Allergen_normalizedName_key" ON "Allergen"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "DietaryTag_normalizedName_key" ON "DietaryTag"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "KitchenStation_normalizedName_key" ON "KitchenStation"("normalizedName");
