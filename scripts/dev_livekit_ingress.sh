#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_path="${repo_root}/dev/livekit_ingress.yaml"
container_name="fluxer-livekit-ingress"

if [ ! -f "$config_path" ]; then
	echo "Missing ingress config: $config_path" >&2
	echo "Run scripts/dev_bootstrap.sh once to generate it." >&2
	exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
	echo "docker not found in PATH; cannot start livekit ingress." >&2
	exit 1
fi

docker rm -f "$container_name" >/dev/null 2>&1 || true

ingress_config_body="$(cat "$config_path")"

exec docker run --rm \
	--name "$container_name" \
	--pull missing \
	-e INGRESS_CONFIG_BODY="$ingress_config_body" \
	-p 1935:1935 \
	livekit/ingress
