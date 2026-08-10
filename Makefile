SHELL := /bin/bash
.DEFAULT_GOAL := help

NPM ?= npm
SERVICE_NAME := pocket-claude
SYSTEMD_USER_DIR := $(HOME)/.config/systemd/user
SERVICE_FILE := $(SYSTEMD_USER_DIR)/$(SERVICE_NAME).service

.PHONY: help setup install env doctor run start dev check lint format test coverage \
        ci verify clean reset service service-start service-stop service-restart \
        service-status logs service-uninstall

## help: Show this help
help:
	@echo "PocketClaude — Claude Code from Telegram"
	@echo ""
	@echo "Quick start:"
	@echo "  make setup      Install everything and create .env"
	@echo "  <edit .env>     Fill in the 4 required variables"
	@echo "  make run        Start the bot"
	@echo ""
	@echo "All targets:"
	@sed -n 's/^## //p' $(MAKEFILE_LIST) | awk -F': ' '{printf "  \033[36m%-20s\033[0m %s\n", $$1, $$2}'

## setup: One-command bootstrap — install dependencies and create .env
setup: install env
	@echo ""
	@echo "Setup complete."
	@echo "Next: edit .env, then run 'make run'."
	@echo "Tip: run 'make doctor' to verify your configuration."

## install: Install Node dependencies
install:
	@$(NPM) install

## env: Create .env from .env.example if it does not exist
env:
	@if [ -f .env ]; then \
		echo ".env already exists — leaving it untouched."; \
	else \
		cp .env.example .env; \
		echo "Created .env from .env.example."; \
	fi

## doctor: Check prerequisites and .env configuration
doctor: node_modules
	@$(NPM) run doctor

## run: Start the bot (installs dependencies if needed)
run: node_modules
	@$(NPM) run start

## start: Alias for run
start: run

## dev: Start the bot with auto-reload on file changes
dev: node_modules
	@$(NPM) run dev

## check: Type-check the project
check: node_modules
	@$(NPM) run typecheck

## lint: Check formatting and lint rules
lint: node_modules
	@$(NPM) run lint

## format: Apply formatting and safe lint fixes
format: node_modules
	@$(NPM) run format

## test: Run the test suite
test: node_modules
	@$(NPM) run test

## coverage: Run the test suite with a coverage report
coverage: node_modules
	@$(NPM) run test:coverage

## ci: Gates that run without a .env (used by GitHub Actions)
ci: check lint test

## verify: Definition of done — types, lint, tests and configuration
verify: ci doctor
	@echo ""
	@echo "All gates passed."

## reset: Forget every chat's project and session mapping
reset:
	@rm -rf data
	@echo "Session state cleared."

## clean: Remove dependencies and build state
clean:
	@rm -rf node_modules data
	@echo "Cleaned."

node_modules: package.json
	@$(NPM) install
	@touch node_modules

## service: Install and enable a systemd user service (keeps the bot running)
service: node_modules
	@mkdir -p $(SYSTEMD_USER_DIR)
	@printf '%s\n' \
		'[Unit]' \
		'Description=PocketClaude — Claude Code from Telegram' \
		'After=network-online.target' \
		'Wants=network-online.target' \
		'' \
		'[Service]' \
		'Type=simple' \
		'WorkingDirectory=$(CURDIR)' \
		'ExecStart=$(shell command -v npm) run start' \
		'Restart=always' \
		'RestartSec=5' \
		'Environment=NODE_ENV=production' \
		'' \
		'[Install]' \
		'WantedBy=default.target' \
		> $(SERVICE_FILE)
	@systemctl --user daemon-reload
	@systemctl --user enable --now $(SERVICE_NAME)
	@echo "Service installed and started: $(SERVICE_FILE)"
	@echo "Run 'loginctl enable-linger $(USER)' so it survives logout."
	@echo "Follow logs with 'make logs'."

## service-start: Start the systemd service
service-start:
	@systemctl --user start $(SERVICE_NAME)

## service-stop: Stop the systemd service
service-stop:
	@systemctl --user stop $(SERVICE_NAME)

## service-restart: Restart the systemd service
service-restart:
	@systemctl --user restart $(SERVICE_NAME)

## service-status: Show the systemd service status
service-status:
	@systemctl --user status $(SERVICE_NAME) --no-pager

## logs: Follow the systemd service logs
logs:
	@journalctl --user -u $(SERVICE_NAME) -f

## service-uninstall: Disable and remove the systemd service
service-uninstall:
	@systemctl --user disable --now $(SERVICE_NAME) 2>/dev/null || true
	@rm -f $(SERVICE_FILE)
	@systemctl --user daemon-reload
	@echo "Service removed."
