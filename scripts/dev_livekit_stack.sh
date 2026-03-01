#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
config_path="${FLUXER_CONFIG:-$repo_root/config/config.json}"
compose_file="$repo_root/dev/livekit-stack.compose.yaml"
livekit_cfg="$repo_root/dev/livekit.docker.yaml"
ingress_cfg="$repo_root/dev/livekit_ingress.docker.yaml"

if ! command -v docker >/dev/null 2>&1; then
	echo "docker not found in PATH" >&2
	exit 1
fi

if ! command -v docker-compose >/dev/null 2>&1 && ! docker compose version >/dev/null 2>&1; then
	echo "docker compose not available" >&2
	exit 1
fi

api_key=$(jq -r '.integrations.voice.api_key // "devkey"' "$config_path")
api_secret=$(jq -r '.integrations.voice.api_secret // "devsecret"' "$config_path")
webhook_url=$(jq -r '.integrations.voice.webhook_url // "http://localhost:49319/api/webhooks/livekit"' "$config_path")
webhook_url="${webhook_url/localhost/host.docker.internal}"
webhook_url="${webhook_url/127.0.0.1/host.docker.internal}"
base_domain=$(jq -r '.domain.base_domain // "localhost"' "$config_path")
livekit_use_external_ip_override="${FLUXER_LIVEKIT_USE_EXTERNAL_IP:-}"
livekit_node_ip_override="${FLUXER_LIVEKIT_NODE_IP:-}"

is_local_domain=false
case "$base_domain" in
localhost | 127.0.0.1 | ::1 | "[::1]")
	is_local_domain=true
	;;
esac

if [ "$is_local_domain" = true ]; then
	livekit_node_ip="127.0.0.1"
	livekit_turn_domain="localhost"
	livekit_use_external_ip="false"
else
	livekit_node_ip="$base_domain"
	livekit_turn_domain="$base_domain"
	# For literal IPs (common in LAN testing), keep host candidates as-is.
	if [[ "$base_domain" =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] || [[ "$base_domain" == *:* ]]; then
		livekit_use_external_ip="false"
	else
		livekit_use_external_ip="true"
	fi
fi

# Optional LAN/public overrides for environments where the public hostname is used internally.
# Example:
#   FLUXER_LIVEKIT_USE_EXTERNAL_IP=false FLUXER_LIVEKIT_NODE_IP=10.0.1.9 devenv up
if [ -n "$livekit_use_external_ip_override" ]; then
	case "$livekit_use_external_ip_override" in
	true | false)
		livekit_use_external_ip="$livekit_use_external_ip_override"
		;;
	*)
		echo "Invalid FLUXER_LIVEKIT_USE_EXTERNAL_IP value: $livekit_use_external_ip_override (expected true|false)" >&2
		exit 1
		;;
	esac
fi

if [ -n "$livekit_node_ip_override" ]; then
	livekit_node_ip="$livekit_node_ip_override"
fi

cat >"$livekit_cfg" <<EOF
port: 7880

keys:
  '$api_key': '$api_secret'

rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: $livekit_use_external_ip
  node_ip: $livekit_node_ip

turn:
  enabled: true
  domain: $livekit_turn_domain
  udp_port: 3478

redis:
  address: "livekit_redis:6379"
  username: ""
  password: ""
  db: 0
  use_tls: false

ingress:
  whip_base_url: "http://localhost:8080/whip"
  rtmp_base_url: "rtmp://localhost:1935/live"

webhook:
  api_key: '$api_key'
  urls:
    - '$webhook_url'

room:
  auto_create: true
  max_participants: 100
  empty_timeout: 300

development: true
EOF

cat >"$ingress_cfg" <<EOF
api_key: '$api_key'
api_secret: '$api_secret'
ws_url: 'ws://livekit:7880'

redis:
  address: "livekit_redis:6379"
  username: ""
  password: ""
  db: 0
  use_tls: false

rtmp_port: 1935
whip_port: 8080
health_port: 9091

logging:
  level: info
  json: false
EOF

cd "$repo_root/dev"
if command -v docker-compose >/dev/null 2>&1; then
	exec docker-compose -f "$compose_file" up --remove-orphans
else
	exec docker compose -f "$compose_file" up --remove-orphans
fi
