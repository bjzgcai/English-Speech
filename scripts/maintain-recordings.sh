#!/usr/bin/env bash

set -Eeuo pipefail

root_dir="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

# The encrypted backup is the only stop-the-world step: deploy.sh generates the
# maintenance unit without stop/start lines when RECORDING_BACKUP_ENABLED is
# false, so the unit and this script must agree on the same value. Retention
# and the orphan sweep stay unconditional — both are cross-process-lock-safe
# and take seconds with the application live.
if [[ "${RECORDING_BACKUP_ENABLED:-true}" == "true" ]]; then
  "$root_dir/scripts/backup-recordings.sh"
else
  echo "Recording backup disabled (RECORDING_BACKUP_ENABLED=false); skipping."
fi
node "$root_dir/scripts/enforce-recording-retention.js"
node "$root_dir/scripts/sweep-orphaned-uploads.js"
