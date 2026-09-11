#!/usr/bin/env bash
# Sourced by backup-origin.sh. Functions return failures explicitly so callers
# cannot accidentally turn a failed object export into a completed backup.

hadesd_detect_storage() {
  local compose=$1 configured actual running mode identity_script
  # Only the mode and a hash leave the container. Never source or print secrets.
  identity_script='set +x +v
    mode="${STORAGE_MODE:-local}"
    printf "%s\n" "$mode"
    if [ "$mode" = s3 ]; then
      printf "%s\n" "${S3_BUCKET:-}" "${S3_REGION:-us-east-1}" "${S3_ENDPOINT:-}" "${S3_PATH_STYLE:-false}" \
        "${AWS_ACCESS_KEY_ID:-}" "${AWS_SECRET_ACCESS_KEY:-}" "${AWS_SESSION_TOKEN:-}" \
        "${AWS_PROFILE:-}" "${AWS_SHARED_CREDENTIALS_FILE:-}"
    else
      printf "%s\n" "${MEDIA_ROOT:-}"
    fi | sha256sum'
  configured=$("$compose" run --rm --no-deps -T --entrypoint /bin/sh backend -eu -c "$identity_script") || return 1
  running=$("$compose" ps --status running -q backend) || return 1
  if [[ -n $running ]]; then
    actual=$("$compose" exec -T backend /bin/sh -eu -c "$identity_script") || return 1
    if [[ $actual != "$configured" ]]; then
      printf 'Running and configured backend storage differ; reconcile before backup.\n' >&2
      return 1
    fi
  fi
  mode=${configured%%$'\n'*}
  case "$mode" in local|s3) printf '%s\n' "$mode" ;; *) return 1 ;; esac
}

hadesd_backup_media() {
  local compose=$1 mode=$2 local_root=$3 destination=$4
  mkdir -m 700 -- "$destination/media" || return 1
  case "$mode" in
    local)
      cp -a -- "$local_root/." "$destination/media/" || return 1
      ;;
    s3)
      # The backend image provides Java and the verified transfer CLI. Its normal
      # storage/database configuration is reused; only this new export directory
      # is writable through an additional bind. Root owns the protected backup.
      "$compose" run --rm --no-deps -T --user 0:0 \
        --volume "$destination/media:/srv/storage-export" \
        --env STORAGE_TARGET_ROOT=/srv/storage-export \
        --env STORAGE_TRANSFER_REPORT= \
        backend --storage-transfer --from=s3 --to=local --apply \
        > "$destination/storage-export.json" || return 1
      [[ -s "$destination/storage-export.json" ]] || return 1
      ;;
    *) return 1 ;;
  esac
}
