#!/usr/bin/env bash
# Creates only a new, isolated key-manager deployment. Does not start or modify Supabase.
set -euo pipefail
umask 077
release_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
[[ "${EUID}" == 0 ]] || { printf 'ERROR: Run as the server administrator.\n' >&2; exit 1; }
for command in docker python3 openssl install getent useradd id; do command -v "$command" >/dev/null || { printf 'ERROR: Missing %s.\n' "$command" >&2; exit 1; }; done
[[ ! -e /opt/workstel-openbao ]] || { printf 'STOP: /opt/workstel-openbao already exists. Review the existing setup; this helper never replaces keys or data.\n' >&2; exit 1; }
network="$(docker inspect workstel-edge-functions --format '{{json .NetworkSettings.Networks}}' | python3 -c 'import json,sys; networks=json.load(sys.stdin); assert len(networks)==1,"Multiple networks require an explicit reviewed choice"; print(next(iter(networks)))')"
[[ "$network" =~ ^[A-Za-z0-9_.-]+$ ]] || { printf 'ERROR: Invalid Docker network.\n' >&2; exit 1; }
if ! getent passwd workstel-kms >/dev/null; then
  useradd --system --no-create-home --shell /usr/sbin/nologin --user-group workstel-kms
fi
python3 -c 'import pwd; p=pwd.getpwnam("workstel-kms"); assert p.pw_uid!=0 and p.pw_shell in ("/usr/sbin/nologin","/bin/false"),"Expected a dedicated non-login KMS account"'
kms_uid="$(id -u workstel-kms)"
kms_gid="$(id -g workstel-kms)"
install -d -m 750 -g "$kms_gid" /opt/workstel-openbao /opt/workstel-openbao/config /opt/workstel-openbao/tls
install -d -m 700 -o "$kms_uid" -g "$kms_gid" /opt/workstel-openbao/data /opt/workstel-openbao/logs
install -m 640 -g "$kms_gid" "$release_dir/infra/openbao/openbao.hcl" /opt/workstel-openbao/config/openbao.hcl
install -m 644 "$release_dir/infra/openbao/compose.yml" /opt/workstel-openbao/compose.yml
printf 'WORKSTEL_SUPABASE_NETWORK=%s\nWORKSTEL_KMS_UID=%s\nWORKSTEL_KMS_GID=%s\nWORKSTEL_OPENBAO_IMAGE=quay.io/openbao/openbao:2.7.2\n' "$network" "$kms_uid" "$kms_gid" > /opt/workstel-openbao/.env
openssl req -x509 -newkey rsa:4096 -sha256 -nodes -days 3650 -keyout /opt/workstel-openbao/tls/ca.key -out /opt/workstel-openbao/tls/ca.crt -subj '/CN=Workstel Internal KMS CA' -addext 'basicConstraints=critical,CA:TRUE' -addext 'keyUsage=critical,keyCertSign,cRLSign' 2>/dev/null
openssl req -new -newkey rsa:3072 -nodes -keyout /opt/workstel-openbao/tls/server.key -out /opt/workstel-openbao/tls/server.csr -subj '/CN=workstel-openbao' 2>/dev/null
cat > /opt/workstel-openbao/tls/server.ext <<'CERT'
subjectAltName=DNS:workstel-openbao,IP:127.0.0.1
basicConstraints=critical,CA:FALSE
keyUsage=critical,digitalSignature,keyEncipherment
extendedKeyUsage=serverAuth
CERT
openssl x509 -req -in /opt/workstel-openbao/tls/server.csr -CA /opt/workstel-openbao/tls/ca.crt -CAkey /opt/workstel-openbao/tls/ca.key -CAcreateserial -out /opt/workstel-openbao/tls/server.crt -days 365 -sha256 -extfile /opt/workstel-openbao/tls/server.ext 2>/dev/null
chmod 600 /opt/workstel-openbao/tls/ca.key
chown root:"$kms_gid" /opt/workstel-openbao/tls/server.key
chmod 640 /opt/workstel-openbao/tls/server.key
chmod 644 /opt/workstel-openbao/tls/ca.crt /opt/workstel-openbao/tls/server.crt
# Keep the CA signing key outside the container mount.
install -d -m 700 /opt/workstel-openbao/offline-material
mv /opt/workstel-openbao/tls/ca.key /opt/workstel-openbao/offline-material/ca.key
openssl verify -CAfile /opt/workstel-openbao/tls/ca.crt /opt/workstel-openbao/tls/server.crt
printf 'workstel-openbao-v1\n' > /opt/workstel-openbao/.workstel-managed-v1
printf 'OpenBao files prepared. No service was started and no recovery keys were generated.\n'
printf 'Start the isolated Compose project, then initialize and unseal interactively. Keep recovery material outside this VM before accepting real passwords.\n'
