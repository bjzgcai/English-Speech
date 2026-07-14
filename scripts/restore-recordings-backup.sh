#!/usr/bin/env bash

set -Eeuo pipefail
umask 077

if [[ $# -ne 3 ]]; then
  echo "Usage: $0 BACKUP_FILE AGE_IDENTITY_FILE EMPTY_DESTINATION" >&2
  exit 2
fi

backup_file="$1"
identity_file="$2"
destination="$3"

command -v age >/dev/null || {
  echo "age is required to restore encrypted backups." >&2
  exit 1
}
[[ -f "$backup_file" ]] || {
  echo "Backup file not found: $backup_file" >&2
  exit 1
}
[[ -f "$identity_file" ]] || {
  echo "Age identity file not found: $identity_file" >&2
  exit 1
}

install -d -m 0700 "$destination"
if find "$destination" -mindepth 1 -print -quit | grep -q .; then
  echo "Restore destination must be empty: $destination" >&2
  exit 1
fi

age --decrypt --identity "$identity_file" "$backup_file" \
  | tar -tzf - \
  | awk '
      $0 !~ /^recordings(\/|$)/ || $0 ~ /(^|\/)\.\.(\/|$)/ { invalid = 1 }
      END { exit invalid }
    '
age --decrypt --identity "$identity_file" "$backup_file" \
  | tar --no-same-owner --no-same-permissions -xzf - -C "$destination"
find "$destination" -type d -exec chmod 0700 {} +
find "$destination" -type f -exec chmod 0600 {} +
echo "Backup restored into: $destination"
