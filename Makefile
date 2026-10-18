# BS 聊天服务器 — 常用命令
SHELL := /bin/bash

COMPOSE ?= podman compose
SERVICE ?= postgres
CONTAINER ?= bs-postgres
VOLUME ?= bs_pgdata

.DEFAULT_GOAL := help
.PHONY: help up down restart ps logs psql migrate seed test reset

help:
	@echo "用法：make <目标>"
	@echo ""
	@echo "  up        启动服务（podman compose up -d）"
	@echo "  down      停止并删除容器（保留数据卷 $(VOLUME)）"
	@echo "  restart   重启 postgres"
	@echo "  ps        查看 compose 状态"
	@echo "  logs      跟踪 postgres 日志"
	@echo "  psql      进入 psql"
	@echo "  migrate   执行数据库迁移"
	@echo "  seed      写入种子数据"
	@echo "  test      运行测试"
	@echo "  reset     删除容器和数据卷并重建（危险，需 CONFIRM=yes）"

up:
	$(COMPOSE) up -d

down:
	$(COMPOSE) down

restart:
	$(COMPOSE) restart $(SERVICE)

ps:
	$(COMPOSE) ps

logs:
	$(COMPOSE) logs -f --tail=100 $(SERVICE)

psql:
	@set -a; . ./.env; set +a; \
	podman exec -it $(CONTAINER) psql -U "$$POSTGRES_USER" -d "$$POSTGRES_DB"

migrate:
	npm run db:migrate

seed:
	npm run db:seed

test:
	npm test

reset:
	@if [ "$(CONFIRM)" != "yes" ]; then \
		echo "拒绝执行：make reset 会删除容器和数据卷 $(VOLUME)，数据库数据将全部丢失。"; \
		echo "确认请执行：make reset CONFIRM=yes"; \
		exit 1; \
	fi
	$(COMPOSE) down
	podman volume rm -f $(VOLUME) || true
	podman volume create $(VOLUME)
	$(COMPOSE) up -d
