#!/bin/sh
set -eu
# The user-worker filesystem is sandboxed. Load the mounted Docker secret into
# runtime memory at process startup; never put its value in Compose configuration.
WORKSTEL_VAULT_KEYRING="$(cat /run/secrets/workstel_vault_keyring)"
export WORKSTEL_VAULT_KEYRING
exec edge-runtime "$@"
