# home-page 常用命令
#
#   make dev      # 本地开发：后端(127.0.0.1:18081) + 前端 dev server(0.0.0.0:5173)
#   make deploy   # 一键部署到本机 lifestyle 栈（构建镜像 + 重建容器）

LIFESTYLE_DIR ?= "/Volumes/ZHITAI TiPlus5000 1TB/Docker/compose/lifestyle"
COMPOSE := docker compose -f $(LIFESTYLE_DIR)/docker-compose.yml

.PHONY: dev deploy build

dev:
	./scripts/dev.sh

deploy: build
	$(COMPOSE) up -d --no-deps --force-recreate home-page
	$(COMPOSE) ps home-page

# 构建镜像（compose 中 home-page 只声明 image，没有 build 段，故由本仓库构建）
build:
	docker build -t home-page:latest .
