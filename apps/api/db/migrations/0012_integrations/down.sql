DROP TABLE IF EXISTS webhook_delivery, webhook, api_key;
DROP FUNCTION IF EXISTS wd.resolve_api_key(text);
DROP FUNCTION IF EXISTS wd.touch_api_key(uuid);
