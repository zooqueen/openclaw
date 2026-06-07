#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
source "$ROOT_DIR/scripts/lib/docker-build.sh"
source "$ROOT_DIR/scripts/lib/docker-e2e-container.sh"
IMAGE_NAME="${OPENCLAW_QR_SMOKE_IMAGE:-openclaw-qr-smoke}"
DOCKER_BUILD_ARGS=()

qr_smoke_cpu_limit() {
  local requested="${OPENCLAW_QR_SMOKE_CPUS:-4}"
  local available=""

  if command -v getconf >/dev/null 2>&1; then
    available="$(getconf _NPROCESSORS_ONLN 2>/dev/null || true)"
  fi
  if [[ -z "${available// }" ]] && command -v nproc >/dev/null 2>&1; then
    available="$(nproc 2>/dev/null || true)"
  fi

  if [[ "$requested" =~ ^[1-9][0-9]*$ ]] && [[ "$available" =~ ^[1-9][0-9]*$ ]] && (( requested > available )); then
    printf '%s\n' "$available"
    return 0
  fi

  printf '%s\n' "$requested"
}

if [[ -z "${OPENCLAW_DOCKER_E2E_CPUS+x}" ]]; then
  export OPENCLAW_DOCKER_E2E_CPUS
  OPENCLAW_DOCKER_E2E_CPUS="$(qr_smoke_cpu_limit)"
fi

if [[ "${OPENCLAW_QR_SMOKE_FORCE_INSTALL:-0}" == "1" ]]; then
  INSTALL_CACHE_BUSTER="${GITHUB_SHA:-manual}-${GITHUB_RUN_ID:-$(date +%s)}-${GITHUB_RUN_ATTEMPT:-0}"
  DOCKER_BUILD_ARGS+=(
    --build-arg
    "OPENCLAW_QR_INSTALL_CACHE_BUSTER=${INSTALL_CACHE_BUSTER}"
  )
fi

echo "Building Docker image..."
docker_build_run qr-import-build \
  "${DOCKER_BUILD_ARGS[@]}" \
  -t "$IMAGE_NAME" \
  -f "$ROOT_DIR/scripts/e2e/Dockerfile.qr-import" \
  "$ROOT_DIR"

echo "Running qrcode import smoke..."
run_logged qr-import-run docker_e2e_docker_run_cmd run --rm -t "$IMAGE_NAME" node -e "import('qrcode').then(async (m)=>{const q=m.default??m;process.stdout.write(await q.toString('qr-smoke',{small:true,type:'terminal'}))})"
