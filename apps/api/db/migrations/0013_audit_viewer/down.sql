REVOKE EXECUTE ON FUNCTION wd.audit_verify() FROM wd_app;
DROP INDEX IF EXISTS audit_log_actor_idx;
DROP INDEX IF EXISTS audit_log_action_idx;
