#!/usr/bin/env bash
# 验证 Release Server 包的首次启动、升级与 N-1 直接回退路径。
set -euo pipefail

if [[ $# -lt 2 ]]; then
  echo 'Usage: smoke-release-server.sh <current-server.zip> <current-version> [previous-tag]' >&2
  exit 2
fi

current_zip=$1
current_version=$2
previous_tag=${3:-}
smoke_root=$(mktemp -d)
current_dir="$smoke_root/current"
previous_dir="$smoke_root/previous"
api_port=39001

run_compose() {
  local directory=$1
  shift
  ECHOWAVE_API_PORT=$api_port docker compose \
    --project-directory "$directory" \
    -f "$directory/compose.yaml" \
    "$@"
}

cleanup() {
  run_compose "$current_dir" down --volumes --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$smoke_root"
}
trap cleanup EXIT

prepare_config() {
  local directory=$1
  mkdir -p "$directory/.data/secrets"
  cp "$current_dir/api.env" "$directory/api.env"
}

wait_for_api() {
  local directory=$1
  local expected_version=$2
  for _ in $(seq 1 60); do
    if curl --fail --silent --show-error "http://127.0.0.1:${api_port}/health" \
      | jq --exit-status --arg version "$expected_version" \
        '.status == "ok" and .version == $version and .apiVersion == 1' >/dev/null; then
      curl --fail --silent --show-error "http://127.0.0.1:${api_port}/api/hello" \
        | jq --exit-status '.ok == true and .message == "HelloWorld"' >/dev/null
      curl --fail --silent --show-error "http://127.0.0.1:${api_port}/api/groups" \
        | jq --exit-status '.items | type == "array"' >/dev/null
      curl --fail --silent --show-error "http://127.0.0.1:${api_port}/api/knowledge-bases" \
        | jq --exit-status '.items | type == "array"' >/dev/null
      return 0
    fi
    sleep 2
  done
  run_compose "$directory" logs --no-color || true
  echo "Server v${expected_version} did not pass release smoke tests." >&2
  return 1
}

mkdir -p "$current_dir"
unzip -q "$current_zip" -d "$current_dir"
cp "$current_dir/api.env.example" "$current_dir/api.env"
master_key=$(openssl rand -base64 32 | tr -d '\n')
sed -i "s|replace-with-base64-32-byte-key|${master_key}|" "$current_dir/api.env"
mkdir -p "$current_dir/.data/secrets"

if [[ -n "$previous_tag" ]]; then
  mkdir -p "$previous_dir"
  gh release download "$previous_tag" \
    --repo "$GITHUB_REPOSITORY" \
    --pattern "EchoWave-server-${previous_tag}.zip" \
    --dir "$smoke_root/previous-download"
  unzip -q "$smoke_root/previous-download/EchoWave-server-${previous_tag}.zip" -d "$previous_dir"
  prepare_config "$previous_dir"
  previous_version=${previous_tag#v}

  run_compose "$previous_dir" pull
  run_compose "$previous_dir" up -d
  wait_for_api "$previous_dir" "$previous_version"

  mkdir -p "$smoke_root/backups"
  run_compose "$previous_dir" exec -T postgres sh -c \
    'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump --format=custom --no-owner --no-acl -U "$POSTGRES_USER" "$POSTGRES_DB"' \
    > "$smoke_root/backups/before-${current_version}.dump"
  test -s "$smoke_root/backups/before-${current_version}.dump"
fi

run_compose "$current_dir" pull
run_compose "$current_dir" up -d
wait_for_api "$current_dir" "$current_version"

if [[ -n "$previous_tag" ]]; then
  run_compose "$previous_dir" up -d
  wait_for_api "$previous_dir" "${previous_tag#v}"
fi
