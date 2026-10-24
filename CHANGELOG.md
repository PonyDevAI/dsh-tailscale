# CHANGELOG

## 0.2.3 — 2026-10-24

### 修复
- 头部图标不再继承按钮的“次要灰”状态：mark 固定品牌色（浅色主题近黑底白点 / 深色主题近白底黑点），未选中、hover、选中观感一致；悬停不再改变图标颜色。

## 0.2.2 — 2026-10-24

### 变更
- 会话头部图标改为 Tailscale 官方风格 mark（深色圆角方块 + 3×3 九点），在线状态仍由右下角圆点表示；比原来的“六个点”更容易辨认。

## 0.2.1 — 2026-10-24

### 新增
- 远程入口和登录链接都支持**本地二维码**：手机扫一下即可打开（入口二维码给已登录设备，登录链接二维码用于首次登录/新设备；二维码在浏览器本地生成，不含任何外部请求）。
- 验证 npm Trusted Publisher（OIDC）自动发布链路：tag `v0.2.1` 由 GitHub Actions 直接发布，无需本地 2FA。

## 0.2.0 — 2026-10-24

### 新增
- 统一系统 Tailscale 向导：检测 → 自动安装（brew 优先，官方 pkg + 系统授权回退）→ 启动 → 登录（AuthURL 本地二维码 / auth key）→ 配置 hostname，全部在「设置 → 远程访问」内完成。
- 设置页新增安装卡（含安装进度日志轮询）、Tailscale 登录卡（本地二维码 + auth key）、节点 hostname 卡（二次确认）。
- 会话头部 Tailscale 图标：绿/红/灰状态点、悬停摘要、30 秒轮询（页面隐藏暂停）、点击直达「设置 → 远程访问」。
- 检查更新：设置页标题右侧显示当前版本，一键对比 npm 最新版并给出升级命令（10 分钟缓存）。
- 新增 RPC：`setup` / `install` / `start` / `auth-url` / `login` / `hostname` / `update-check` / `status`；`summary()` 与 `snapshot()` 带 setup 信息。
- 发布物料：CI、Release（tag 触发 + npm Trusted Publishing）、AGENTS/CONTRIBUTING/RELEASE、i18n 与 release-notes 脚本、UI 截图。

### 修复
- HMR 重载竞态：旧实例的异步 dispose 可能撤掉新实例的入口；状态文件记录 `instanceId`，旧实例不再撤销他人路由与 trustedHosts。
- 入口漂移自愈：自动发布后 1.2s 校验重建 + 60s 低频自愈，覆盖外部 `serve reset`、Tailscale 重启等场景。
- App Store 版 Tailscale CLI 在无 `TERM` 环境下的"假成功"（stdout 报 GUI 失败、exit 0）：子进程补 `TERM` 并校验版本输出。
- 发布失败不再留孤路由：创建/认领后若状态写入或信任桥失败会回滚；撤回失败会如实上抛，不静默留下指向已退出进程的路由。

### 安全
- auth key 只走 0600 临时文件 + `tailscale up --auth-key=file:`，不出现在进程参数、日志、状态文件；错误信息做 `tskey-***` 正则脱敏。
- 二维码由 vendored MIT `qrcode-generator` 在浏览器本地生成，AuthURL / 登录链接不出本机。
- `/tailscale/*` 全部经过 `connection.admit()`；不启用 Funnel；不改系统节点身份除非用户显式二次确认。

## 0.1.1 — 2026-10-24

### 新增
- 会话头部 Tailscale 图标（在线/离线状态点、打开设置）。
- `POST /tailscale/status` 轻量状态端点。

### 修复
- HMR 重载竞态与入口漂移（见 0.2.0 修复项）。

## 0.1.0 — 2026-10-24

### 新增
- 远程入口：`tailscale serve` 四态认领（absent/exact/stale/conflict）、运行期 trustedHosts、登录链接、退出只撤自己那条路由。
- `ctx.tailscale` 服务：`status/devices/device/publication/health/snapshot/publish/unpublish/loginUrl/probe/subscribe`。
- 设备感知与初始设置页（状态/入口/设备/诊断）。
