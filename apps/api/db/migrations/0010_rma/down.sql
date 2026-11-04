ALTER TABLE asset DROP COLUMN IF EXISTS retired_at;
DROP TABLE IF EXISTS rma_event, rma;
DROP FUNCTION IF EXISTS wd.next_rma_number();
DROP SEQUENCE IF EXISTS rma_number_seq;
