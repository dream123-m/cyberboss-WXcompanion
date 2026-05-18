# GitHub 提交清单

这份清单用来区分：哪些改动适合提交到公开仓库，哪些需要先确认，哪些不要提交。

## 建议提交

这些是源码能力或公开配置示例，可以作为你 fork 后的新功能提交：

- `.gitignore`
- `.env.example`
- `package.json`
- `package-lock.json`
- `scripts/dashboard-page.js`
- `scripts/dashboard-server.js`
- `scripts/nightly.py`
- `scripts/start-cyberboss.ps1`
- `scripts/status-cyberboss.ps1`
- `scripts/stop-cyberboss.ps1`
- `scripts/install-cyberboss-startup-task.ps1`
- `scripts/uninstall-cyberboss-startup-task.ps1`
- `scripts/login-browser.js`
- `scripts/normalize-sticker-gif.js`
- `scripts/shared-common.js`
- `scripts/shared-open.js`
- `scripts/shared-start.js`
- `scripts/shared-status.js`
- `src/core/app.js`
- `src/core/config.js`
- `src/core/system-message-dispatcher.js`
- `src/core/system-message-queue-store.js`
- `src/core/thread-state-store.js`
- `src/core/turn-gate-store.js`
- `src/services/state-service.js`
- `src/services/sticker-service.js`
- `src/tools/create-project-tooling.js`
- `src/tools/tool-host.js`
- `src/app/system-checkin-poller.js`
- `src/adapters/runtime/codex/rpc-client.js`
- `src/adapters/runtime/codex/mcp-config.js`
- `src/adapters/runtime/claudecode/process-client.js`
- `src/integrations/timeline/index.js`
- `templates/weixin-instructions.md`
- `templates/weixin-operations.md`
- `test/state-service.test.js`
- `test/tool-host.test.js`
- `test/turn-gate-store.test.js`

## 不要提交

这些是本地运行产物、二进制包装器或私密状态，公开仓库不需要：

- `.env`
- `.mcp.json`
- `.vscode/`
- `.claude/settings.local.json`
- `scripts/hidden-git.cs`
- `scripts/hidden-stdio-launcher.cs`
- `scripts/*.exe`
- `scripts/shims/`
- `C:\Users\<you>\.cyberboss\*`
- 日记、微信账号、context token、sessions、logs、pid、inbox、私有表情素材

## 建议分批 commit

不要一次性把所有东西塞进一个提交。建议拆成：

1. `Add dashboard and local dashboard server`
2. `Add nightly self-check pass`
3. `Add durable private state tools`
4. `Improve turn recovery and system message retry`
5. `Improve stickers and Windows shared startup`
6. `Add GitHub docs and env example`

## 安全提交命令示例

先只 add 明确要提交的文件：

```powershell
git add .gitignore .env.example README.fork.md docs/github-submit-checklist.md
git add package.json package-lock.json
git add scripts/dashboard-page.js scripts/dashboard-server.js scripts/nightly.py
git add scripts/start-cyberboss.ps1 scripts/status-cyberboss.ps1 scripts/stop-cyberboss.ps1
git add scripts/install-cyberboss-startup-task.ps1 scripts/uninstall-cyberboss-startup-task.ps1 scripts/login-browser.js
git add scripts/normalize-sticker-gif.js scripts/shared-common.js scripts/shared-open.js scripts/shared-start.js scripts/shared-status.js
git add src/core/app.js src/core/config.js src/core/system-message-dispatcher.js src/core/system-message-queue-store.js src/core/thread-state-store.js src/core/turn-gate-store.js
git add src/services/state-service.js src/services/sticker-service.js
git add src/tools/create-project-tooling.js src/tools/tool-host.js
git add src/app/system-checkin-poller.js
git add src/adapters/runtime/codex/rpc-client.js src/adapters/runtime/codex/mcp-config.js src/adapters/runtime/claudecode/process-client.js
git add src/integrations/timeline/index.js
git add templates/weixin-instructions.md templates/weixin-operations.md
git add test/state-service.test.js test/tool-host.test.js test/turn-gate-store.test.js
git status --short
```

确认没有 `.env`、`.cyberboss`、`.exe`、`scripts/shims/` 后再 commit。
