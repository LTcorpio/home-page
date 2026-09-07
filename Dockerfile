# 构建阶段：编译 Go 二进制（基础镜像走国内镜像源）
FROM docker.m.daocloud.io/golang:1.24-alpine AS builder

ENV GOPROXY=https://goproxy.cn,direct \
    CGO_ENABLED=0 \
    GOOS=linux

WORKDIR /app
COPY go.mod go.sum ./
RUN go mod download
COPY . .
RUN go build -o home-page -ldflags="-s -w" .

# 运行阶段：最小镜像，前端已 go:embed 进二进制
FROM alpine:latest
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
