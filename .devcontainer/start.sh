#!/usr/bin/env bash
# Starts the WatchDog demo in GitHub Codespaces (also works on any machine with Docker).
# In Codespaces the portal, sign-in and file links get the codespace's https addresses, and every
# secret is generated fresh for this codespace instead of using the shared demo values.
set -euo pipefail
cd "$(dirname "$0")/.."

if [ -n "${CODESPACE_NAME:-}" ]; then
  domain="${GITHUB_CODESPACES_PORT_FORWARDING_DOMAIN:-app.github.dev}"
  export WD_WEB_URL="https://${CODESPACE_NAME}-3000.${domain}"
  export WD_ID_URL="https://${CODESPACE_NAME}-8080.${domain}"
  export WD_S3_URL="https://${CODESPACE_NAME}-8333.${domain}"
  export WD_COOKIE_SECURE=true
else
  export WD_WEB_URL="http://localhost:3000" WD_ID_URL="http://localhost:8080"
fi

secrets=.devcontainer/.secrets
if [ ! -f "$secrets" ]; then
  rnd() { openssl rand -base64 48 | tr -dc 'A-Za-z0-9' | head -c "$1"; }
  {
    echo "WD_SIGNING_KEY=$(rnd 64)"
    echo "WD_WEB_CLIENT_SECRET=$(rnd 40)"
    echo "WD_PROVISIONER_SECRET=$(rnd 40)"
    echo "WD_KC_ADMIN_PASSWORD=$(rnd 24)"
  } > "$secrets"
  chmod 600 "$secrets"
fi
set -a; . "$secrets"; set +a
[ -f .env ] || cp .env.example .env

echo "Building and starting the portal. The first start takes 10 to 20 minutes..."
docker compose up -d --build

echo "Waiting for the sign-in service..."
for _ in $(seq 1 120); do
  curl -sf -o /dev/null http://localhost:8080/realms/watchdog && break
  sleep 5
done

# Point the sign-in clients at this codespace's addresses and secrets. Keycloak re-imports the demo
# realm when its container is recreated, so this runs on every start.
kc() { docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh "$@"; }
kc config credentials --server http://localhost:8080 --realm master --user admin \
  --password "$WD_KC_ADMIN_PASSWORD" >/dev/null 2>&1 ||
  kc config credentials --server http://localhost:8080 --realm master --user admin --password admin >/dev/null
web_id=$(kc get clients -r watchdog -q clientId=wd-web --fields id --format csv --noquotes)
prov_id=$(kc get clients -r watchdog -q clientId=wd-provisioner --fields id --format csv --noquotes)
kc update "clients/${web_id}" -r watchdog \
  -s "redirectUris=[\"${WD_WEB_URL}/auth/callback\"]" \
  -s "webOrigins=[\"${WD_WEB_URL}\"]" \
  -s "attributes.\"post.logout.redirect.uris\"=${WD_WEB_URL}" \
  -s "secret=${WD_WEB_CLIENT_SECRET}"
kc update "clients/${prov_id}" -r watchdog -s "secret=${WD_PROVISIONER_SECRET}"

echo "Waiting for the portal..."
for _ in $(seq 1 60); do
  curl -sf -o /dev/null http://localhost:3000/ && break
  sleep 5
done

cat <<MSG

  WatchDog Support portal is running.

  Open:      ${WD_WEB_URL}
  Emails:    ${WD_WEB_URL/-3000./-8025.}
  Sign in:   any demo account from the README, password Demo@WatchDog2026
             authenticator setup key K5QXIY3IIRXWORDFNVXVI33UOBFWK6JSGAZDM===

MSG
