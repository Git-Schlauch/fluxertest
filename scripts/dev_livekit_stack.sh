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

cat >"$livekit_cfg" <<EOF
port: 7880

keys:
  '$api_key': '$api_secret'

rtc:
  tcp_port: 7881
  port_range_start: 50000
  port_range_end: 50100
  use_external_ip: false
  node_ip: 127.0.0.1

turn:
  enabled: true
  domain: localhost
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
