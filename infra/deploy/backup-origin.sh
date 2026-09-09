#!/usr/bin/env bash
# Run manually as root, with all writing, uploads and publishing quiesced.
# This script neither stops services nor deletes/changes source data.
set +x +v
set -Eeuo pipefail
umask 077
exec 8>&2
export LC_ALL=C

readonly COMPOSE=/usr/local/sbin/hadesd-compose
readonly BACKUP_ROOT=/srv/hadesd/backups
readonly MEDIA_ROOT=/srv/hadesd/media
readonly PUBLISHED_ROOT=/srv/hadesd/published
readonly CONFIG_ENV=/etc/hadesd/app.env
readonly ADMIN_PASSWORD=/etc/hadesd/admin-password
backup_dir=''
stage=preflight

fail() { printf 'Backup failed: %s\n' "$1" >&8; exit 1; }
finish() {
  local status=$?
  trap - EXIT
  if (( status != 0 )); then
    if [[ -n "$backup_dir" ]]; then
      printf 'INCOMPLETE\nstage=%s\n' "$stage" > "$backup_dir/INCOMPLETE" 2>/dev/null || true
      printf 'Backup incomplete: %s (stage: %s)\n' "$backup_dir" "$stage" >&8
    fi
  fi
  exit "$status"
}
trap finish EXIT
trap 'exit 130' INT
trap 'exit 143' TERM

if [[ ${1:-} == --help && $# == 1 ]]; then
  printf 'Usage: sudo %s\nRun only while writing, uploads and publishing are quiesced.\n' "$0"
  exit 0
fi
[[ $# == 0 ]] || fail 'unexpected arguments; use --help'
[[ $EUID == 0 ]] || fail 'root is required'
for tool in date install mkdir cp mv rm tar sha256sum cmp readlink stat flock; do
  command -v "$tool" >/dev/null || fail "missing command: $tool"
done
[[ -x "$COMPOSE" ]] || fail 'production Compose wrapper is unavailable'
[[ -f "$CONFIG_ENV" && ! -L "$CONFIG_ENV" ]] || fail 'private environment file is unavailable'
[[ -f "$ADMIN_PASSWORD" && ! -L "$ADMIN_PASSWORD" ]] || fail 'administrator password file is unavailable'
[[ $(stat -c '%u:%a' "$CONFIG_ENV") == 0:600 ]] || fail 'private environment file must be root-owned mode 600'
[[ $(stat -c '%u:%a' "$ADMIN_PASSWORD") == 1000:400 ]] || fail 'administrator password file must be UID 1000 mode 400'
[[ -d "$MEDIA_ROOT" && -d "$PUBLISHED_ROOT" ]] || fail 'source data directories are unavailable'
[[ -L "$PUBLISHED_ROOT/current" && -f "$PUBLISHED_ROOT/current/manifest.json" ]] || fail 'current release manifest is unavailable'
[[ ! -L "$BACKUP_ROOT" ]] || fail 'backup root must not be a symbolic link'
install -d -m 700 -o root -g root "$BACKUP_ROOT"
exec 9> "$BACKUP_ROOT/.backup.lock"
flock -n 9 || fail 'another manual backup is running'
backup_dir="$BACKUP_ROOT/$(date -u +%Y%m%dT%H%M%SZ)"
# Never reuse a directory, including an earlier incomplete backup.
[[ ! -e "$backup_dir" ]] || { backup_dir=''; fail 'a backup already exists for this UTC second'; }
mkdir -m 700 "$backup_dir"
printf 'INCOMPLETE\nstage=starting\n' > "$backup_dir/INCOMPLETE"

run_backup() {
  stage=release_snapshot
  local target_before target_after manifest_before manifest_after database_hash
  target_before=$(readlink -f "$PUBLISHED_ROOT/current")
  case "$target_before" in "$PUBLISHED_ROOT"/releases/*) ;; *) return 1 ;; esac
  cp -- "$PUBLISHED_ROOT/current/manifest.json" "$backup_dir/current-manifest.json"
  manifest_before=$(sha256sum "$backup_dir/current-manifest.json")
  manifest_before=${manifest_before%% *}

  stage=database_dump
  # Credentials are expanded only inside the container; no password argument,
  # host-side env sourcing, shell tracing or diagnostic output is used.
  "$COMPOSE" exec -T mysql sh -eu -c '
    set +x +v
    : "${MYSQL_ROOT_PASSWORD:?missing root password}" "${MYSQL_DATABASE:?missing database}"
    export MYSQL_PWD="$MYSQL_ROOT_PASSWORD"
    exec mysqldump --user=root --single-transaction --quick --skip-lock-tables \
      --routines --events --triggers --hex-blob --no-tablespaces \
      --set-gtid-purged=OFF --databases "$MYSQL_DATABASE"
  ' > "$backup_dir/database.sql"
  [[ -s "$backup_dir/database.sql" ]]
  (cd "$backup_dir" && sha256sum database.sql > database.sha256 && sha256sum --check --status database.sha256)

  stage=media_copy
  mkdir -m 700 "$backup_dir/media" "$backup_dir/published" "$backup_dir/private"
  cp -a -- "$MEDIA_ROOT/." "$backup_dir/media/"

  stage=published_copy
  # Tar retains the relative current symlink, ownership and file permissions.
  # Only top-level publisher scratch trees are excluded, not similarly named content.
  tar --exclude='./work' --exclude='./staging' -C "$PUBLISHED_ROOT" -cpf - . \
    | tar -C "$backup_dir/published" -xpf -

  stage=private_configuration
  install -m 600 -o root -g root "$CONFIG_ENV" "$backup_dir/private/app.env"
  install -m 600 -o root -g root "$ADMIN_PASSWORD" "$backup_dir/private/admin-password"
  cmp -s "$CONFIG_ENV" "$backup_dir/private/app.env"
  cmp -s "$ADMIN_PASSWORD" "$backup_dir/private/admin-password"

  stage=verification
  target_after=$(readlink -f "$PUBLISHED_ROOT/current")
  [[ "$target_after" == "$target_before" ]]
  manifest_after=$(sha256sum "$PUBLISHED_ROOT/current/manifest.json")
  manifest_after=${manifest_after%% *}
  [[ "$manifest_before" == "$manifest_after" ]]
  case "$(readlink -f "$backup_dir/published/current")" in "$backup_dir"/published/releases/*) ;; *) return 1 ;; esac
  cmp -s "$backup_dir/current-manifest.json" "$backup_dir/published/current/manifest.json"
  (cd "$backup_dir" && sha256sum --check --status database.sha256 && sha256sum current-manifest.json > current-manifest.sha256 && sha256sum --check --status current-manifest.sha256)
  database_hash=$(sha256sum "$backup_dir/database.sql")
  database_hash=${database_hash%% *}
  printf 'createdAt=%s\nreleaseTarget=%s\ndatabaseSha256=%s\ncurrentManifestSha256=%s\nconsistency=manual-quiesced-window\n' \
    "$(date -u +%FT%TZ)" "${target_before#"$PUBLISHED_ROOT/"}" "$database_hash" "$manifest_before" > "$backup_dir/summary.txt"
  # Publish the completion marker by atomic rename only after its write succeeds.
  printf 'VERIFIED\n' > "$backup_dir/.complete.tmp"
  rm -- "$backup_dir/INCOMPLETE"
  mv -- "$backup_dir/.complete.tmp" "$backup_dir/COMPLETE"
}

# Keep dumps/configuration in protected files and suppress tool diagnostics that
# could contain SQL or private configuration. A failure reports its stage only.
run_backup >/dev/null 2>&1
stage=complete
printf 'Backup verified: %s\n' "$backup_dir"
printf 'Database and current manifest SHA-256 verified; summary: %s/summary.txt\n' "$backup_dir"
