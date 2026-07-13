#!/usr/bin/env bash

set -Eeuo pipefail

TARGET="${TARGET:-ubuntu@10.1.130.9}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/englisheval}"
APP_PORT="${APP_PORT:-3199}"
PUBLIC_BASE_URL="${PUBLIC_BASE_URL:-}"
SERVICE_NAME="${SERVICE_NAME:-englisheval}"
MIGRATE_DATA=false

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [--migrate-data]

Deploy EnglishEval to the configured SSH target. Code is installed as a
versioned release while .env, recordings, questions, and comments remain in shared
persistent storage.

Options:
  --migrate-data  Copy local recordings/, questions/, and comments/ on the first migration.
                  The command refuses to overwrite non-empty remote data.
  -h, --help      Show this help.

Environment overrides:
  TARGET, REMOTE_ROOT, APP_PORT, SERVICE_NAME
  PUBLIC_BASE_URL (required HTTPS URL served by the TLS reverse proxy)
EOF
}

while (($#)); do
  case "$1" in
    --migrate-data) MIGRATE_DATA=true ;;
    -h|--help) usage; exit 0 ;;
    *) echo "Unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

for command in ssh rsync curl; do
  command -v "$command" >/dev/null || {
    echo "Required command not found: $command" >&2
    exit 1
  }
done

[[ -f package.json && -f package-lock.json && -f server.js ]] || {
  echo "Run this script from the EnglishEval repository root." >&2
  exit 1
}
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && ((APP_PORT >= 1 && APP_PORT <= 65535)) || {
  echo "APP_PORT must be an integer from 1 to 65535." >&2
  exit 1
}
[[ "$PUBLIC_BASE_URL" == https://* ]] || {
  echo "PUBLIC_BASE_URL must be set to the HTTPS URL exposed by the TLS reverse proxy." >&2
  exit 1
}

release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
release_dir="$REMOTE_ROOT/releases/$release_id"
remote_user="$(ssh "$TARGET" 'id -un')"
remote_group="$(ssh "$TARGET" 'id -gn')"
echo "Deploying release $release_id to $TARGET:$REMOTE_ROOT"
ssh "$TARGET" "sudo install -d -o '$remote_user' -g '$remote_group' '$REMOTE_ROOT' '$REMOTE_ROOT/releases' '$REMOTE_ROOT/shared' '$REMOTE_ROOT/shared/recordings' '$REMOTE_ROOT/shared/questions' '$REMOTE_ROOT/shared/comments' '$REMOTE_ROOT/backups' && mkdir -p '$release_dir'"
ssh "$TARGET" "test -f '$REMOTE_ROOT/shared/.env'" || {
  echo "Missing production environment at $REMOTE_ROOT/shared/.env; refusing to deploy." >&2
  exit 1
}
ssh "$TARGET" "grep -Eq '^APP_BASE_URL=https://[^[:space:]]+$' '$REMOTE_ROOT/shared/.env' && grep -Eq '^COOKIE_SECURE=true$' '$REMOTE_ROOT/shared/.env'" || {
  echo "Production .env must set an HTTPS APP_BASE_URL and COOKIE_SECURE=true." >&2
  exit 1
}

rsync -az --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude 'node_modules/' \
  --exclude 'recordings/' \
  --exclude 'questions/' \
  --exclude 'comments/' \
  --exclude '.DS_Store' \
  ./ "$TARGET:$release_dir/"

if [[ "$MIGRATE_DATA" == true ]]; then
  remote_data_count="$(ssh "$TARGET" "find '$REMOTE_ROOT/shared/recordings' '$REMOTE_ROOT/shared/questions' '$REMOTE_ROOT/shared/comments' -type f 2>/dev/null | wc -l")"
  if [[ "$remote_data_count" != "0" ]]; then
    echo "Remote persistent storage is not empty; refusing to overwrite it." >&2
    echo "Back up and reconcile remote data manually before retrying." >&2
    exit 1
  fi

  backup_name="before-migration-$release_id.tar.gz"
  ssh "$TARGET" "tar -C '$REMOTE_ROOT/shared' -czf '$REMOTE_ROOT/backups/$backup_name' recordings questions comments"
  rsync -az recordings/ "$TARGET:$REMOTE_ROOT/shared/recordings/"
  rsync -az questions/ "$TARGET:$REMOTE_ROOT/shared/questions/"
  if [[ -d comments ]]; then
    rsync -az comments/ "$TARGET:$REMOTE_ROOT/shared/comments/"
  fi
  echo "Migrated local persistent data (remote backup: $REMOTE_ROOT/backups/$backup_name)."
fi

ssh "$TARGET" "cd '$release_dir' && npm ci --omit=dev --no-audit --no-fund"
ssh "$TARGET" "ln -sfn '$REMOTE_ROOT/shared/recordings' '$release_dir/recordings' && ln -sfn '$REMOTE_ROOT/shared/questions' '$release_dir/questions' && ln -sfn '$REMOTE_ROOT/shared/comments' '$release_dir/comments' && ln -sfn '$REMOTE_ROOT/shared/.env' '$release_dir/.env'"

previous_release="$(ssh "$TARGET" "readlink -f '$REMOTE_ROOT/current' 2>/dev/null || true")"

ssh "$TARGET" "sudo tee '/etc/systemd/system/$SERVICE_NAME.service' >/dev/null <<'UNIT'
[Unit]
Description=EnglishEval web service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$remote_user
Group=$remote_group
WorkingDirectory=$REMOTE_ROOT/current
EnvironmentFile=$REMOTE_ROOT/shared/.env
ExecStart=/usr/bin/node $REMOTE_ROOT/current/server.js
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
UNIT
ln -sfn '$release_dir' '$REMOTE_ROOT/current'
sudo systemctl daemon-reload
sudo systemctl enable --now '$SERVICE_NAME.service'
sudo systemctl restart '$SERVICE_NAME.service'
if command -v ufw >/dev/null && sudo ufw status | grep -q '^Status: active'; then
  sudo ufw allow '$APP_PORT/tcp' >/dev/null
fi"

if ! ssh "$TARGET" "curl --fail --silent --show-error --max-time 10 'http://127.0.0.1:$APP_PORT/' >/dev/null"; then
  echo "Health check failed; restoring the previous release." >&2
  if [[ -n "$previous_release" ]]; then
    ssh "$TARGET" "ln -sfn '$previous_release' '$REMOTE_ROOT/current' && sudo systemctl restart '$SERVICE_NAME.service'"
  else
    ssh "$TARGET" "sudo systemctl stop '$SERVICE_NAME.service'"
  fi
  exit 1
fi

ssh "$TARGET" "cd '$REMOTE_ROOT/releases' && ls -1dt */ 2>/dev/null | tail -n +6 | xargs -r rm -rf"

echo "Deployment succeeded: $PUBLIC_BASE_URL"
