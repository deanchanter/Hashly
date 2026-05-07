#!/usr/bin/env bash
# Run Claude Code inside a Docker container (tmux session named "claude").
# Mounts the current directory and your ~/.claude config in.
# Auto-rebuilds the image when Dockerfile.claude is newer than the cached one.
set -euo pipefail

IMAGE="hashly/claude-code:latest"
DOCKERFILE="$(dirname "$0")/Dockerfile.claude"

# Preflight: warn if Docker Desktop is under-resourced. Rust + webkit2gtk
# builds and parallel agent-team tmux panes thrash on the 2 CPU / 2 GB default.
MIN_CPUS=3
MIN_MEM_GB=5
if ! docker_info=$(docker info --format '{{.NCPU}} {{.MemTotal}}' 2>/dev/null); then
    echo "ERROR: cannot reach the Docker daemon. Start Docker Desktop and retry." >&2
    exit 1
fi
read -r docker_cpus docker_mem_bytes <<<"$docker_info"
docker_mem_gb=$(( docker_mem_bytes / 1024 / 1024 / 1024 ))
if [ "$docker_cpus" -lt "$MIN_CPUS" ] || [ "$docker_mem_gb" -lt "$MIN_MEM_GB" ]; then
    echo "WARN: Docker Desktop allocation is low (${docker_cpus} CPU, ${docker_mem_gb} GB RAM)." >&2
    echo "      Recommended: >= ${MIN_CPUS} CPUs and >= ${MIN_MEM_GB} GB RAM." >&2
    echo "      Bump in Docker Desktop > Settings > Resources, then restart Docker." >&2
fi

needs_build=1
if docker image inspect "$IMAGE" >/dev/null 2>&1; then
    image_iso=$(docker image inspect -f '{{.Created}}' "$IMAGE")
    stamp=$(mktemp)
    if touch -d "$image_iso" "$stamp" 2>/dev/null && [ ! "$DOCKERFILE" -nt "$stamp" ]; then
        needs_build=0
    fi
    rm -f "$stamp"
fi
if [ "$needs_build" = 1 ]; then
    docker build -t "$IMAGE" -f "$DOCKERFILE" "$(dirname "$0")"
fi

mkdir -p "$HOME/.config/gh"

exec docker run --rm -it \
    -v "$PWD":/workspace \
    -v "$HOME/.claude":/home/node/.claude \
    -v "$HOME/.claude":"$HOME/.claude" \
    -v "$HOME/.config/gh":/home/node/.config/gh \
    -w /workspace \
    "$IMAGE" --dangerously-skip-permissions "$@"
