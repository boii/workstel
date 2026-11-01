#!/usr/bin/env bash
# Pull the reviewed official release, pin its actual digest and start only the new KMS.
set -euo pipefail
umask 077
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
if [[ ! -e /opt/workstel-openbao ]]; then bash "$release_dir/infra/prepare-openbao.sh";fi
[[ -f /opt/workstel-openbao/.workstel-managed-v1 ]] || { printf 'STOP: Existing key-manager directory is not marked as this managed deployment. No service was changed.\n' >&2;exit 1; }
image=quay.io/openbao/openbao:2.7.2
docker pull "$image"
digest="$(docker image inspect "$image" --format '{{index .RepoDigests 0}}')"
[[ "$digest" =~ ^quay.io/openbao/openbao@sha256:[0-9a-f]{64}$ ]] || { printf 'ERROR: Official image digest could not be validated.\n' >&2;exit 1; }
sed -i '/^WORKSTEL_OPENBAO_IMAGE=/d' /opt/workstel-openbao/.env
printf 'WORKSTEL_OPENBAO_IMAGE=%s\n' "$digest" >> /opt/workstel-openbao/.env
docker compose --env-file /opt/workstel-openbao/.env -p workstel-openbao -f /opt/workstel-openbao/compose.yml config --quiet
docker compose --env-file /opt/workstel-openbao/.env -p workstel-openbao -f /opt/workstel-openbao/compose.yml up -d --no-build
for attempt in {1..15}; do
  status=0
  output="$(docker exec workstel-openbao bao status 2>&1)" || status=$?
  if [[ "$status" == 0 || "$status" == 2 ]]; then
    printf '%s\n' "$output"
    printf 'Key manager is reachable over verified TLS. Initialize/unseal interactively; never send recovery keys or initialization output to chat.\n'
    exit 0
  fi
  sleep 2
done
printf 'ERROR: KMS TLS status is not ready. Inspect the new KMS service locally; do not share private keys or environment files.\n' >&2
exit 1
