DROP TABLE IF EXISTS monthly_review;
DROP INDEX IF EXISTS csat_followup_idx;
ALTER TABLE csat_response DROP COLUMN IF EXISTS followup_note, DROP COLUMN IF EXISTS followup_at,
  DROP COLUMN IF EXISTS followup_by, DROP COLUMN IF EXISTS followup_status;
UPDATE case_message SET source = 'web' WHERE source = 'phone';
ALTER TABLE case_message DROP CONSTRAINT IF EXISTS case_message_source_check;
ALTER TABLE case_message ADD CONSTRAINT case_message_source_check
  CHECK (source IN ('web', 'email', 'api', 'system'));
ALTER TABLE support_case DROP COLUMN IF EXISTS channel;
