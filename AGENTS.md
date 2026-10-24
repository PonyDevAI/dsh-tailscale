# AGENTS.md — dsh-tailscale 项目规范（AI / 自动化代理）

本文件是**在这个仓库里工作时必须遵守的项目级规范**。全局规范见 `~/.dsh/AGENTS.md`；本文件只写项目特有约束。架构与阶段计划见 [`docs/DESIGN.md`](docs/DESIGN.md)。

## 0. 一句话

DSH Web 插件：**入站**把本机 DSH Web GUI 发布到 tailnet（`https://<节点>.<tailnet>.ts.net/`），**出站**把 tailnet 设备与可达性暴露成 `ctx.tailscale` 服务；同时统一管理本机这一套 Tailscale 的安装/启动/登录/主机名。

**能力边界**：只认 Tailscale（节点、路由、可达性），不认 adb/hdc/ssh；这些协议属于消费方插件（如 dsh-phone）。私网使用，**永不启用 Funnel**。

## 1. 目录与职责

```
lib/index.js      Host 入口（ctx.tailscale 注册、/tailscale/* RPC、自动发布/自愈/dispose 撤回）
lib/service.js    ctx.tailscale 实现（status/devices/publication/health/publish/loginUrl/probe/subscribe）
lib/cli.js        TailscaleCli：execFile + JSON 解析 + 超时 + 错误归类 + TTL 缓存
lib/serve.js      ServeManager：serve 四态判定（absent/exact/stale/conflict）、ensure/adopt/remove
lib/trust.js      TrustBridge：connection.trustedHosts 校验/推送/回滚（半公开 API，失败要降级）
lib/devices.js    status --json → TailnetDevice（纯函数，可单测）
lib/probe.js      tailnet TCP 可达性探测（单次 connect、短超时）
lib/setup.js      统一系统 Tailscale：检测/安装/启动/登录（AuthURL、auth key）/hostname
lib/update.js     检查更新（只读 npm registry，10 分钟缓存，不改任何配置）
lib/state.js      $DSH_HOME/tailscale.json（0600；只有 URL/端口/归属，无 token）
lib/client.js     浏览器 bundle（设置页「远程访问」+ 会话头部图标 + i18n + 本地二维码）
cordis.patch.yml  bundle 补丁（插入 tailscale 行、默认配置）
scripts/smoke.mjs 冒烟测试（假 CLI + 临时目录，完全离线，绝不调用真实 tailscale）
scripts/fake-tailscale.mjs  假 CLI（canned status/serve JSON）
scripts/check-i18n.mjs      zh/en 字典键一致 + 代码用键存在
scripts/release-notes.mjs   从 CHANGELOG 抽取当前版本条目
docs/DESIGN.md    架构与分阶段规划；docs/screenshots/ 截图
.github/workflows/ci.yml / release.yml
```

**约束**：Host 与 Client 不能互相 import；Client 不直接读文件/环境变量；跨端数据只走 RPC（`POST /tailscale/<endpoint>`，客户端用**相对路径**以兼容挂载前缀）。Host 侧分层：`index.js` 只做装配与路由，业务在 `service.js`，系统命令只在 `cli.js` / `setup.js`。

## 2. 修改前必须做

1. `git status`、`git log --oneline -3`，确认工作区状态（不要覆盖别人未提交的改动）
2. 涉及入口/路由/信任：先读 `docs/DESIGN.md` §3、§6、§10
3. 涉及安装/登录/主机名：读 `docs/DESIGN.md` §18
4. 涉及 Tailscale CLI 行为：以真实 `--json` 输出为准，**防御式解析**（字段缺失 = 未知，不要写死键名）

## 3. 提交前必须通过

```bash
for f in lib/*.js; do node --check "$f"; done   # 语法
node scripts/smoke.mjs                          # 冒烟：离线单元 + 服务层 + RPC 围栏（80+ 断言）
node scripts/check-i18n.mjs                     # zh/en 键一致 + tr('key') 不缺键
npm pack --dry-run                              # 发布内容检查（本机 npm 缓存异常时用 pnpm -s pack --dry-run）
```

CI 会重复执行以上检查（`.github/workflows/ci.yml`，Node 24）；失败不合并。

## 4. 代码规范

- **ESM only**，无构建步骤，零运行时依赖；不引入打包器/转译器
- 命名：camelCase；私有状态放闭包；不引入全局变量
- 错误：`TailscaleError(code, msg)`，code 用 `tailscale/*`；预期内的不可用（未安装/未运行/未登录/HTTPS 未启用）**不抛异常**，走 `health()` / 状态字段
- 日志：只在状态变化和真正的异常时打印；**禁止打印 token/cookie/auth key、完整命令输出、请求头**
- 命令执行：一律 `execFile` + 参数数组 + 超时，**不经过 shell**，不拼字符串命令
- 设备归一化：`Self` + `Peer` → `TailnetDevice[]`；离线节点也要保留；排序稳定（在线优先 → 本机优先 → hostName）
- 时间：`status.json` 的 `DNSName` 带尾点，展示/比较前统一 `stripDot()`；Proxy 比较要去尾斜杠
- 平台差异：macOS standalone/App Store 版 CLI 路径不同；host 进程（launchd）可能没有 `TERM`，子进程要补

## 5. 安全不变量（不可破坏）

1. **绝不自动执行 `tailscale up` / `down` / `login` / `logout`**。登录只能由用户在 UI 显式点击后发起（扫码 AuthURL 或 auth key）；插件永不 `down`、永不 `logout`
2. **绝不启用 Funnel**；health 检测到 `AllowFunnel` 要告警。只用 `serve`（tailnet 内）
3. **auth key 不落盘、不进日志、不回显**：只走环境变量或 Host 内存；临时文件必须 `0600` 且用完即删；错误信息脱敏
4. `/tailscale/*` 每个请求**必须先过 `connection.admit()`**：未认证 401、跨站 Origin 403；`login-url` 只对已认证请求现取现给
5. 二维码（AuthURL）**在本机前端生成**，内容不上传、不进日志、不进 DOM 之外的持久存储；展示 60s 后自动隐藏
6. **绝不 `serve reset`**（会清空用户全部 serve 配置）；只撤自己那条（末位 `off`）；`conflict` 只报错不覆盖
7. 状态文件 `$DSH_HOME/tailscale.json` 权限 `0600`，只含 URL/端口/归属（`instanceId`），**不含 token/cookie/auth key**
8. **不改系统 Tailscale 节点身份**（hostname）：默认不动；只有用户在设置页显式输入 + 二次确认后才执行 `tailscale set --hostname`，并提示影响整机（SSH、serve 域名、其他服务）
9. `probe()` 只探测 tailnet 地址或当前设备清单里的主机；单次 connect、短超时，不提供端口扫描循环
10. 安装等系统级操作**不静默提权**：只用系统授权弹窗（插件不接触密码），失败就给可复制命令

## 6. UI 规范（DSH 原生）

- 不 import primitives（避免绑死组件库版本）；颜色/圆角/字号只用 `--dsw-*` token，禁止硬编码色值（fallback 除外）
- 设置页只放**短标签 + 控件 + 一行提示**，不写说明性长文（口径/原理放 README / docs）
- 文案全走 i18n（`zh` / `en` 两个字典），不出现硬编码中文/英文
- 语言优先读 DSH 写在 `<html lang>` 上的活动语言；**禁止用 `navigator.language` 自行决定**；框架通过 `props.t` 注入时优先用 `props.t`
- zh/en 字典键必须完全一致，CI 用 `scripts/check-i18n.mjs` 强制校验；动态键（`STATUS_HINTS` / `ERROR_STATUS` / `CODE_TEXT`）不要另写死名单
- 轮询节流：设置页只在可见时轮询；顶部图标 30s 一次、`visibilitychange` 时暂停；不挂高频常驻定时器
- 状态语言一套：`正常 / 未安装 / 未运行 / 未登录 / HTTPS 未启用 / 路由冲突 / 信任未生效`；每个状态只给一个主动作 + 一条可复制命令
- 改 `lib/client.js` 后刷新页面验证（HMR 通常免刷新），控制台必须 0 错误

## 7. 版本与发布

- 语义化版本：`patch` 修 bug / `minor` 新功能 / `major` 破坏性变更（`engines.dsh` 变化视为 major）
- **发布只由 tag 触发**（`v*`），禁止手动 `npm publish`；tag 必须与 `package.json` 版本一致
- 流程见 [`RELEASE.md`](RELEASE.md)
- **每个版本必须更新 `CHANGELOG.md`**，条目格式 `## <semver> — <YYYY-MM-DD>`；Release workflow 用 `scripts/release-notes.mjs` 抽取当前版本条目作为 GitHub Release 正文，缺失或为空 → 发布失败
- 发布使用 **npm Trusted Publishing（OIDC）**，不增加 `NPM_TOKEN`；npm 包设置里填 `PonyDevAI` / `dsh-tailscale` / `release.yml`

## 8. 提交规范

- Conventional Commits：`feat:` / `fix:` / `docs:` / `ci:` / `chore:` / `refactor:` / `test:`
- 一个提交只做一件事；提交信息中文或英文均可，但需说明"为什么"
- 不要提交：`node_modules/`、`*.tgz`、`*.log`、临时脚本、密钥、截图调试残留
- 作者身份使用全局 git config（`Pony <205503242+jmaubay7@users.noreply.github.com>`），不要用 `-c user.email=` 覆盖，不要写 AI 署名

## 9. 不要做的事

- 不要引入构建工具/打包器（手写 ModuleLoader bundle 是刻意设计）
- 不要改 `lib/client.js` 的 bundle 壳（`window.__ModuleLoader__.load`）结构
- 不要用 `ctx.connection.rpc.handle()`（web composition 下会失败，必须用 `webServer.register` + `connection.admit`）
- 不要在 `inject` 里放可选服务；`ctx.tailscale` 的消费方用 `ctx.get('tailscale')` 惰性读取
- 不要注册第二个 `tailscale` 服务（服务名全局唯一，重复 `ctx.provide` 会 throw）
- 不要删除/改写历史 tag；不要手工编辑历史 GitHub Release
- 不要为了让某个消费方好写就扩大 `probe()` 的探测范围，或把 adb/hdc 协议塞进本插件
