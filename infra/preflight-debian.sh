#!/usr/bin/env bash
# Read-only checks. Never print environment variables, secrets or container configuration.
set -euo pipefail

if [[ ! -r /etc/os-release ]]; then
  printf 'ERROR: /etc/os-release is unavailable.\n' >&2
  exit 1
fi
# shellcheck source=/dev/null
source /etc/os-release
printf 'Operating system: %s\n' "${PRETTY_NAME:-unknown}"
if [[ "${ID:-}" != debian || "${VERSION_ID:-}" != 13 ]]; then
  printf 'NOTICE: This runbook targets Debian 13; review compatibility before proceeding.\n'
fi
printf 'Architecture: %s\n' "$(uname -m)"
printf 'Available CPUs: %s\n' "$(getconf _NPROCESSORS_ONLN)"
printf '\nMemory (KiB):\n'
awk '/^(MemTotal|MemAvailable):/ {print}' /proc/meminfo
printf '\nFilesystem capacity for /opt (or root):\n'
if [[ -d /opt ]]; then df -h /opt; else df -h /; fi

if ! command -v docker >/dev/null 2>&1; then
  printf 'ERROR: Docker is not installed or not in PATH.\n' >&2
  exit 1
fi
printf '\nDocker client:\n'
docker --version
printf '\nDocker Compose plugin:\n'
docker compose version
printf '\nDocker daemon:\n'
docker info --format 'Server: {{.ServerVersion}}; architecture: {{.Architecture}}; rootless/security options: {{json .SecurityOptions}}'

printf '\nExisting listeners on candidate ports (review, do not stop them):\n'
if command -v ss >/dev/null 2>&1; then
  ss -H -ltn | awk '$4 ~ /:(80|443|5432|6543|8000|8443)$/ {print $1, $4}'
fi
printf '\nPrerequisite commands:\n'
missing=0
for tool in git curl openssl; do
  if command -v "$tool" >/dev/null 2>&1; then
    printf 'OK: %s\n' "$tool"
  else
    printf 'MISSING: %s\n' "$tool"
    missing=1
  fi
done
printf '\nNo services, firewall rules, files or Docker resources were changed.\n'
printf 'Next: confirm HTTPS hostname, frontend URL, backup destination and server access.\n'
exit "$missing"
