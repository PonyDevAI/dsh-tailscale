# CHANGELOG

## 0.2.0 (unreleased)

- 统一系统 Tailscale 向导：检测 → 自动安装（brew 优先，官方 pkg + 系统授权回退）→ 启动 → 登录（AuthURL 本地二维码 / auth key）→ 配置 hostname。
- 新增 `lib/setup.js`（安装/启动/登录/主机名管理）；auth key 走 0600 临时文件 + `--auth-key=file:`，不入日志/不落盘。
- 新增 RPC：`setup` / `install` / `start` / `auth-url` / `login` / `hostname`；`summary()`/`snapshot()` 带 setup 信息。
- Client：安装卡（含进度日志轮询）、Tailscale 登录卡（本地二维码 + auth key）、节点 hostname 卡（二次确认），二维码用 vendored MIT qrcode-generator 本地生成。
- 配置：`allowAutoInstall`（默认 true）、`installMethod`、`authKeyEnv`。

## 0.1.1 (unreleased)

- 会话头部新增 Tailscale 图标：绿/红/灰状态点、30s 轮询（页面隐藏暂停）、悬停显示在线状态/域名/入口/设备数；点击打开「设置 → 远程访问」。
- 新增低开销 RPC `POST /tailscale/status`（只读缓存 status + 状态文件，不查 serve）。
- 修复 HMR 重载竞态：状态文件记录 `instanceId`，旧实例不再撤掉新实例的入口与 trustedHosts。
- 自动发布后 1.2s 校验重建 + 60s 低频自愈（仅 autoPublish 时），修复外部 `serve reset`、Tailscale 重启等导致的入口漂移。
- 测试 62 用例（新增 summary / instanceId / superseded / status 端点 / HMR 校验）。

## 0.1.0 (unreleased)

- 初始版本：入站远程入口（serve 四态认领、trustedHosts、登录链接）+ 出站 tailnet 设备感知服务（`ctx.tailscale`）+ 设置页「远程访问」。
