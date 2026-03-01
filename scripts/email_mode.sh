#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CONFIG_PATH="${FLUXER_CONFIG:-$REPO_ROOT/config/config.json}"

print_usage() {
	cat <<'EOF'
Usage:
  ./scripts/email_mode.sh mailpit
  ./scripts/email_mode.sh ionos
  ./scripts/email_mode.sh status

Modes:
  mailpit  Configure local Mailpit SMTP (localhost:49621)
  ionos    Configure IONOS SMTP (default: smtp.ionos.de:587)
  status   Print current email SMTP configuration

Environment variables for mode "mailpit":
  MAILPIT_FROM_EMAIL   Optional, default: noreply@localhost
  MAILPIT_SMTP_USER    Optional, default: dev
  MAILPIT_SMTP_PASS    Optional, defaults to current password or "dev"

Environment variables for mode "ionos":
  IONOS_SMTP_USER      Required
  IONOS_SMTP_PASS      Required
  IONOS_FROM_EMAIL     Optional, default: IONOS_SMTP_USER
  IONOS_SMTP_HOST      Optional, default: smtp.ionos.de
  IONOS_SMTP_PORT      Optional, default: 587
  IONOS_SMTP_SECURE    Optional, default: false

Optional:
  FLUXER_CONFIG        Path to config json (default: config/config.json)
EOF
}

require_jq() {
	if ! command -v jq >/dev/null 2>&1; then
		echo "Error: jq is required but not installed." >&2
		exit 1
	fi
}

ensure_config_exists() {
	if [ ! -f "$CONFIG_PATH" ]; then
		echo "Error: Config file not found: $CONFIG_PATH" >&2
		exit 1
	fi
}

write_json() {
	local jq_program="$1"
	shift
	local tmp="${CONFIG_PATH}.tmp"
	jq "$jq_program" "$@" "$CONFIG_PATH" >"$tmp"
	mv "$tmp" "$CONFIG_PATH"
}

set_mailpit() {
	local from_email="${MAILPIT_FROM_EMAIL:-noreply@localhost}"
	local smtp_user="${MAILPIT_SMTP_USER:-dev}"
	local existing_password
	existing_password="$(jq -r '.integrations.email.smtp.password // empty' "$CONFIG_PATH")"
	local smtp_pass="${MAILPIT_SMTP_PASS:-${existing_password:-dev}}"

	write_json \
		'(.integrations //= {}) |
		 (.integrations.email //= {}) |
		 .integrations.email.enabled = true |
		 .integrations.email.provider = "smtp" |
		 .integrations.email.from_email = $from_email |
		 (.integrations.email.smtp //= {}) |
		 .integrations.email.smtp.host = "localhost" |
		 .integrations.email.smtp.port = 49621 |
		 .integrations.email.smtp.username = $smtp_user |
		 .integrations.email.smtp.password = $smtp_pass |
		 .integrations.email.smtp.secure = false' \
		--arg from_email "$from_email" \
		--arg smtp_user "$smtp_user" \
		--arg smtp_pass "$smtp_pass"

	echo "Configured email mode: MAILPIT"
}

set_ionos() {
	local smtp_user="${IONOS_SMTP_USER:-}"
	local smtp_pass="${IONOS_SMTP_PASS:-}"
	if [ -z "$smtp_user" ] || [ -z "$smtp_pass" ]; then
		echo "Error: IONOS_SMTP_USER and IONOS_SMTP_PASS are required for ionos mode." >&2
		exit 1
	fi

	local from_email="${IONOS_FROM_EMAIL:-$smtp_user}"
	local smtp_host="${IONOS_SMTP_HOST:-smtp.ionos.de}"
	local smtp_port="${IONOS_SMTP_PORT:-587}"
	local smtp_secure="${IONOS_SMTP_SECURE:-false}"

	write_json \
		'(.integrations //= {}) |
		 (.integrations.email //= {}) |
		 .integrations.email.enabled = true |
		 .integrations.email.provider = "smtp" |
		 .integrations.email.from_email = $from_email |
		 (.integrations.email.smtp //= {}) |
		 .integrations.email.smtp.host = $smtp_host |
		 .integrations.email.smtp.port = ($smtp_port | tonumber) |
		 .integrations.email.smtp.username = $smtp_user |
		 .integrations.email.smtp.password = $smtp_pass |
		 .integrations.email.smtp.secure = ($smtp_secure == "true")' \
		--arg from_email "$from_email" \
		--arg smtp_host "$smtp_host" \
		--arg smtp_port "$smtp_port" \
		--arg smtp_user "$smtp_user" \
		--arg smtp_pass "$smtp_pass" \
		--arg smtp_secure "$smtp_secure"

	echo "Configured email mode: IONOS ($smtp_host:$smtp_port, secure=$smtp_secure)"
}

show_status() {
	jq '{
		config_path: input_filename,
		email_enabled: (.integrations.email.enabled // false),
		provider: (.integrations.email.provider // "unset"),
		from_email: (.integrations.email.from_email // "unset"),
		smtp: {
			host: (.integrations.email.smtp.host // "unset"),
			port: (.integrations.email.smtp.port // "unset"),
			username: (.integrations.email.smtp.username // "unset"),
			secure: (if (.integrations.email.smtp | has("secure")) then .integrations.email.smtp.secure else "unset" end)
		}
	}' "$CONFIG_PATH"
}

main() {
	require_jq
	ensure_config_exists

	local mode="${1:-}"
	case "$mode" in
	mailpit)
		set_mailpit
		show_status
		;;
	ionos)
		set_ionos
		show_status
		;;
	status)
		show_status
		;;
	-h | --help | help)
		print_usage
		;;
	*)
		print_usage
		exit 1
		;;
	esac
}

main "$@"
