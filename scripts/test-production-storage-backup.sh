#!/usr/bin/env bash
# Tests only temporary files and a fake Compose function, never a running daemon.
set -Eeuo pipefail
workspace=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
source "$workspace/infra/deploy/storage-backup.sh"
# Windows Git Bash cannot apply POSIX directory modes. The Linux backup keeps
# its real mkdir flags; this test shim only makes fixture copies portable.
if [[ $(uname -s) == MINGW* ]]; then
  mkdir() {
    if [[ ${1:-} == -m ]]; then shift 2; fi
    command mkdir "$@"
  }
fi
mkdir -p "$workspace/.local"
fixture=$(mktemp -d "$workspace/.local/backup-origin-test.XXXXXX")
case "$fixture" in "$workspace"/.local/backup-origin-test.*) ;; *) exit 1 ;; esac
trap 'rm -rf -- "$fixture"' EXIT

configured_mode=local
running_mode=local
configured_hash=same
running_hash=same
fake_running=true
export_fail=false

fake_compose() {
  if [[ $1 == ps ]]; then
    [[ $fake_running != true ]] || printf 'test-container\n'
    return 0
  fi
  if [[ $1 == exec ]]; then
    printf '%s\n%s\n' "$running_mode" "$running_hash"
    return 0
  fi
  if [[ " $* " == *' --entrypoint '* ]]; then
    printf '%s\n%s\n' "$configured_mode" "$configured_hash"
    return 0
  fi
  local mount='' last='' argument
  for argument in "$@"; do
    if [[ $last == --volume ]]; then mount=$argument; fi
    last=$argument
  done
  [[ " $* " == *' --storage-transfer --from=s3 --to=local --apply '* || " $* " == *' --storage-transfer --from=s3 --to=local --apply' ]] || return 91
  [[ $mount == *:/srv/storage-export ]] || return 92
  [[ $export_fail != true ]] || return 33
  printf 'verified S3 bytes' > "${mount%:/srv/storage-export}/34f948ef-c908-445f-8098-e48cdeac66a9"
  printf '{"examined":1,"copied":1,"alreadyPresent":0,"pending":0,"legacyWithoutChecksum":0,"bytes":17,"dryRun":false}\n'
}

[[ $(hadesd_detect_storage fake_compose) == local ]]
mkdir "$fixture/source" "$fixture/local"
printf 'local bytes' > "$fixture/source/fixture"
hadesd_backup_media fake_compose local "$fixture/source" "$fixture/local"
cmp "$fixture/source/fixture" "$fixture/local/media/fixture"
printf 'PASS local mode preserves copy behavior\n'

configured_mode=s3
running_mode=s3
[[ $(hadesd_detect_storage fake_compose) == s3 ]]
mkdir "$fixture/s3"
hadesd_backup_media fake_compose s3 "$fixture/source" "$fixture/s3"
[[ $(cat "$fixture/s3/media/34f948ef-c908-445f-8098-e48cdeac66a9") == 'verified S3 bytes' ]]
[[ ! -e "$fixture/s3/media/fixture" ]]
[[ -s "$fixture/s3/storage-export.json" ]]
printf 'PASS S3 mode exports verified bytes instead of stale local directory\n'

export_fail=true
mkdir "$fixture/failed"
if hadesd_backup_media fake_compose s3 "$fixture/source" "$fixture/failed"; then
  printf 'FAIL failed S3 export was accepted\n' >&2; exit 1
fi
printf 'PASS failed S3 export propagates failure\n'

running_mode=local
if hadesd_detect_storage fake_compose >/dev/null 2>&1; then
  printf 'FAIL storage mode drift was accepted\n' >&2; exit 1
fi
running_mode=s3
running_hash=different
if hadesd_detect_storage fake_compose >/dev/null 2>&1; then
  printf 'FAIL storage credential/endpoint drift was accepted\n' >&2; exit 1
fi
printf 'PASS runtime/config storage drift rejected\n'

fake_running=false
[[ $(hadesd_detect_storage fake_compose) == s3 ]]
printf 'PASS stopped backend uses fresh container storage configuration\n'
