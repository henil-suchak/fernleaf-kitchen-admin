-- CreateTable
CREATE TABLE "MenuCategory" (
    "id" UUID NOT NULL,
    "name" VARCHAR(80) NOT NULL,
    "normalizedName" VARCHAR(80) NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isSecret" BOOLEAN NOT NULL DEFAULT false,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MenuCategoryItem" (
    "id" UUID NOT NULL,
    "categoryId" UUID NOT NULL,
    "dishId" UUID NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MenuCategoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CompanyHiddenMenuCategory" (
    "companyId" UUID NOT NULL,
    "categoryId" UUID NOT NULL,

    CONSTRAINT "CompanyHiddenMenuCategory_pkey" PRIMARY KEY ("companyId","categoryId")
);

-- CreateTable
CREATE TABLE "CompanyHiddenMenuItem" (
    "companyId" UUID NOT NULL,
    "menuCategoryItemId" UUID NOT NULL,

    CONSTRAINT "CompanyHiddenMenuItem_pkey" PRIMARY KEY ("companyId","menuCategoryItemId")
);

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategory_normalizedName_key" ON "MenuCategory"("normalizedName");

-- CreateIndex
CREATE UNIQUE INDEX "MenuCategoryItem_categoryId_dishId_key" ON "MenuCategoryItem"("categoryId", "dishId");

-- AddForeignKey
ALTER TABLE "MenuCategoryItem" ADD CONSTRAINT "MenuCategoryItem_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MenuCategoryItem" ADD CONSTRAINT "MenuCategoryItem_dishId_fkey" FOREIGN KEY ("dishId") REFERENCES "Dish"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHiddenMenuCategory" ADD CONSTRAINT "CompanyHiddenMenuCategory_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHiddenMenuCategory" ADD CONSTRAINT "CompanyHiddenMenuCategory_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "MenuCategory"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHiddenMenuItem" ADD CONSTRAINT "CompanyHiddenMenuItem_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "Company"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CompanyHiddenMenuItem" ADD CONSTRAINT "CompanyHiddenMenuItem_menuCategoryItemId_fkey" FOREIGN KEY ("menuCategoryItemId") REFERENCES "MenuCategoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
