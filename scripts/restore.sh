#!/usr/bin/env bash
# Restore the Havoro database from a backup.
# Usage: ./scripts/restore.sh /path/to/havoro-YYYY-MM-DD.db
set -euo pipefail

BACKUP="$1"
DB_PATH="${DB_PATH:-/app/data/havoro.db}"

if [[ -z "$BACKUP" ]]; then
  echo "Usage: $0 /path/to/backup.db"
  exit 1
fi

if [[ ! -f "$BACKUP" ]]; then
  echo "Backup file not found: $BACKUP"
  exit 1
fi

# Verify the backup is a valid SQLite database
if ! sqlite3 "$BACKUP" "PRAGMA integrity_check;" | grep -q "^ok$"; then
  echo "Integrity check failed on $BACKUP — aborting"
  exit 1
fi

# Keep a safety copy of the current DB
if [[ -f "$DB_PATH" ]]; then
  SAFETY="${DB_PATH}.pre-restore-$(date +%s)"
  cp "$DB_PATH" "$SAFETY"
  echo "Saved current DB to $SAFETY"
fi

cp "$BACKUP" "$DB_PATH"
echo "Restored $BACKUP to $DB_PATH"
echo "Restart the server to apply."
