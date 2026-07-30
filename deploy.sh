#!/usr/bin/env bash

set -Eeuo pipefail

TARGET="${TARGET:-ubuntu@10.1.130.9}"
REMOTE_ROOT="${REMOTE_ROOT:-/opt/englisheval}"
APP_PORT="${APP_PORT:-3199}"
SERVICE_NAME="${SERVICE_NAME:-englisheval}"
MIGRATE_DATA=false

usage() {
  cat <<'EOF'
Usage: ./deploy.sh [--migrate-data]

Deploy OScanner-Eng to the configured SSH target. Code is installed as a
versioned release while .env, recordings, questions, comments, consents, and ratings remain in shared
persistent storage.

Options:
  --migrate-data  Copy local recordings/, questions/, comments/, consents/, and ratings/ on the first migration.
                  The command refuses to overwrite non-empty remote data.
  -h, --help      Show this help.

Environment overrides:
  TARGET, REMOTE_ROOT, APP_PORT, SERVICE_NAME
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
  echo "Run this script from the OScanner-Eng repository root." >&2
  exit 1
}
[[ "$APP_PORT" =~ ^[0-9]+$ ]] && ((APP_PORT >= 1 && APP_PORT <= 65535)) || {
  echo "APP_PORT must be an integer from 1 to 65535." >&2
  exit 1
}
release_id="$(date -u +%Y%m%dT%H%M%SZ)-$(git rev-parse --short HEAD 2>/dev/null || echo local)"
release_dir="$REMOTE_ROOT/releases/$release_id"
remote_user="$(ssh "$TARGET" 'id -un')"
remote_group="$(ssh "$TARGET" 'id -gn')"
previous_release="$(ssh "$TARGET" "readlink -f '$REMOTE_ROOT/current' 2>/dev/null || true")"
echo "Deploying release $release_id to $TARGET:$REMOTE_ROOT"
ssh "$TARGET" "sudo install -d -m 0750 -o '$remote_user' -g '$remote_group' '$REMOTE_ROOT' '$REMOTE_ROOT/releases' '$REMOTE_ROOT/shared' && sudo install -d -m 0700 -o '$remote_user' -g '$remote_group' '$REMOTE_ROOT/shared/recordings' '$REMOTE_ROOT/shared/questions' '$REMOTE_ROOT/shared/comments' '$REMOTE_ROOT/shared/consents' '$REMOTE_ROOT/shared/ratings' '$REMOTE_ROOT/backups' && mkdir -p '$release_dir'"
ssh "$TARGET" "test -f '$REMOTE_ROOT/shared/.env' && test -f '$REMOTE_ROOT/shared/.env.prod'" || {
  echo "Production environment files must already exist under $REMOTE_ROOT/shared; refusing to upload local credentials." >&2
  exit 1
}
ssh "$TARGET" "chmod 0600 '$REMOTE_ROOT/shared/.env' '$REMOTE_ROOT/shared/.env.prod'"

ssh "$TARGET" "grep -Eq '^DINGTALK_CORP_ID=.+$' '$REMOTE_ROOT/shared/.env' '$REMOTE_ROOT/shared/.env.prod' && grep -Eq '^DINGTALK_APP_KEY=.+$' '$REMOTE_ROOT/shared/.env' '$REMOTE_ROOT/shared/.env.prod' && grep -Eq '^DINGTALK_APP_SECRET=.+$' '$REMOTE_ROOT/shared/.env' '$REMOTE_ROOT/shared/.env.prod'" || {
  echo "Production environment must set DINGTALK_CORP_ID, DINGTALK_APP_KEY, and DINGTALK_APP_SECRET in shared .env or .env.prod." >&2
  exit 1
}
app_base_url="$(ssh "$TARGET" "sed -n 's/^APP_BASE_URL=//p' '$REMOTE_ROOT/shared/.env.prod' | tail -n 1")"
cookie_secure="$(ssh "$TARGET" "sed -n 's/^COOKIE_SECURE=//p' '$REMOTE_ROOT/shared/.env.prod' | tail -n 1")"
[[ "$app_base_url" =~ ^https?://[^[:space:]]+$ && "$cookie_secure" =~ ^(true|false)$ ]] || {
  echo "Production .env.prod must set an HTTP or HTTPS APP_BASE_URL and COOKIE_SECURE=true or false." >&2
  exit 1
}
ssh "$TARGET" "grep -Eq '^RECORDING_RETENTION_DAYS=[0-9]+$' '$REMOTE_ROOT/shared/.env.prod' && grep -Eq '^BACKUP_AGE_RECIPIENT=age1[[:alnum:]]+$' '$REMOTE_ROOT/shared/.env.prod'" || {
  echo "Production .env.prod must set a non-negative RECORDING_RETENTION_DAYS and an age BACKUP_AGE_RECIPIENT." >&2
  echo "Keep the corresponding age identity offline; never place it on the production server." >&2
  exit 1
}
ssh "$TARGET" "command -v age >/dev/null" || {
  echo "The production server must have the age command installed before encrypted backups can run." >&2
  exit 1
}

rsync -az --delete \
  --exclude '.git/' \
  --exclude '.env' \
  --exclude '.env.local' \
  --exclude '.env.prod' \
  --exclude 'node_modules/' \
  --exclude 'recordings/' \
  --exclude 'questions/' \
  --exclude 'comments/' \
  --exclude 'consents/' \
  --exclude 'ratings/' \
  --exclude '.DS_Store' \
  ./ "$TARGET:$release_dir/"

if [[ "$MIGRATE_DATA" == true ]]; then
  remote_data_count="$(ssh "$TARGET" "find '$REMOTE_ROOT/shared/recordings' '$REMOTE_ROOT/shared/questions' '$REMOTE_ROOT/shared/comments' '$REMOTE_ROOT/shared/consents' '$REMOTE_ROOT/shared/ratings' -type f 2>/dev/null | wc -l")"
  if [[ "$remote_data_count" != "0" ]]; then
    echo "Remote persistent storage is not empty; refusing to overwrite it." >&2
    echo "Back up and reconcile remote data manually before retrying." >&2
    exit 1
  fi

  rsync -az recordings/ "$TARGET:$REMOTE_ROOT/shared/recordings/"
  rsync -az questions/ "$TARGET:$REMOTE_ROOT/shared/questions/"
  if [[ -d comments ]]; then
    rsync -az comments/ "$TARGET:$REMOTE_ROOT/shared/comments/"
  fi
  if [[ -d consents ]]; then
    rsync -az consents/ "$TARGET:$REMOTE_ROOT/shared/consents/"
  fi
  if [[ -d ratings ]]; then
    rsync -az ratings/ "$TARGET:$REMOTE_ROOT/shared/ratings/"
  fi
  echo "Migrated local persistent data. Encrypted backup runs before retention below."
fi

ssh "$TARGET" "set -eu
cd '$release_dir'
npm ci --omit=dev --no-audit --no-fund --ignore-scripts
current_ffmpeg='$REMOTE_ROOT/current/node_modules/ffmpeg-static'
release_ffmpeg='$release_dir/node_modules/ffmpeg-static'
if test -x \"\$current_ffmpeg/ffmpeg\" && test \"\$(node -p \"require('\$current_ffmpeg/package.json').version\")\" = \"\$(node -p \"require('\$release_ffmpeg/package.json').version\")\"; then
  cp \"\$current_ffmpeg/ffmpeg\" \"\$current_ffmpeg/ffmpeg.README\" \"\$current_ffmpeg/ffmpeg.LICENSE\" \"\$release_ffmpeg/\"
  chmod 0755 \"\$release_ffmpeg/ffmpeg\"
else
  cd \"\$release_ffmpeg\"
  node install.js
fi"
ssh "$TARGET" "ln -sfn '$REMOTE_ROOT/shared/recordings' '$release_dir/recordings' && ln -sfn '$REMOTE_ROOT/shared/questions' '$release_dir/questions' && ln -sfn '$REMOTE_ROOT/shared/comments' '$release_dir/comments' && ln -sfn '$REMOTE_ROOT/shared/consents' '$release_dir/consents' && ln -sfn '$REMOTE_ROOT/shared/ratings' '$release_dir/ratings' && ln -sfn '$REMOTE_ROOT/shared/.env' '$release_dir/.env' && ln -sfn '$REMOTE_ROOT/shared/.env.prod' '$release_dir/.env.prod'"
ssh "$TARGET" "chmod 0600 '$REMOTE_ROOT/shared/.env' '$REMOTE_ROOT/shared/.env.prod' && find '$REMOTE_ROOT/shared/recordings' '$REMOTE_ROOT/shared/questions' '$REMOTE_ROOT/shared/comments' '$REMOTE_ROOT/shared/consents' '$REMOTE_ROOT/shared/ratings' \\( -name lost+found -prune \\) -o -type d -exec chmod 0700 {} + && find '$REMOTE_ROOT/shared/recordings' '$REMOTE_ROOT/shared/questions' '$REMOTE_ROOT/shared/comments' '$REMOTE_ROOT/shared/consents' '$REMOTE_ROOT/shared/ratings' \\( -name lost+found -prune \\) -o -type f -exec chmod 0600 {} +"

rollback() {
  echo "Deployment failed after release activation; restoring the previous release." >&2
  if [[ -n "$previous_release" ]]; then
    ssh "$TARGET" "ln -sfn '$previous_release' '$REMOTE_ROOT/current' && sudo systemctl restart '$SERVICE_NAME.service'"
  else
    ssh "$TARGET" "sudo systemctl stop '$SERVICE_NAME.service'"
  fi
  ssh "$TARGET" "rm -rf '$release_dir'" || true
}

if ! ssh "$TARGET" "set -eu
sudo tee '/etc/systemd/system/$SERVICE_NAME.service' >/dev/null <<'UNIT'
[Unit]
Description=OScanner-Eng web service
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=$remote_user
Group=$remote_group
WorkingDirectory=$REMOTE_ROOT/current
EnvironmentFile=$REMOTE_ROOT/shared/.env
EnvironmentFile=$REMOTE_ROOT/shared/.env.prod
Environment=NODE_ENV=production
ExecStart=/usr/bin/node $REMOTE_ROOT/current/server.js
Restart=on-failure
RestartSec=3
TimeoutStopSec=5min
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$REMOTE_ROOT/shared/recordings $REMOTE_ROOT/shared/questions $REMOTE_ROOT/shared/comments $REMOTE_ROOT/shared/consents $REMOTE_ROOT/shared/ratings
UMask=0077

[Install]
WantedBy=multi-user.target
UNIT
sudo tee '/etc/systemd/system/$SERVICE_NAME-recording-maintenance.service' >/dev/null <<'UNIT'
[Unit]
Description=Encrypted OScanner-Eng recording backup and optional recording retention

[Service]
Type=oneshot
User=$remote_user
Group=$remote_group
EnvironmentFile=$REMOTE_ROOT/shared/.env
EnvironmentFile=$REMOTE_ROOT/shared/.env.prod
Environment=APP_ROOT=$REMOTE_ROOT/current
Environment=RECORDINGS_DIR=$REMOTE_ROOT/shared/recordings
Environment=BACKUP_DIR=$REMOTE_ROOT/backups
ExecStartPre=+/usr/bin/systemctl stop $SERVICE_NAME.service
ExecStart=$REMOTE_ROOT/current/scripts/maintain-recordings.sh
ExecStopPost=+/usr/bin/systemctl start $SERVICE_NAME.service
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=$REMOTE_ROOT/shared/recordings $REMOTE_ROOT/shared/questions $REMOTE_ROOT/shared/comments $REMOTE_ROOT/shared/consents $REMOTE_ROOT/shared/ratings $REMOTE_ROOT/backups
UMask=0077
UNIT
sudo tee '/etc/systemd/system/$SERVICE_NAME-recording-maintenance.timer' >/dev/null <<'UNIT'
[Unit]
Description=Daily OScanner-Eng encrypted recording backup and optional recording retention

[Timer]
OnCalendar=*-*-* 03:15:00
RandomizedDelaySec=30m
Persistent=true

[Install]
WantedBy=timers.target
UNIT
sudo rm -f '/etc/systemd/system/$SERVICE_NAME.service.d/recording-mount.conf'
sudo rm -f '/etc/systemd/system/$SERVICE_NAME-recording-maintenance.service.d/recording-mount.conf'
ln -sfn '$release_dir' '$REMOTE_ROOT/current'
sudo systemctl daemon-reload
sudo systemctl enable '$SERVICE_NAME.service'
sudo systemctl enable --now '$SERVICE_NAME-recording-maintenance.timer'
sudo systemctl restart '$SERVICE_NAME.service'
if command -v ufw >/dev/null && sudo ufw status | grep -q '^Status: active'; then
  sudo ufw allow '$APP_PORT/tcp' >/dev/null
fi"; then
  rollback
  exit 1
fi

health_ok=false
for attempt in {1..10}; do
  if ssh "$TARGET" "curl --fail --silent --show-error --max-time 10 'http://127.0.0.1:$APP_PORT/' >/dev/null"; then
    health_ok=true
    break
  fi
  sleep 2
done
if [[ "$health_ok" != true ]]; then
  echo "Application health check did not succeed within 20 seconds." >&2
  rollback
  exit 1
fi

if ! auth_status="$(ssh "$TARGET" "curl --silent --show-error --max-time 10 --output /dev/null --write-out '%{http_code}' 'http://127.0.0.1:$APP_PORT/auth/dingtalk'")"; then
  echo "DingTalk authentication check could not connect to the application." >&2
  rollback
  exit 1
fi
if [[ "$auth_status" != "302" ]]; then
  echo "DingTalk authentication check failed with HTTP $auth_status." >&2
  rollback
  exit 1
fi

ssh "$TARGET" "cd '$REMOTE_ROOT/releases' && ls -1dt */ 2>/dev/null | tail -n +6 | xargs -r rm -rf"

echo "Deployment succeeded: $app_base_url"
