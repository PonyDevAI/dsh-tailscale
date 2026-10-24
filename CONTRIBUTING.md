# 贡献指南

## 环境要求

- Node.js 22.5+（CI 使用 Node 24）
- 已安装 DSH（`@deepseek-ai/dsh` ≥ 0.2.0-rc.2）
- 已安装 Tailscale（插件管理本机这一套；开发时不需要登录，冒烟测试用假 CLI）
- 本地开发无需构建（ESM 手写 bundle，无打包步骤、无运行时依赖）

## 本地开发

```bash
# 1. 把仓库以符号链接方式装进 DSH web profile
dsh plugin --profile web add link:$PWD

# 2. Host 侧（lib/index.js、lib/service.js、lib/cli.js、lib/serve.js、lib/trust.js、
#    lib/devices.js、lib/probe.js、lib/setup.js、lib/state.js、lib/update.js）
#    改完重启宿主；或 touch profile 的 cordis.patch.yml 触发重组合
launchctl kickstart -k gui/$(id -u)/local.deepseek-harness.web

# 3. Client 侧（lib/client.js）改完保存后浏览器通常免刷新（dsh-client-hmr），否则 ⌘⇧R
```

入口验证：打开 **设置 → 远程访问**，或用会话头部右上角的 Tailscale 图标直接跳转。

> 冒烟测试完全离线（`scripts/fake-tailscale.mjs` 模拟 CLI + 临时目录），不会调用真实 `tailscale`，也不会改你的 serve 配置。**不要在测试里跑真实安装/登录命令。**

## 提交前检查

```bash
for f in lib/*.js; do node --check "$f"; done   # 语法
node scripts/smoke.mjs                          # 冒烟（离线，80+ 断言）
node scripts/check-i18n.mjs                     # zh/en 键一致 + tr('key') 不缺键
npm pack --dry-run                              # 发布内容检查（本机 npm 缓存异常时用 pnpm -s pack --dry-run）
```

CI（`.github/workflows/ci.yml`）在 push `main` / PR 时重复执行以上检查，失败不合并。

## 代码约定（摘要，完整见 [AGENTS.md](AGENTS.md)）

- ESM、零运行时依赖、无构建工具；Host 与 Client 不互相 import
- 系统命令一律 `execFile` + 参数数组 + 超时，不经过 shell
- **安全红线**：绝不自动 `tailscale up/down/login`；绝不 Funnel；绝不 `serve reset`；auth key 不落盘不进日志；`/tailscale/*` 必经 `connection.admit()`；二维码本地生成；不改系统节点身份（hostname 需用户显式确认）
- 状态机语言统一：`正常 / 未安装 / 未运行 / 未登录 / HTTPS 未启用 / 路由冲突 / 信任未生效`；每个状态一个主动作
- UI 不 import primitives，只用 `--dsw-*` token；文案走 zh/en i18n；设置页不写说明性长文
- 预期内的不可用（未安装/未运行/未登录）不抛异常、不刷日志，走 `health()` 与状态字段

## 测试分层

| 层 | 做法 |
|---|---|
| 纯函数 | `devices.js` / `serve.js` / `trust.js` 用 fixture 单测（`scripts/fixtures/*.json`） |
| CLI 层 | `scripts/fake-tailscale.mjs` 覆盖未运行、未登录、HTTPS 未启用、路由冲突、超时、非 JSON 输出 |
| 服务层 | `smoke.mjs` 断言 publish → 状态文件 → adopt → unpublish，以及降级路径 |
| RPC | 未认证 401 / 非 POST 405 / 坏 JSON 400 / 正常快照字段完整 |
| i18n | `scripts/check-i18n.mjs`（CI 强制） |

## 提交规范

- Conventional Commits：`feat:` `fix:` `docs:` `ci:` `chore:` `refactor:` `test:`
- 一个提交一件事；说明"为什么"而不是"改了什么"
- 不要提交 `node_modules/`、`*.tgz`、`*.log`、密钥、临时脚本、截图调试残留
- 不要用 `-c user.email=` 覆盖作者身份，不要写 AI 署名

## 发布

不手动发布。`npm version patch|minor|major` 后 `git push --follow-tags`，详见 [RELEASE.md](RELEASE.md)。

## Issue / PR

- Bug 请附：DSH 版本、Tailscale 版本（`tailscale version`）、复现步骤、设置页「诊断」结果、`~/Library/Logs/deepseek-harness/stderr.log` 相关片段
- 涉及 `status --json` / `serve status --json` 的请附**脱敏后**的结构样例（删除 DNSName、IP、节点公钥、token）
- **不要**在 issue/PR 里粘贴 auth key、登录链接（含 launch token）、cookie、完整二维码内容
- PR 描述写清楚：改了什么、为什么、如何验证（跑了哪些命令/在什么平台）

## 与相关插件的边界

- 只想把 Web 发布到 tailnet：本插件已经覆盖（入站）
- 要 adb/hdc/ssh 连接手机或终端：由消费方插件通过 `ctx.get('tailscale')` 实现，本插件不认协议
- 不要为了一个消费方的便利扩大 `probe()` 的探测范围，或把设备控制逻辑塞进本插件
