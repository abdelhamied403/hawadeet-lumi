#!/usr/bin/env bash
# Run on the laptop, from apps/server. Copies the backend to the VM (the other apps stay here):
#   ./deploy/push.sh ubuntu@1.2.3.4              code and assets only (for later updates)
#   ./deploy/push.sh ubuntu@1.2.3.4 --with-data  also .env, the database and every episode (first move)
# Extra ssh options (such as a key file) go in SSH_OPTS: SSH_OPTS="-i ~/.ssh/oracle.key" ./deploy/push.sh ...
set -euo pipefail

TARGET="${1:?Usage: ./deploy/push.sh <user@host> [--with-data]}"
WITH_DATA="${2:-}"
cd "$(dirname "$0")/.."
SSH="ssh ${SSH_OPTS:-}"

if [ "$WITH_DATA" = "--with-data" ]; then
  # Two servers working the same episodes would start every job twice.
  if systemctl --user is-active --quiet veogen-server; then
    read -r -p "This stops and disables the Veogen server on this laptop, so only the VM runs the pipeline. Continue? [y/N] " ANSWER
    [ "$ANSWER" = "y" ] || exit 1
    systemctl --user disable --now veogen-server
  fi
fi

$SSH "$TARGET" "mkdir -p veogen"
rsync -az --delete -e "$SSH" \
  --exclude node_modules \
  --exclude output --exclude .env \
  ./ "$TARGET:veogen/"

if [ "$WITH_DATA" = "--with-data" ]; then
  # The login lines are left out so the VM keeps its own.
  grep -v -E '^(AUTH_PASSWORD|JWT_SECRET|HOST|WEB_ORIGIN)=' .env | $SSH "$TARGET" "umask 077 && cat > veogen/.env.laptop && { grep -E '^(AUTH_PASSWORD|JWT_SECRET)=' veogen/.env 2>/dev/null || true; } >> veogen/.env.laptop && mv veogen/.env.laptop veogen/.env"
  sqlite3 output/veogen.sqlite "PRAGMA wal_checkpoint(TRUNCATE);" >/dev/null
  rsync -az -e "$SSH" --exclude sample --exclude reel-001 --exclude '*.sqlite-wal' --exclude '*.sqlite-shm' output/ "$TARGET:veogen/output/"
fi

# Restart only when the service already exists (after the first setup-vm.sh run).
$SSH "$TARGET" 'cd veogen && if systemctl list-unit-files veogen.service | grep -q veogen; then ~/.bun/bin/bun install --production && sudo systemctl restart veogen && echo "Veogen restarted."; else echo "Copied. Now run on the VM: cd veogen && ./deploy/setup-vm.sh <your domain>"; fi'
