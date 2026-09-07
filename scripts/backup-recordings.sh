#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

root_dir="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
recordings_dir="${RECORDINGS_DIR:-$root_dir/recordings}"
backup_dir="${BACKUP_DIR:-$root_dir/backups}"
backup_retention_days="${BACKUP_RETENTION_DAYS:-30}"
recipient="${BACKUP_AGE_RECIPIENT:-}"

[[ -d "$recordings_dir" ]] || {
  echo "Recordings directory does not exist: $recordings_dir" >&2
  exit 1
}
[[ -n "$recipient" ]] || {
  echo "BACKUP_AGE_RECIPIENT is required." >&2
  exit 1
}
[[ "$backup_retention_days" =~ ^[0-9]+$ ]] || {
  echo "BACKUP_RETENTION_DAYS must be a non-negative integer." >&2
  exit 1
}
command -v age >/dev/null || {
  echo "age is required to create encrypted backups." >&2
  exit 1
}

install -d -m 0700 "$backup_dir"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
archive_name="recordings-$timestamp.tar.gz.age"
temporary_file="$backup_dir/.$archive_name.tmp"
archive_file="$backup_dir/$archive_name"
snapshot_dir="$(mktemp -d "$backup_dir/.monitor-snapshot.XXXXXX")"

cleanup() {
  rm -f "$temporary_file"
  rm -rf "$snapshot_dir"
}
trap cleanup EXIT

# SQLite readers can create/remove queue WAL files even with the evaluator stopped.
install -d -m 0700 "$snapshot_dir/$(basename "$recordings_dir")"
node "$root_dir/scripts/snapshot-monitor.js" "$recordings_dir/monitor/alerts.sqlite" "$snapshot_dir/$(basename "$recordings_dir")/monitor-backup.sqlite"
node "$root_dir/scripts/snapshot-monitor.js" "$recordings_dir/queue.sqlite" "$snapshot_dir/$(basename "$recordings_dir")/queue-backup.sqlite"
snapshot_files=()
if [[ -f "$snapshot_dir/$(basename "$recordings_dir")/monitor-backup.sqlite" ]]; then
  snapshot_files+=("$(basename "$recordings_dir")/monitor-backup.sqlite")
fi
if [[ -f "$snapshot_dir/$(basename "$recordings_dir")/queue-backup.sqlite" ]]; then
  snapshot_files+=("$(basename "$recordings_dir")/queue-backup.sqlite")
fi
# Omit the changing root directory header while preserving checks on its contents.
shopt -s nullglob dotglob
touch "$snapshot_dir/files"
for entry in "$recordings_dir"/*; do
  case "$(basename "$entry")" in
    monitor|tmp|lost+found|queue.sqlite|queue.sqlite-wal|queue.sqlite-shm) continue ;;
  esac
  printf '%s\0' "$(basename "$recordings_dir")/$(basename "$entry")" >> "$snapshot_dir/files"
done
shopt -u nullglob dotglob
archive_entries=(--null -T "$snapshot_dir/files")
# BSD tar applies later -C operands to -T entries; keep its entries positional.
if [[ "$(tar --version)" == *bsdtar* ]]; then
  archive_entries=()
  while IFS= read -r -d '' entry; do archive_entries+=("$entry"); done < "$snapshot_dir/files"
fi

(
cd "$(dirname "$recordings_dir")"
tar \
  --exclude="$(basename "$recordings_dir")/tmp" \
  --exclude="$(basename "$recordings_dir")/lost+found" \
  --exclude="$(basename "$recordings_dir")/monitor" \
  -czf - "${archive_entries[@]}" -C "$snapshot_dir" "${snapshot_files[@]}"
) | age --encrypt --recipient "$recipient" --output "$temporary_file"

chmod 0600 "$temporary_file"
mv "$temporary_file" "$archive_file"
rm -rf "$snapshot_dir"
trap - EXIT

if command -v sha256sum >/dev/null; then
  (cd "$backup_dir" && sha256sum "$archive_name" > "$archive_name.sha256")
else
  (cd "$backup_dir" && shasum -a 256 "$archive_name" > "$archive_name.sha256")
fi
chmod 0600 "$archive_file.sha256"

find "$backup_dir" -type f \
  \( -name 'recordings-*.tar.gz.age' -o -name 'recordings-*.tar.gz.age.sha256' \) \
  -mtime "+$backup_retention_days" -delete

echo "Encrypted recording backup created: $archive_file"
