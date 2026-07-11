#!/usr/bin/env bash
# Backup the Havoro SQLite database.
# Run this as a cron job: 0 2 * * * /path/to/scripts/backup.sh
set -euo pipefail

DB_PATH="${DB_PATH:-/app/data/havoro.db}"
BACKUP_DIR="${BACKUP_DIR:-/backup/havoro}"
KEEP_DAYS="${KEEP_DAYS:-30}"

DATE=$(date +%Y-%m-%d)
mkdir -p "$BACKUP_DIR"

DEST="$BACKUP_DIR/havoro-$DATE.db"

# sqlite3 online backup (safe while DB is live)
if command -v sqlite3 &>/dev/null; then
  sqlite3 "$DB_PATH" ".backup '$DEST'"
else
  cp "$DB_PATH" "$DEST"
fi

echo "Backed up to $DEST"

# Prune old backups
find "$BACKUP_DIR" -name "havoro-*.db" -mtime "+$KEEP_DAYS" -delete
echo "Pruned backups older than $KEEP_DAYS days"

# Optional: rclone to off-site encrypted storage
# Uncomment and configure rclone first: https://rclone.org/
# rclone copy "$DEST" remote:havoro-backups/
