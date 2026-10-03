-- 0046_supply_gaps.migration.sql

ALTER TABLE disposals
ADD COLUMN photo_url text;

-- We could also add a configuration for adjustment value thresholds if needed, but we can just hardcode or add to tenant_preferences.
