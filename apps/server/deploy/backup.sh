#!/usr/bin/env bash
# Run on the laptop, from apps/server. Pulls a copy of everything the VM holds (database, episodes, .env):
#   ./deploy/backup.sh ubuntu@1.2.3.4                 into ~/veogen-backup
#   ./deploy/backup.sh ubuntu@1.2.3.4 /path/to/folder into that folder
# Each run updates the same folder, so only new and changed files are downloaded.
# Extra ssh options (such as a key file) go in SSH_OPTS, as with push.sh.
set -euo pipefail

TARGET="${1:?Usage: ./deploy/backup.sh <user@host> [folder]}"
DEST="${2:-$HOME/veogen-backup}"
SSH="ssh ${SSH_OPTS:-}"

mkdir -p "$DEST/output"
chmod 700 "$DEST"

# A snapshot taken by the database itself is consistent even while the server is writing.
$SSH "$TARGET" 'cd veogen && rm -f output/backup.sqlite && ~/.bun/bin/bun -e "
  const { Database } = require(\"bun:sqlite\");
  new Database(\"output/veogen.sqlite\").exec(\"VACUUM INTO \\\"output/backup.sqlite\\\"\");
"'
rsync -az --delete -e "$SSH" --exclude 'veogen.sqlite*' "$TARGET:veogen/output/" "$DEST/output/"
mv "$DEST/output/backup.sqlite" "$DEST/output/veogen.sqlite"
$SSH "$TARGET" 'rm -f veogen/output/backup.sqlite'
rsync -az -e "$SSH" "$TARGET:veogen/.env" "$DEST/.env"
chmod 600 "$DEST/.env"

echo "Backed up to $DEST ($(du -sh "$DEST" | cut -f1)) at $(date '+%Y-%m-%d %H:%M')."
