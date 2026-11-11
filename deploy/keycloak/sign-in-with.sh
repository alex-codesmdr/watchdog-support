#!/usr/bin/env bash
# Switch on "Sign in with Microsoft" and/or "Sign in with Google" for the WatchDog realm.
#
# Both buttons are already defined in the realm but switched off. Run this once you have registered
# an app with Microsoft (Entra ID) and/or Google, with the redirect address
#   https://<sign-in address>/realms/watchdog/broker/microsoft/endpoint
#   https://<sign-in address>/realms/watchdog/broker/google/endpoint
#
#   MICROSOFT_CLIENT_ID=… MICROSOFT_CLIENT_SECRET=… [MICROSOFT_TENANT=<tenant id>] \
#   GOOGLE_CLIENT_ID=…    GOOGLE_CLIENT_SECRET=… \
#   bash deploy/keycloak/sign-in-with.sh
#
# Set only the pair(s) you want. To switch one off again: SWITCH_OFF=microsoft (or google).
#
# How it stays safe: a Microsoft or Google account only works for someone who already has a WatchDog
# account with the same email. The first time, they confirm with their WatchDog password; every
# sign-in still asks for their WatchDog authenticator code. Nobody can create an account this way.
#
# KCADM defaults to running kcadm inside the docker compose "keycloak" service. Override it for
# another setup, e.g. KCADM=/opt/keycloak/bin/kcadm.sh. KC_URL, KC_ADMIN and KC_ADMIN_PASSWORD
# are the admin sign-in (defaults match docker-compose.yml).
set -euo pipefail
KCADM=${KCADM:-docker compose exec -T keycloak /opt/keycloak/bin/kcadm.sh}
KC_URL=${KC_URL:-http://localhost:8080}
REALM=${REALM:-watchdog}

$KCADM config credentials --server "$KC_URL" --realm master \
  --user "${KC_ADMIN:-admin}" --password "${KC_ADMIN_PASSWORD:-admin}" >/dev/null

configure() { # alias client-id secret [extra -s args…]
  local alias=$1 id=$2 secret=$3
  shift 3
  $KCADM update "identity-provider/instances/$alias" -r "$REALM" \
    -s enabled=true -s trustEmail=false \
    -s firstBrokerLoginFlowAlias=watchdog-link-account \
    -s postBrokerLoginFlowAlias=watchdog-broker-mfa \
    -s "config.clientId=$id" -s "config.clientSecret=$secret" \
    -s config.defaultScope="openid profile email" -s config.syncMode=IMPORT "$@"
  echo "Sign in with $alias: on"
}

if [[ -n "${SWITCH_OFF:-}" ]]; then
  $KCADM update "identity-provider/instances/$SWITCH_OFF" -r "$REALM" -s enabled=false
  echo "Sign in with $SWITCH_OFF: off"
  exit 0
fi

done_any=
if [[ -n "${MICROSOFT_CLIENT_ID:-}" ]]; then
  : "${MICROSOFT_CLIENT_SECRET:?set MICROSOFT_CLIENT_SECRET too}"
  # MICROSOFT_TENANT limits sign-in to one Microsoft directory (a tenant id). The default,
  # "organizations", accepts any work or school account.
  configure microsoft "$MICROSOFT_CLIENT_ID" "$MICROSOFT_CLIENT_SECRET" \
    -s "config.tenant=${MICROSOFT_TENANT:-organizations}"
  done_any=1
fi
if [[ -n "${GOOGLE_CLIENT_ID:-}" ]]; then
  : "${GOOGLE_CLIENT_SECRET:?set GOOGLE_CLIENT_SECRET too}"
  configure google "$GOOGLE_CLIENT_ID" "$GOOGLE_CLIENT_SECRET"
  done_any=1
fi
[[ -n "$done_any" ]] || {
  echo "Nothing to do: set MICROSOFT_CLIENT_ID/SECRET and/or GOOGLE_CLIENT_ID/SECRET." >&2
  exit 1
}
