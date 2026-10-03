-- CreateIndex
CREATE UNIQUE INDEX "PricingTier_one_default" ON "PricingTier"("isDefault") WHERE "isDefault" = true;
