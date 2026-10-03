DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM "PricingTier"
    WHERE
      ("pricingMode" = 'DIRECT' AND (
        "derivationSource" IS NOT NULL
        OR "baseTierId" IS NOT NULL
        OR "multiplierBps" IS NOT NULL
      ))
      OR
      ("pricingMode" = 'DERIVED' AND (
        "derivationSource" IS NULL
        OR "multiplierBps" IS NULL
        OR ("derivationSource" = 'BASE_TIER' AND "baseTierId" IS NULL)
        OR ("derivationSource" = 'ITEM_COST' AND "baseTierId" IS NOT NULL)
      ))
  ) THEN
    RAISE EXCEPTION 'PricingTier rows cannot be represented by derivationSource alone.';
  END IF;
END $$;

ALTER TABLE "PricingTier" DROP COLUMN "pricingMode";

DROP TYPE "PricingTierMode";
