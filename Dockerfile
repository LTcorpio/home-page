# home-page 单镜像：React 前端构建产物 + Go 后端，单进程运行（Go 直接托管 dist，无 Caddy）。
#
# 构建（在仓库根目录）：
#   docker build -t home-page:latest .
# 运行：
#   docker run -d -p 8080:80 -v /path/to/home-page:/data -v /var/run/docker.sock:/var/run/docker.sock home-page:latest
#
# 说明：
#   - 前端在 node 阶段构建，产物拷到 /srv；后端以 WEB_ROOT=/srv 托管静态文件。
#   - 运行镜像内只跑一个进程，信号与日志直接由 home-page 处理。
#   - TLS 与 SSO 不在此容器终结：由宿主反向代理注入身份头。

FROM node:22-alpine AS web
WORKDIR /app
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

FROM golang:1.24-alpine AS api
WORKDIR /src
ENV CGO_ENABLED=0 \
    GOOS=linux \
    GOPROXY=https://goproxy.cn,direct
COPY backend/go.mod backend/go.sum ./
RUN go mod download
COPY backend/ ./
RUN go build -trimpath -ldflags="-s -w" -o /out/home-page .

FROM alpine:3.22
RUN apk --no-cache add ca-certificates tzdata \
 && mkdir -p /app /srv /data
COPY --from=api /out/home-page /app/home-page
COPY --from=web /app/dist /srv

ENV TZ=Asia/Shanghai \
    PORT=80 \
    DATA_DIR=/data \
    WEB_ROOT=/srv \
    HOST_PROC=/host/proc \
    HOST_ROOT=/host \
    DOCKER_SOCK=/var/run/docker.sock

WORKDIR /app
EXPOSE 80
ENTRYPOINT ["/app/home-page"]
