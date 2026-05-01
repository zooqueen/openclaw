#!/usr/bin/env bash

DOCKER_BUILD_LIB_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

if ! declare -F run_logged >/dev/null 2>&1; then
  source "$DOCKER_BUILD_LIB_DIR/docker-e2e-logs.sh"
fi

docker_build_on_missing_enabled() {
  case "${OPENCLAW_DOCKER_BUILD_ON_MISSING:-}" in
    1 | true | TRUE | yes | YES)
      return 0
      ;;
    0 | false | FALSE | no | NO)
      return 1
      ;;
  esac

  [ "${OPENCLAW_TESTBOX:-0}" = "1" ]
}

docker_build_command() {
  local build_cmd=(docker build)
  if [ "${OPENCLAW_DOCKER_BUILD_USE_BUILDX:-0}" = "1" ]; then
    build_cmd=(docker buildx build --load)
    if [ -n "${OPENCLAW_DOCKER_BUILD_CACHE_FROM:-}" ]; then
      build_cmd+=(--cache-from "${OPENCLAW_DOCKER_BUILD_CACHE_FROM}")
    fi
    if [ -n "${OPENCLAW_DOCKER_BUILD_CACHE_TO:-}" ]; then
      build_cmd+=(--cache-to "${OPENCLAW_DOCKER_BUILD_CACHE_TO}")
    fi
  fi

  printf '%s\0' env DOCKER_BUILDKIT=1 "${build_cmd[@]}" "$@"
}

docker_build_transient_failure() {
  local log_file="$1"
  grep -Eqi \
    'frontend grpc server closed unexpectedly|failed to dial gRPC|no active session|buildkit.*connection.*closed|rpc error: code = Unavailable' \
    "$log_file"
}

docker_build_retry_count() {
  local configured="${OPENCLAW_DOCKER_BUILD_RETRIES:-2}"
  if [[ "$configured" =~ ^[0-9]+$ ]]; then
    echo "$configured"
    return 0
  fi
  echo 2
}

docker_build_cache_attr() {
  local spec="$1"
  local key="$2"
  local part
  IFS=',' read -r -a parts <<<"$spec"
  for part in "${parts[@]}"; do
    if [[ "$part" == "$key="* ]]; then
      printf '%s\n' "${part#*=}"
      return 0
    fi
  done
}

docker_build_promote_local_cache() {
  local cache_from="${OPENCLAW_DOCKER_BUILD_CACHE_FROM:-}"
  local cache_to="${OPENCLAW_DOCKER_BUILD_CACHE_TO:-}"
  if [[ "$cache_from" != type=local,* ]] || [[ "$cache_to" != type=local,* ]]; then
    return 0
  fi

  local src
  local dest
  src="$(docker_build_cache_attr "$cache_from" src)"
  dest="$(docker_build_cache_attr "$cache_to" dest)"
  if [ -z "$src" ] || [ -z "$dest" ] || [ "$src" = "$dest" ] || [ ! -d "$dest" ]; then
    return 0
  fi

  rm -rf "$src"
  mkdir -p "$(dirname "$src")"
  mv "$dest" "$src"
}

docker_build_with_retries() {
  local label="$1"
  shift
  local retries
  retries="$(docker_build_retry_count)"
  local attempt=1
  local max_attempts=$((retries + 1))
  local log_file
  local command=()
  while IFS= read -r -d '' part; do
    command+=("$part")
  done < <(docker_build_command "$@")

  while true; do
    log_file="$(docker_e2e_run_log "$label")"
    if "${command[@]}" >"$log_file" 2>&1; then
      docker_build_promote_local_cache
      rm -f "$log_file"
      return 0
    fi

    if [ "$attempt" -ge "$max_attempts" ] || ! docker_build_transient_failure "$log_file"; then
      docker_e2e_print_log "$log_file"
      rm -f "$log_file"
      return 1
    fi

    echo "Docker build failed with a transient BuildKit transport error; retrying ($attempt/$retries)..." >&2
    docker_e2e_print_log "$log_file"
    rm -f "$log_file"
    attempt=$((attempt + 1))
    sleep "$attempt"
  done
}

docker_build_exec() {
  docker_build_with_retries docker-build "$@"
}

docker_build_run() {
  local label="$1"
  shift

  docker_build_with_retries "$label" "$@"
}
