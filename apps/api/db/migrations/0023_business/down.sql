DROP TABLE IF EXISTS idea_vote;
DROP TABLE IF EXISTS idea;
ALTER TABLE product DROP CONSTRAINT IF EXISTS product_replacement_not_self,
  DROP COLUMN IF EXISTS lifecycle_note, DROP COLUMN IF EXISTS replacement_product_id;
DROP FUNCTION IF EXISTS wd.on_shift(uuid, boolean) CASCADE;
DROP TABLE IF EXISTS oncall_shift;
DROP TABLE IF EXISTS renewal_digest;
DROP INDEX IF EXISTS renewal_request_open_contract_uq;
ALTER TABLE renewal_request DROP CONSTRAINT IF EXISTS renewal_request_target_check;
ALTER TABLE renewal_request DROP COLUMN IF EXISTS contract_id;
DROP TABLE IF EXISTS invoice;
DROP TABLE IF EXISTS contract;
-- route_case: re-apply 0016 to restore the previous behaviour.
