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

cleanup() {
  rm -f "$temporary_file"
}
trap cleanup EXIT

tar \
  --exclude="$(basename "$recordings_dir")/tmp" \
  --exclude="$(basename "$recordings_dir")/lost+found" \
  -C "$(dirname "$recordings_dir")" \
  -czf - "$(basename "$recordings_dir")" \
  | age --encrypt --recipient "$recipient" --output "$temporary_file"

chmod 0600 "$temporary_file"
mv "$temporary_file" "$archive_file"
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
