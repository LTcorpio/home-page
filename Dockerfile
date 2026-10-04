# 构建阶段：编译 Go 二进制（基础镜像统一走 Docker Hub 官方源，不使用第三方镜像源）
FROM golang:1.24-alpine@sha256:8bee1901f1e530bfb4a7850aa7a479d17ae3a18beb6e09064ed54cfd245b7191 AS builder

ENV GOPROXY=https://goproxy.cn,direct \
    CGO_ENABLED=0 \
    GOOS=linux

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o home-page -ldflags="-s -w" .

# 运行阶段：最小镜像，前端已 go:embed 进二进制
FROM alpine:latest@sha256:294b683cb724975bec92580e1e685676bd4b50bda910ddb8c51d4cabeaec77e6
RUN apk --no-cache add ca-certificates tzdata
WORKDIR /app
COPY --from=builder /app/home-page /app/home-page

ENV TZ=Asia/Shanghai \
    PORT=80 \
    DATA_DIR=/data \
    HOST_PROC=/host/proc \
    HOST_ROOT=/host \
    DOCKER_SOCK=/var/run/docker.sock

EXPOSE 80
ENTRYPOINT ["/app/home-page"]
