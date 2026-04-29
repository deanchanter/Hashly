#!/usr/bin/env bash
# Run Claude Code inside a Docker container (tmux session named "claude").
# Mounts the current directory and your ~/.claude config in.
# Auto-rebuilds the image when Dockerfile.claude is newer than the cached one.
set -euo pipefail

IMAGE="hashly/claude-code:latest"
DOCKERFILE="$(dirname "$0")/Dockerfile.claude"

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
    -v "$HOME/.config/gh":/home/node/.config/gh \
    -w /workspace \
    "$IMAGE" --dangerously-skip-permissions "$@"
