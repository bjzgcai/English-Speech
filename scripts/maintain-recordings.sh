#!/usr/bin/env bash

set -Eeuo pipefail

root_dir="${APP_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"

"$root_dir/scripts/backup-recordings.sh"
node "$root_dir/scripts/enforce-recording-retention.js"
