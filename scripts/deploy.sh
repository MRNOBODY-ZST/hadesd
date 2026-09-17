#!/bin/sh
# A standalone installation. Existing WireGuard/production wrappers are separate.
set -eu
checkout=$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd -P)
cd "$checkout"
env_file=${BLOG_ENV_FILE:-.env.docker}
if [ "${1:-}" = '--env-file' ]; then
  [ "$#" -ge 3 ] || { echo 'Usage: deploy.sh --env-file PATH COMMAND' >&2; exit 2; }
  env_file=$2
  shift 2
fi
case "$env_file" in /*) ;; *) env_file="$checkout/$env_file" ;; esac
command=${1:-help}
[ "$#" -eq 0 ] || shift
case "$command" in
  help|--help|-h)
    cat <<'HELP'
Usage: ./scripts/deploy.sh [--env-file PATH] COMMAND [options]
  init [setup options]    Generate private configuration using Docker's Node
  start                  Build images and start healthy services
  bootstrap              Create the initial administrator (run once)
  status                 Show this installation's containers
  logs [service]         Follow the last 100 lines of logs
  stop                   Stop containers, retaining data and volumes

Example:
  ./scripts/deploy.sh init --site-origin http://localhost:18088 --admin-user admin
  ./scripts/deploy.sh start
  ./scripts/deploy.sh bootstrap
Then visit /admin/, sign in using .local/docker/admin-password, customize the
site in Settings, and publish. Until the first publish the public blog is empty.

Requires Docker with Compose >= 2.24.4. No host Node, pnpm or Java is needed.
The default .env.docker and project personal-blog are separate from local dev.
For another installation pass --env-file on every command and set unique
--data-dir, --project-name and --port during init. Keep data under .local; env
files must be root .env/.env.* (except .env.example) or inside .local.
For a trusted HTTPS proxy, set --trusted-proxies to its exact IP/CIDR list.
For external access pass --bind 0.0.0.0 or put an HTTPS proxy in front of the
loopback listener and initialize with the public HTTPS --site-origin.
HELP
    exit 0 ;;
  init|start|up|bootstrap|status|logs|stop) ;;
  *) echo "Unknown command: $command (use --help)" >&2; exit 2 ;;
esac
command -v docker >/dev/null 2>&1 || { echo 'Docker is required.' >&2; exit 1; }
docker compose version >/dev/null
compose() {
  docker compose --env-file "$env_file" \
    -f "$checkout/infra/compose/compose.yaml" \
    -f "$checkout/infra/compose/compose.standalone.yaml" "$@"
}
if [ "$command" = init ]; then
  case "$env_file" in "$checkout"/*) ;; *) echo 'For Docker init, --env-file must be inside the checkout.' >&2; exit 2 ;; esac
  # Mount at the same absolute path so generated bind paths work on the host.
  exec docker run --rm --user "$(id -u):$(id -g)" \
    --mount "type=bind,source=$checkout,target=$checkout" --workdir "$checkout" \
    node:24.10.0-bookworm-slim@sha256:b8d2197aff9129d16c801a3e3e1b2a873c4946480f5a310f38056df2268c38d9 \
    node -- scripts/setup.mjs "$@" --root "$checkout" --mode docker --env-file "$env_file"
fi
[ -f "$env_file" ] || { echo "Configuration missing: $env_file. Run init first." >&2; exit 1; }
case "$command" in
  start|up)
    compose up -d --build --wait
    echo "Services are ready. On a new database run ./scripts/deploy.sh --env-file '$env_file' bootstrap, then open /admin/." ;;
  bootstrap)
    compose run --rm --no-deps backend --bootstrap-admin
    echo 'Administrator created. Sign in at /admin/, customize Settings, then publish.' ;;
  status) compose ps ;;
  logs) compose logs --tail=100 -f "$@" ;;
  stop) compose stop ;;
esac
