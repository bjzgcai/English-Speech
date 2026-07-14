#!/usr/bin/env bash

set -Eeuo pipefail

target="${TARGET:-ubuntu@10.1.130.9}"
mapping="englisheval-recordings"
mountpoint="/opt/englisheval/shared/recordings"

ssh "$target" "set -eu
sudo systemctl stop englisheval-recording-maintenance.timer
sudo systemctl stop englisheval.service
if mountpoint -q '$mountpoint'; then
  sudo umount '$mountpoint'
fi
if sudo cryptsetup status '$mapping' >/dev/null 2>&1; then
  sudo cryptsetup close '$mapping'
fi
echo 'EnglishEval stopped; encrypted recordings locked.'"
