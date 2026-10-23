#!/usr/bin/env bash
#
# home-page 本地开发一键启动：Go 后端(:18081) + Vite dev server(:5173)。
#
# 用法：
#   ./scripts/dev.sh                                    # 默认使用生产数据目录与生产库
#   BACKEND_ADDR=127.0.0.1:18099 ./scripts/dev.sh       # 自定义后端监听地址
#   FRONTEND_PORT=5174 ./scripts/dev.sh                 # 自定义前端端口
#   FRONTEND_HOST=127.0.0.1 ./scripts/dev.sh            # 前端仅本机可访问（默认 0.0.0.0）
#   DATA_DIR=/tmp/home-page-data ./scripts/dev.sh       # 改用独立数据目录（不碰生产库）
#   VITE_DEV_USER=alice VITE_DEV_GROUPS=admins ./scripts/dev.sh   # 自定义开发态调试身份
#
# 默认直接使用生产数据目录（home-page.db 与 icons/），即开发时读写的就是生产库。
# 若生产容器 home-page 同时在运行，两个进程会共享同一个 SQLite 文件：脚本会打印提醒，
# 需要绝对隔离时先 `docker stop home-page`，开发完成后再 `make deploy`。
#
# 局域网访问统一走前端入口 http://<本机IP>:5173，/api 与 /icons 由 Vite 代理到本机后端；
# 后端默认只监听 127.0.0.1，不直接暴露到局域网。
#
# 退出（Ctrl-C）时会一并关闭后端进程。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 载入根目录 .env（存在时），其中的变量可作为下面的默认值。
if [ -f "${ROOT}/.env" ]; then
  set -a
  # shellcheck disable=SC1091
  . "${ROOT}/.env"
  set +a
fi

DATA_DIR="${DATA_DIR:-/Volumes/ZHITAI TiPlus5000 1TB/Docker/compose/lifestyle/home-page}"
BACKEND_ADDR="${BACKEND_ADDR:-127.0.0.1:18081}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
FRONTEND_HOST="${FRONTEND_HOST:-0.0.0.0}"
DEV_USER="${VITE_DEV_USER:-dev}"
DEV_GROUPS="${VITE_DEV_GROUPS:-admins}"

# 探测本机局域网 IP（遍历物理网卡取第一个 IPv4；探测失败不影响启动）。
LAN_IP=""
for iface in $(ifconfig -l 2>/dev/null); do
  case "$iface" in lo0|gif0|stf0|anpi*|awdl*|llw*|bridge*|utun*|ap*|vmenet*|XHC*) continue ;; esac
  ip="$(ipconfig getifaddr "$iface" 2>/dev/null || true)"
  if [ -n "$ip" ]; then LAN_IP="$ip"; break; fi
done

BACKEND_PORT="${BACKEND_ADDR##*:}"

command -v go >/dev/null 2>&1 || { echo "未找到 go，请先安装 Go 工具链"; exit 1; }
command -v npm >/dev/null 2>&1 || { echo "未找到 npm，请先安装 Node.js"; exit 1; }

if [ ! -d "${DATA_DIR}" ]; then
  echo "数据目录不存在: ${DATA_DIR}"
  echo "生产库目录必须已存在（不会自动新建，避免误用空库）。如确实需要独立库，请先创建目录或设置 DATA_DIR。"
  exit 1
fi

echo "==> 数据目录（生产库）: ${DATA_DIR}"
if [ -f "${DATA_DIR}/home-page.db" ]; then
  echo "    数据库文件: ${DATA_DIR}/home-page.db"
else
  echo "    数据库文件尚不存在，首次启动会新建（若生产容器在跑，请先确认路径是否正确）"
fi

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' 2>/dev/null | grep -qx 'home-page'; then
  echo ""
  echo "⚠ 生产容器 home-page 正在运行：开发后端会同时读写同一个 SQLite 库。"
  echo "  并发写入存在风险；如需完全隔离，先执行: docker stop home-page"
  echo ""
fi

if [ ! -d "${ROOT}/frontend/node_modules" ]; then
  echo "==> 安装前端依赖（首次运行）"
  (cd "${ROOT}/frontend" && npm install)
fi

echo "==> 启动后端: ${BACKEND_ADDR}"
(cd "${ROOT}/backend" && ADDR="${BACKEND_ADDR}" DATA_DIR="${DATA_DIR}" go run .) &
BACKEND_PID=$!

cleanup() {
  echo ""
  echo "==> 关闭后端 (pid ${BACKEND_PID})"
  kill "${BACKEND_PID}" 2>/dev/null || true
  wait "${BACKEND_PID}" 2>/dev/null || true
}
trap cleanup EXIT INT TERM

# 等后端就绪后再起前端，避免首屏 API 请求全部失败
for _ in $(seq 1 60); do
  if curl -fsS "http://127.0.0.1:${BACKEND_PORT}/api/board" >/dev/null 2>&1; then
    break
  fi
  if ! kill -0 "${BACKEND_PID}" 2>/dev/null; then
    echo "后端启动失败，请查看上方日志"
    exit 1
  fi
  sleep 0.2
done

echo "==> 开发态身份（Vite 代理注入）: ${DEV_USER}（组: ${DEV_GROUPS}）"
echo "==> 启动前端: http://${FRONTEND_HOST}:${FRONTEND_PORT}  /api 代理到 http://127.0.0.1:${BACKEND_PORT}"
if [ "${FRONTEND_HOST}" = "0.0.0.0" ] && [ -n "${LAN_IP}" ]; then
  echo "==> 局域网访问: http://${LAN_IP}:${FRONTEND_PORT}"
fi

cd "${ROOT}/frontend"
VITE_API_TARGET="http://127.0.0.1:${BACKEND_PORT}" \
VITE_DEV_USER="${DEV_USER}" \
VITE_DEV_NAME="${VITE_DEV_NAME:-Dev Admin}" \
VITE_DEV_GROUPS="${DEV_GROUPS}" \
npx vite --port "${FRONTEND_PORT}" --host "${FRONTEND_HOST}"
