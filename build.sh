#!/usr/bin/env bash
# 构建 home-page 镜像（源码目录内执行 ./build.sh）
set -euo pipefail
cd "$(dirname "$0")"

# 沙箱环境下 buildx 默认配置目录可能不可写，指到 /tmp 绕开
export BUILDX_CONFIG="${BUILDX_CONFIG:-/tmp/.buildx}"
export PATH="$PATH:/usr/local/bin"

docker build -t home-page:latest .
echo "镜像构建完成: home-page:latest"
