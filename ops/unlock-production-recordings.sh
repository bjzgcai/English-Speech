#!/usr/bin/env bash

set -Eeuo pipefail

target="${TARGET:-ubuntu@10.1.130.9}"
key_file="${LUKS_KEY_FILE:-}"
container="/opt/englisheval/recordings.luks"
mapping="englisheval-recordings"
mountpoint="/opt/englisheval/shared/recordings"

[[ -n "$key_file" && -f "$key_file" ]] || {
  echo "Set LUKS_KEY_FILE to the protected off-server key file." >&2
  echo "LUKS key not found: $key_file" >&2
  exit 1
}

if ! ssh "$target" "sudo cryptsetup status '$mapping' >/dev/null 2>&1"; then
  ssh "$target" \
    "sudo cryptsetup open --type luks2 --key-file - '$container' '$mapping'" \
    < "$key_file"
fi

ssh "$target" "set -eu
if ! mountpoint -q '$mountpoint'; then
  sudo mount '$mountpoint'
fi
sudo systemctl start englisheval-recording-maintenance.timer
sudo systemctl start englisheval.service
attempt=0
while [ \$attempt -lt 15 ]; do
  if curl --fail --silent --show-error --max-time 2 http://127.0.0.1:3199/ >/dev/null 2>&1; then
    echo 'Encrypted recordings unlocked; EnglishEval is healthy.'
    exit 0
  fi
  attempt=\$((attempt + 1))
  sleep 1
done
systemctl status englisheval.service --no-pager -l
exit 1"
