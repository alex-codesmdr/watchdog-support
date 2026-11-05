-- 0013: audit-log viewer. The application may run the chain check (read-only) and search by actor.
GRANT EXECUTE ON FUNCTION wd.audit_verify() TO wd_app;
CREATE INDEX IF NOT EXISTS audit_log_actor_idx ON audit_log (actor_id, at DESC);
CREATE INDEX IF NOT EXISTS audit_log_action_idx ON audit_log (action, at DESC);
