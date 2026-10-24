# dsh-tailscale · 设计草案 v1

> 给 DeepSeek Harness 加一个 Tailscale 能力层：**入站**把本机 DSH Web 发布到 tailnet，**出站**把 tailnet 的设备与可达性变成 DSH 内部服务，供其他插件消费（第一个消费者是 dsh-phone）。
> 本文是架构与分阶段规划，**尚未开始写代码**。

相关：`docs/phone-plugin/DESIGN.md`（dsh-phone）、`docs/dsh-model-usage-plugin.md`（插件模板与 DSH 机制盘点）、`~/.dsh/profiles/web/cordis.patch.yml`（当前 profile）。

---

## 1. 结论先说

| 问题 | 结论 |
|---|---|
| 插件名 | 包名 `@ponydev/dsh-tailscale`（npm scoped，与 `@ponydev/dsh-model-usage` 一致；裸名 `dsh-tailscale` 目前也未被占用，见 §14） |
| 仓库 | `PonyDevAI/dsh-tailscale`（GitHub 同名仓库 `hoiwanchang/dsh-tailscale` 是别人的另一个东西，不冲突） |
| 形态 | 单包双半区：Host（`lib/index.js` + `lib/*.js`）+ Client（`lib/client.js` 手写 ModuleLoader bundle），零运行时依赖、无构建步骤，照 dsh-model-usage / dsh-phone 模板 |
| 核心抽象 | Host 侧提供 **`ctx.tailscale` 服务**；手机/终端/别的插件用 `ctx.get('tailscale')` 可选消费，**不写进 `inject`** |
| 入站实现 | `tailscale serve --bg --https=<port> <path> http://127.0.0.1:<webPort>` + 运行期把 `<node>.<tailnet>.ts.net` 推进 `connection.trustedHosts` + `connection.authenticatedUrl()` 生成手机登录链接 |
| 出站实现 | `tailscale status --json` 归一化成设备清单；服务提供 `devices()` / `device()` / `probe(host, port)`；协议（adb/hdc/ssh）由消费方负责 |
| 与 dsh-phone 的关系 | 依赖方向单向：dsh-phone 可选消费 `ctx.tailscale`；dsh-tailscale 不认识手机。缺任一插件都能独立工作 |
| 安全红线 | 绝不启用 Funnel；不打印/不落盘 token 或 cookie；`/tailscale/*` 全部过 `connection.admit()`；不发任意 shell |
| 能否替代现有手工配置 | 能。P1 验收后下线 `local.dsh-tailnet-serve` launchd 任务与 `--trusted-host` 手工参数 |

---

## 2. 需求

### R1 入站：远程入口

- tailnet 内任意设备（手机/平板/别的电脑）通过 `https://<node>.<tailnet>.ts.net/` 打开本机 DSH Web。
- 首次打开需要登录；之后**跨 DSH 重启**仍然可用（不必每次回电脑抄新链接）。
- DSH 重启/崩溃恢复后，入口自动恢复；正常退出时可选撤回（默认撤回）。
- 入口状态、健康检查、登录链接在设置页可见、可复制、可开关。

### R2 出站：tailnet 感知

- DSH 内部能回答：当前 tailnet 有哪些节点、谁在线、各自的域名/IP/OS/tags、哪些端口可达。
- 通过 **`ctx.tailscale` 服务**把这些能力暴露给其他 DSH 插件（不只手机）。
- dsh-phone 能自动发现 tailnet 上的 adb/hdc 手机并一键连接；没有任何 tailscale 插件时 dsh-phone 行为不变。

### 明确不做（边界）

| 不做 | 原因 |
|---|---|
| `tailscale up` / 登录 / 改 ACL / 开关 exit node | 会改变用户网络状态；插件只读 + 只做 serve 路由 |
| Tailscale Funnel（公网暴露） | 与"私网使用"的既定原则冲突 |
| adb/hdc 协议实现、设备控制 | 属于 dsh-phone 的 transport 层；本插件只提供"网络可达性" |
| 通用代理/VPN 转发 | 不做第二套网络栈，只用 Tailscale 自己的能力 |
| 修改 DSH 核心或 profile 启动参数 | 用运行期能力（`connection.trustedHosts` 数组）完成，避免要求用户改启动命令 |

---

## 3. DSH 机制盘点（本方案依赖的能力）

### 3.1 插件包形态

与 dsh-model-usage / dsh-phone 同构：

```
package.json          # dsh.bundle.patch + dsh.client
cordis.patch.yml      # insert 一个 Host 行
lib/index.js          # Host：Cordis apply / 服务 / 路由
lib/client.js         # 浏览器：window.__ModuleLoader__.load({ id, factory })
```

- Host 行通过 `cordis.patch.yml` 的 `insert` 进入 loader；profile 的 `dsh.profile.bundles` 登记包名。
- Client 半区由 `dsh.client`（`platform: 'web'`、`immediately`、`inject`、`external`）声明，`exports["./client"]` 指向 bundle；`dsh-client-modules` 负责组装 `window.__DSH_BOOT__`。
- 本地开发：`dsh plugin --profile web add link:<abs path>`（profile 里装成符号链接，改文件立即影响已装插件）。**HMR 默认启用**：改 `lib/client.js` 保存后浏览器通常免刷新换插件（状态会丢）；改 Host 侧文件后，touch 一下 profile 的 `cordis.patch.yml` 即可触发重组合替换已链接包，**不必重启 `dsh web`**（时序依赖文件事件，未 100% 实测）。`pnpm run dev:web` 是 DSH 仓库自己的构建 watcher，对手写无构建插件不是必需。

### 3.2 服务：提供与消费

- **提供**：普通插件在 `apply(ctx)` 里 `ctx.provide('tailscale', api)` 即可注册进 Cordis 容器（返回 disposer，作用域=当前 fiber）。先例：`@deepseek-ai/dsh-web-app` 的 `ctx.provide("webApp", { getAdvertisedUrl })`。
- **消费**：`ctx.get('tailscale')` 拿可选服务；**不要写进 `inject: ['tailscale']`**——服务不存在时整个插件不会启动（dsh-model-usage 对 `ctx.deepseekAccount` 已踩过这个坑）。消费方应在**请求处理时惰性取**，因为插件加载顺序不保证。
- 也可以用 `class X extends Service` 注册（先例 `ctx.jobs`、`ctx.settings`），但本插件只需要一个普通对象 API，`ctx.provide` 更轻。
- 服务名全局唯一：第二个插件再 `ctx.provide('tailscale')` 会直接 throw（不在同一 fiber 时无仲裁）。

### 3.3 Web 与认证围栏

| API | 用途 | 证据 |
|---|---|---|
| `ctx.webServer.register({ kind: 'prefix', path, handler })` | 挂 `/tailscale/*` 路由；返回 disposer | `@deepseek-ai/dsh-host-webserver` |
| `ctx.webServer.port` / `.protocol` / `.getOrigin()` | serve 的目标端口；本机 origin | 同上 |
| `ctx.connection.admit(req)` | Host/Origin 围栏 + Cookie 认证；`{ rejection: 401\|403 }` | `@deepseek-ai/dsh-client-connection` |
| `ctx.connection.authenticatedUrl(baseUrl)` | 给 URL 加本次进程的 launch token | 同上；`dsh-web-app` 打印启动链接就用它 |
| `ctx.connection.trustedHosts` | 非 loopback authority 白名单。**运行期 push 会生效**（`isTrustedApiRequest` 每次请求都读这个数组，且与 config 是同一引用），但类型是 `private readonly`、无 setter，且 `allowsRemoteAuthorities` 在构造时算一次、事后 push 不更新（只影响目录选择器等少数逻辑，不影响 `/api` 围栏）。官方推荐做法是在 profile patch 里写 `trustedHosts: !!js [...ctx.webStartup.trustedHosts, '<host>']`——但那要用户改配置，本插件默认走运行期 push，patch 写法作为文档里的可选加固 | `@deepseek-ai/dsh-client-connection`（`rpc-host.d.ts:22`、`lib/index.js:721/779`）；`@deepseek-ai/dsh-web-app/cordis.patch.yml:234-241` 官方注释 |
| `ctx.webApp.getAdvertisedUrl()` | 广告 URL（无则用 `webServer.getOrigin()`） | `@deepseek-ai/dsh-web-app` |

认证链路：启动 token 换 cookie；cookie 的签名密钥持久化在本 Harness home 的 credentials（`client-connection/browser-session`），默认有效期 30 天。**这是"手机登录一次跨重启可用"的基础**。token 每次启动都会换，cookie 不会。

`tailscale serve` **保留客户端 Host 头**，所以 ts.net 请求到 DSH 后 Host/Origin 都是 ts.net，必须进 `trustedHosts`，否则表现为「手机页面能打开、一发消息 403」。

### 3.4 UI 扩展点

| Slot / 服务 | 用途 |
|---|---|
| `settings.section` | 设置页新增「远程访问」整节（dsh-model-usage 同款；owner props 只有 `{ close() }`，`id/order/label` 走注册选项） |
| `settings.general.item` | 可选：在「设置 → 通用」插一行摘要（list 槽，owner props 为空；比整页轻） |
| `ctx.locale.register(NS, { zh, en })` | 中英文案 |
| 主题 token `--dsw-alias-*` / `--dsw-radius-*` | 不 import primitives，避免绑死组件库版本 |

两个槽都必须用 `ctx.slots.inject(key, () => ctx.slots.register(...))` 包住——槽由其他插件运行时声明，inject 保证「已声明则同步跑，否则等声明提交后再跑」。

### 3.5 客户端插件图（P4 可选）

`ctx.clientModules` 组装浏览器插件表；dsh-tailscale-remote 用它在手机页面裁掉用不上的插件（约 5.3 MB → 1.1 MB gzip）。本插件 v1 不做，留作 P4 可选优化。

### 3.6 本机实测事实（2026-10-24，Tailscale 1.104.2）

已在本机（Mac Studio）只读验证，作为契约依据：

- **CLI**：`/Applications/Tailscale.app/Contents/MacOS/Tailscale`，`version` = `1.104.2-tc343f0d2`（standalone GUI 版，CLI 不在 PATH）。
- **`status --json`** 顶层键：`Version / BackendState / TUN / HaveNodeKey / AuthURL / TailscaleIPs / Self / Peer / User / Health / CertDomains / MagicDNSSuffix / CurrentTailnet / ExitNodeStatus / ExtraRecords`。
  - `Self`：`ID / NodeID / HostName / DNSName（带尾点）/ OS / Online / TailscaleIPs / Tags / CurAddr / Relay / LastSeen / PeerRelay / Capabilities / PeerAPIURL / Created…`。
  - `Peer`：**map**，key 是节点稳定 ID；每项含 `HostName / DNSName / OS / Online / TailscaleIPs / Tags / CurAddr / Relay / LastSeen / Expired / KeyExpiry / ExitNode / PeerRelay …`。本机当前 29 个 peer、16 个在线，含 Android（Pixel 7a、unicom-sfa-pony）与 iOS 节点 —— 正好是 dsh-phone 发现功能的真实验证集。
  - `Health: []` 为空表示 tailscaled 自检正常；`CertDomains` 里有 `<self>.<tailnet>.ts.net` 说明 HTTPS 证书可用；`MagicDNSEnabled: true`。
- **`serve status --json`**：`{ "TCP": { "443": { "HTTPS": true } }, "Web": { "macstudio.tail8fbb79.ts.net:443": { "Handlers": { "/": { "Proxy": "http://127.0.0.1:3080" } } } } }` —— 没有 `AllowFunnel` 键就表示未开 Funnel（本机当前就是私网 Serve）。
- **`funnel status --json`** 在未开 Funnel 时输出与 serve 相同的配置块，因此**不能用它判断 Funnel**；要看 `serve status --json` 里目标 authority 的 `AllowFunnel` 字段是否存在/为真。
- **`serve get-config --all`** 在本机返回 `{ "version": "0.0.1" }`（没有把现有 handler 列出来），说明这条路由是旧式 CLI 写入的；**不要**用 get/set-config 做 v1 的增删基础，P0 再确认兼容写法。
- **`serve --help`**（1.104）确认支持：`--bg`、`--https <port>`、`--http`、`--set-path <path>`、`--tcp`、`serve status/reset/drain/clear/...`。
- **撤单条路由 = 末位 `off`**：`tailscale serve --https=<port> [--set-path=<path>] off`（源码 `cmd/tailscale/cli/serve_v2.go`）。**`serve reset` 会清空全部 serve 配置，禁止使用**。
- **serve v2**：1.104 起 `serve status --json` 输出被标记为 legacy raw 格式（`get-config`/`set-config` 迁移中），因此解析要防御式（字段缺失 = 未知，不报错），不要写死某版本的键。
- **ServeConfig 结构**（`ipn/serve.go`）：`{ TCP, Web: { "host:port": { Handlers: { "/path": { Proxy } } } }, Services, AllowFunnel, Foreground }`。判断"路由是否存在"要：① `Web[<dnsName>:<port>].Handlers[<path>].Proxy` 归一化（**去尾斜杠**）后与目标比较；② 端口占用看 `TCP["443"].HTTPS`；③ Funnel 看 `AllowFunnel`。
- **沙箱注意**（实测）：App Store 版 Tailscale 是 app-sandbox 应用，在 DSH agent 工具的 seatbelt 沙箱里执行它的 CLI 会 **SIGTRAP / 退出码 133**（`_libsecinit_appsandbox`），不是"未运行"。插件在 **dsh host 进程**里 `execFile` 不受此限（launchd 脚本就是这么跑的）；将来若给 agent 加 tailscale 工具，必须在非沙箱路径执行。
- **App Store 版 CLI 需要 `TERM`**（P1 现网踩坑）：host 进程（launchd 启动的 `dsh web`）环境里没有 `TERM` 时，`tailscale version` / `status --json` 会往 **stdout** 打印 `The Tailscale GUI failed to start ... (Tailscale.CLIError error 3.)` 并以 exit 0 退出——不是报错，是"假成功"。修复：插件 `execFile` 时给子进程补 `TERM=xterm-256color`（实验证明 `TERM=dumb` 也行）；`version()` 同时校验首行必须是版本号，避免把这种输出当健康。
- **tailnet 上的 adb 已经跑通**（本机只读实测）：`adb devices -l` 里已有 `100.107.25.26:5555`（Pixel 7a）、`100.90.248.53:5555`、`unicom-openclaw-pony:5555`、`unicom-openclaw-test:5555`；`nc -z` 100.x:5555 可通。⇒ dsh-phone 的"发现 + 一键连接"不是纸面方案，现成链路可直接联调。
- **hdc 3.2.0f** 可用：`hdc tconn <ip>:<port>` 建 TCP target、`tconn <key> -remove` 断开、`tmode port <port>` 对应 adb tcpip、`-t <connectkey>` 选设备；`hdc list targets` 当前只有 `127.0.0.1:5555`。
- 本机现有路由 `https://macstudio.tail8fbb79.ts.net/ → http://127.0.0.1:3080` 正是插件上线后要**认领**的对象（target 精确匹配即视为上次自己留下的）。

---

## 4. 总体架构

```
        ┌───────────── 手机 / 平板 / 别的电脑（tailnet 内）──────────────┐
        │  浏览器：DSH Web（index + /api + /tailscale/*），HTTPS :443      │
        └───────────────▲───────────────────────────────────────────────┘
                        │  TLS 由 tailscaled 终止，回源明文到 127.0.0.1
                 ┌──────┴───────────────┐
                 │  tailscale serve     │  https://macstudio.tail8fbb79.ts.net
                 │  (tailscaled 管理)    │      → http://127.0.0.1:3080
                 └──────┬───────────────┘
                        │  Host 头原样保留 → 需要 trustedHosts
   DSH Host 进程  ┌─────┴────────────────────────────────────────────────────┐
                  │ dsh-tailscale (Host 半区)                                 │
                  │  ├ TailscaleCli    execFile + JSON + 超时 + TTL 缓存       │
                  │  ├ ServeManager    ensure / adopt / remove + 归属状态文件  │
                  │  ├ TrustBridge     运行期维护 connection.trustedHosts      │
                  │  ├ ctx.tailscale   ← 给其他插件的服务                      │
                  │  └ /tailscale/*    admit 围栏后的 RPC，给浏览器 UI         │
                  └─────┬─────────────────────────────────────────────────────┘
                        │  ctx.get('tailscale')（可选依赖）
          ┌─────────────▼──────────────┐      ┌───────────────────────────┐
          │ dsh-phone                  │      │ 未来的 dsh-terminal /      │
          │  devices() + probe() → adb │      │ dsh-ios / dsh-file-sync…   │
          └────────────────────────────┘      └───────────────────────────┘
```

分层原则：

1. **能力层（本插件）** 只认 Tailscale：节点、路由、可达性。不认 adb/hdc/ssh。
2. **消费层（dsh-phone 等）** 只认 `ctx.tailscale` 的契约，可缺席降级。
3. **浏览器层** 通过 `/tailscale/*` 拿数据，不直连 tailscaled。

---

## 5. `ctx.tailscale` 服务契约（v1）

```ts
type TailnetDevice = {
  id: string            // Tailscale 节点 ID（status --json 的 Peer key 或 Self.ID）
  hostName: string      // macstudio
  dnsName: string       // macstudio.tail8fbb79.ts.net（去掉末尾点）
  ips: string[]         // 100.x.x.x / fd7a:...
  os: string            // macOS / linux / android / iOS
  online: boolean
  tags?: string[]       // tag:server 等
  lastSeen?: string     // 离线节点的最后在线时间
  direct: boolean       // 有直连路径（CurAddr 非空）而非只走 DERP
  relay?: string        // DERP 区域（可空）
  isSelf: boolean
}

type Publication = {
  enabled: boolean
  url?: string          // https://<dnsName>[/path]
  path?: string         // '/' 或 '/dsh2'
  target?: string       // http://127.0.0.1:3080
  owned: boolean        // 是否本进程/本插件创建（决定退出是否撤回）
  adopted: boolean      // 启动时认领了上次崩溃残留的路由
  createdAt?: number
}

type Check = { id: string; ok: boolean; level: 'ok'|'warn'|'error'; message: string; hint?: string }
type HealthReport = { ok: boolean; checks: Check[]; url?: string; dnsName?: string }

interface TailscaleService {
  // —— 只读（默认 TTL 缓存 10s，fresh 跳过）——
  status(opts?: { fresh?: boolean }): Promise<{ backend: string; version?: string; cliPath: string; self: TailnetDevice }>
  devices(opts?: { fresh?: boolean; online?: boolean; allow?: RegExp[] }): Promise<TailnetDevice[]>
  device(ref: string): Promise<TailnetDevice | null>   // 支持 hostName / dnsName / IP 前缀
  publication(opts?: { fresh?: boolean }): Promise<Publication>
  health(opts?: { deep?: boolean }): Promise<HealthReport>

  // —— 动作（失败抛带 code 的错误）——
  publish(opts?: { path?: string }): Promise<Publication>
  unpublish(): Promise<void>
  probe(host: string, port: number, opts?: { timeoutMs?: number }): Promise<{ ok: boolean; ms: number; error?: string }>
  loginUrl(): Promise<string>        // 仅在本进程有 connection 时可用，含 launch token（secret）

  // —— 订阅（供服务端消费方，浏览器侧走轮询）——
  subscribe(listener: (event: { at: number; reason: 'publish'|'unpublish'|'change'; publication: Publication }) => void): () => void
  // 需要设备快照时自行调用 devices()；回调里不做重活

  readonly config: Readonly<TailscaleConfig>
}
```

错误码（`error.code`）：`tailscale/not-installed`、`/not-running`、`/not-logged-in`、`/https-disabled`、`/serve-failed`（创建/撤除路由动作失败）、`/route-conflict`、`/trust-unavailable`、`/permission`、`/timeout`、`/no-connection`、`/no-publication`、`/bad-target`、`/bad-output`、`/cli-failed`、`/not-found`。

约定：

- **"可预期的不可用"不抛异常**：`status()` 返回 `backend: 'Stopped'` 等，`health()` 出 `warn/error`；只有 `publish()` 这类动作才抛。
- 所有 CLI 调用 `execFile` + 参数数组 + 超时（status 5s、serve 8s），**不拼 shell**。
- 服务不做定时轮询（避免后台常驻定时器）；UI 或消费方按需 `fresh: true`，必要时自己缓存。

---

## 6. 入站：远程入口设计

### 6.1 启动流程（publish）

1. 等待 `webServer.port` 就绪（插件用 `ctx.inject(['webServer','connection'], scope => scope.effect(...))`）。
2. 解析 CLI 路径：config > PATH 里的 `tailscale` > macOS `/Applications/Tailscale.app/Contents/MacOS/Tailscale` > 平台默认。
3. `tailscale status --json` 读 `BackendState`：不是 `Running` → 记 health，不动作（**绝不自动 `tailscale up`**）。
4. 读 `Self.DNSName`（去尾点）作为 authority；缺失则报 `https-disabled`/MagicDNS 未开。
5. 解析 `serve status --json` 的 `ServeConfig`，按 **classifyServe** 四态判断（参考 dsh-tailscale-remote 的成熟做法）：
   - `absent`：`Web[<dnsName>:<httpsPort>].Handlers[<publishPath>]` 不存在 → 创建。
   - `exact`：Proxy 归一化（去尾斜杠）+ 端口 = 本实例 → 认领（`adopted: true`），不重建。
   - `stale`：本实例上次留下的路由但目标端口已变（少见）→ 记录并重建（先撤旧再建新）。
   - `conflict`：该 authority/path 指向别的服务（别的 dsh 实例、用户自己的反代）→ 报 `route-conflict`，**绝不覆盖**。
   - 创建命令：`serve --bg --https=<httpsPort> [--set-path=<publishPath>] http://127.0.0.1:<webPort>`；`absent`/`stale` 才创建，`exact` 只认领。
6. 把 `<dnsName>`（端口缺省，匹配任意端口）推进 `connection.trustedHosts`；先做 bare authority 校验、去重。**注意这是半公开 API**：类型上 `private readonly`，运行期 push 生效（数组是同一引用、围栏每请求读），但升级后若行为变化就走降级路径（health 提示用户在 patch 里写 `trustedHosts: !!js [...ctx.webStartup.trustedHosts, '<dnsName>']`）。
   - 另一个官方口径的坑：**非 insert 的 patch 是整键替换，config 不深合并**——用户若按文档改 `connection` 的 config，必须把原字段（`cookieMaxAgeDays`、`maxRequestBodyBytes` 等）一起写回。
7. 写状态文件 `$DSH_HOME/tailscale.json`（`0600`）：`{ url, path, target, owned, host, createdAt, dshPid }`。**不写 token**。
8. `publication()` 返回 `url`；`loginUrl()` 调 `connection.authenticatedUrl(url)` 现取现给。

### 6.2 退出与崩溃

- **正常 dispose**：`owned === true`（含认领上次残留）→ 执行 `tailscale serve --https=<httpsPort> [--set-path=<publishPath>] off`（**末位 `off` 撤单条**）；`adopted && !owned` 时不撤；`unpublishOnExit: false` 时保留（调试用）。
- **绝不 `serve reset`**（会清空用户所有 serve 配置）、**绝不 `tailscale down`**（会切断本机全部 tailnet 流量，包括 adb/ssh）。
- **崩溃/强杀**：serve 路由会留在 tailscaled 里。下次启动按 §6.1 第 5 步认领：`exact` → 视为上次自己留下的，继续 owned，退出时一并撤。这条和 dsh-tailscale-remote 的处理一致。
- **P0 实测（2026-10-24，Tailscale 1.104.2）**：`serve --bg --https=443 --set-path=/dsh-probe http://127.0.0.1:3080` → exit 0；`serve --https=443 --set-path=/dsh-probe off` → exit 0，只撤该 path，根路由保持 401、探针 path 变 404。⇒「建单条 / 撤单条 / 不碰根路由」已在现网验证。
- **多实例**（同机第二个 dsh，如 3080 + 3081）：用 `--set-path=/dsh2` 共享同一个 443；v1 先做单实例，path 支持放 P4。
- **HMR 重载竞态（v0.1.1 修复）**：热重载时新旧插件实例短暂并存，旧实例的异步 dispose 可能在新实例发布之后才执行 `serve off`，把新入口撤掉。修复：状态文件写 `instanceId`，`unpublish` 只在归属仍是自己时才撤路由/摘 trustedHosts；自动发布后再延迟 1.2s 校验一次，非 exact 就重建（只重试一次）。
- **低频自愈（v0.1.1）**：autoPublish 开启时每 60s 校验一次入口（只读状态文件 + serve status），非 `exact` 就重建。覆盖 HMR 竞态、外部 `serve reset`、Tailscale 重启、CLI 瞬时失败等漂移；关闭 autoPublish 时自愈不运行。
- **P0/P1 现网验证（2026-10-24，真实 tailscaled 1.104.2 + 真实 dsh web 进程）**：插件装进 web profile 后自动发布成功 —— `publication` = `enabled/routeState:'exact'/owned/adopted`；`POST /tailscale/snapshot` 经 `https://macstudio.tail8fbb79.ts.net` 返回 200（30 台设备 / 17 在线）；无 cookie 401、伪造 Origin 403；`https://…/?token=…` 返回 303 + `dsh-auth-…` cookie（手机登录流程成立）；RPC `unpublish` 后 `tailscale serve status` = "No serve config"、状态文件删除、ts.net 不可达；`publish` 后路由恢复、根路径回到 401。**尚未验证的是"重启 dsh 后自动恢复"与"SIGTERM dispose 后路由消失"**（会打断当前会话，留给你手动重启验证）。


### 6.3 登录链接与"登录一次就够"

- `loginUrl = connection.authenticatedUrl('https://<dnsName>/')` → 形如 `https://…/?token=<launchToken>`；手机打开 → 换 cookie → 重定向到干净 URL。
- cookie 签名密钥持久化，默认 30 天有效；**跨 DSH 重启不需要重发链接**（token 变了，cookie 没变）。
- 对比：dsh-tailscale-remote 额外做了 `/remote/<base64url(secret)>` 持久登录入口 —— 它自己写 credentials 的会话签名密钥、自铸 cookie、并支持"换密钥 + 吊销全部会话"，代价是要碰 `browserAuth`/credentials 内部并回读校验。**v1 不抄这条**：用公开的 `authenticatedUrl` + DSH 自带 cookie 持久化就够了，少碰一处私有 API。P4 若确需"永久书签 + 一键吊销"，再单独设计并标注风险。
- 想更久：在 profile 的 `client-connection` 配置里 `cookieMaxAgeDays: 3650`（文档给示例，插件不自动改 profile）。cookie 一旦过期/被清，回设置页点"重新生成登录链接"。
- token 是 secret：`/tailscale/*` 只对已认证请求返回；不写日志、不写状态文件、不进 README 示例。

### 6.4 健康检查（`health({deep})`）

| check | 判定 | 深检 |
|---|---|---|
| `cli` | CLI 可执行、拿到 version | — |
| `backend` | `BackendState === 'Running'` | — |
| `dnsName` | `Self.DNSName` 存在且非空（去尾点） | — |
| `https` | tailnet 已启用 HTTPS（serve 成功即证明） | `HEAD https://<dnsName>/` **期望 401**（路由通 + 认证围栏在） |
| `route` | serve 路由 `exact` 且 target 是本端口 | — |
| `trust` | 本机带 `Host: <dnsName>` 请求 `http://127.0.0.1:<port>/api/...`，**403 = 信任未生效**，401 = 正常 | 本地发请求，不用走公网 |
| `funnel` | `AllowFunnel` 里没有本节点/本端口 | — |

判读约定（与 dsh-tailscale-console 一致）：远程 URL 返回 **401 是健康**（说明入口到了认证层），**403 才是故障**（trustedHosts 没生效），200 说明已有登录 cookie。

`health` 的每一项都带 `hint`（下一步该干什么）和可选 `command`，直接给用户可复制的命令。

### 6.5 平台差异

| 平台 | CLI 路径 | 注意 |
|---|---|---|
| macOS（本机） | `/Applications/Tailscale.app/Contents/MacOS/Tailscale` | ✅ 已实测可用（1.104.2）；GUI 版 CLI 不在 PATH；Mac App Store 版没有 CLI，health 明确提示换 standalone 版 |
| Linux | `tailscale` | 需要 root/`operator` 才能改 serve；health 提示 `tailscale set --operator=$USER` |
| Windows | `tailscale.exe` | 路径探测 + 命令差异，P2 再补 |

---

## 7. 出站：tailnet 感知与消费方集成

### 7.1 设备清单

- `status --json` 的 `Self` + `Peer` 归一化成 `TailnetDevice[]`，在线优先、按 hostName 排序。
- 只读字段（绝不暴露节点公钥以外的密钥类内容；公钥也不给 UI）。
- 过滤：`allow` 正则（按 hostName/dnsName/tags）、`online`。
- TTL 缓存 10s；`fresh: true` 强制刷新。

### 7.2 可达性探测

`probe(host, port)` = 单次 TCP connect（node `net`），默认 800ms 超时，不握手、不发任何协议数据；结果带耗时。

- 只对 tailnet 内的地址/域名探测（host 必须解析到 `100.64.0.0/10` 或 `fd7a:115c:a1e0::/48`，或匹配已知 peer），避免变成任意端口扫描器。
- 消费方决定探哪些端口；本插件不认识 5555/8710。

### 7.3 dsh-phone 集成（P3）

依赖方向：dsh-phone → dsh-tailscale（可选）。**本机已验证 tailnet adb 链路存在**（`100.107.25.26:5555`、`unicom-openclaw-pony:5555` 等），所以 P3 是"接数据源 + 加 UI"，不是"验证可行性"。

Host 侧（dsh-phone）：

```js
const tailscale = ctx.get('tailscale')   // 每次请求时取，别进 inject
const peers = tailscale ? await tailscale.devices({ online: true }) : []
// 对 allow 名单里的 peer 探 5555(adb) / 8710(hdc)，带 TTL
```

新增一个端点 `POST /phone/tailnet`，返回候选：

```json
{ "ok": true, "value": { "available": true, "candidates": [
  { "dnsName": "unicom-openclaw-pony.tail8fbb79.ts.net", "hostName": "unicom-openclaw-pony",
    "online": true, "protocols": [{ "id": "adb", "port": 5555, "reachable": true, "ms": 23 }] }
] } }
```

Client 侧：连接面板里加「Tailnet 设备」分组；点一下 → 复用现有 `POST /phone/connect`，地址 = `<dnsName>:5555`（adb serial 会变成 `xxx.ts.net:5555`，现有 `classifyDevice` 已把它归类为 `cloud`，UI 徽标已经是 Tailscale）。

注意（实测踩点）：

- 同一台手机现在会同时出现在 USB（`34201JEHN07681`）、tailnet IP（`100.107.25.26:5555`）、MagicDNS 名（`unicom-openclaw-pony:5555`）三种 serial 下 —— 展示层要按 **model + 设备标识** 归并，不能按 serial 字符串分组。
- `adb tcpip 5555` 后 adbd 监听 `[::]:5555`（所有接口），tailnet 只解决"连得到"，不解决"谁能连"；授权弹窗仍是唯一防线。文档要写明这是用户自己的设备/网络边界。
- hdc 用 `hdc tconn <ip>:<port>` 建 target、`tconn <key> -remove` 断开；多 target 时必须 `-t <connectkey>` 指定设备，选错是常见事故 —— 所以 hdc transport 放 P4，P3 只做 adb。

配置（dsh-phone，全部可选）：

```yaml
tailnet:
  enabled: true
  adbPort: 5555
  hdcPort: 8710
  allow: ["unicom-openclaw-*", "*.tail8fbb79.ts.net"]
  autoConnect: false        # 默认不自动连；开了也只连 allow 命中的
```

### 7.4 hdc / 未来协议

- dsh-phone 的 `PhoneTransport` 接口不变；`hdc` 只是再实现一个 transport（`hdc tconn <ip>:<port>`）。
- dsh-tailscale 侧只提供 `probe()` + `devices()`，加协议不需要动本插件。

---

## 8. UI 设计（Client 半区）

设置 → 通用下方新增一节「远程访问」（`settings.section`，id `remote-access`）：

```
远程访问 · Tailscale
┌───────────────────────────────────────────────────────────────┐
│ ● Tailscale 运行中 · macstudio.tail8fbb79.ts.net              │
│   入口已开启（443 → 127.0.0.1:3080）              [关闭]       │
│                                                               │
│ 手机入口  https://macstudio.tail8fbb79.ts.net/   [复制]        │
│ 首次登录  [生成登录链接]（链接含本次启动令牌，只发给可信设备）   │
│                                                               │
│ 设备（5 在线 / 7 总计）                                        │
│   ● macstudio       100.100.x.x   macOS   本机                │
│   ● unicom-openclaw-pony  …      linux    adb:5555 ✓          │
│   ○ …                                                         │
│                                                               │
│ 诊断  [重新检查]                                               │
│   ✓ CLI   ✓ 网络   ✓ 路由   ✓ 信任   ✓ Funnel 未开启           │
└───────────────────────────────────────────────────────────────┘
```

### 8.1 会话头部图标（v0.1.1）

- 位置：`conversation.session.header.utilities`（会话头部右上角工具区，和手机图标同排，order 9）。
- 形态：Tailscale 六点图标 + 右下角状态点：**绿=Running**、**红=未运行/未登录**、**灰=未知/接口不可用**；tooltip 显示 `Tailscale · 在线 · <域名> · 入口已开启 · 17/30 设备在线`。
- 数据：新增轻量 RPC `POST /tailscale/status`（只读 cached status + 状态文件，不查 serve），客户端每 30s 轮询、页面隐藏时暂停、focus/visibilitychange 立即刷新；不挂高频定时器。
- 点击：打开 **设置 → 远程访问** 并定位到该分区。实现方式：先找已渲染的导航项直接点；否则派发 `settings.open` 的 web 快捷键（`primary+alt+Comma`）打开设置面板，再等导航项出现后点中——DSH 0.2.1 没有公开的 settings 导航服务，这是最稳的无侵入衔接；若未来失效，点击至少会打开设置页。
- i18n 与主题 token 同设置页；图标不写 console、不存状态。

状态语言（一套）：`正常 / 未安装 / 未运行 / 未登录 / HTTPS 未启用 / 路由冲突 / 信任未生效`。每种状态只给一个主动作 + 一条可复制命令。

交互原则：

- 轮询只在设置页可见时进行（打开时一次 + 手动刷新 + 窗口 focus 时一次），不挂常驻定时器。
- "登录链接"默认不渲染，点「生成」才请求 `/tailscale/login-url`，展示后 60s 自动隐藏；带"含令牌"提示。
- 开关（开启/关闭入口）调用 `/tailscale/publish|unpublish`，返回新状态；开关只影响本次运行，权限/默认值见 config（`autoPublish`）。
- 设备列表纯只读 + 复制域名；不提供"连接"按钮（那是 dsh-phone 的 UI）。

样式只用 `--dsw-alias-*` token；文案 zh/en 走 `ctx.locale`。

---

## 9. 包结构、配置与路由

### 9.1 目录

```
plugins/dsh-tailscale/
├── package.json
├── cordis.patch.yml
├── lib/
│   ├── index.js        Host 插件：apply / 生命周期 / 路由 / 服务装配
│   ├── cli.js          TailscaleCli：execFile、JSON、超时、错误归类、缓存
│   ├── serve.js        ServeManager：ensure/adopt/remove、状态文件、冲突判断
│   ├── trust.js        TrustBridge：trustedHosts 校验/推送/回滚
│   ├── devices.js      status JSON → TailnetDevice（纯函数，可单测）
│   ├── probe.js        TCP 可达性探测（纯 node:net）
│   ├── service.js      ctx.tailscale 实现（组合上面几层）
│   └── client.js       浏览器半区：设置页组件、i18n、轮询
├── scripts/
│   ├── fake-tailscale.mjs   假 CLI（canned status/serve JSON），冒烟与单测用
│   ├── smoke.mjs            冒烟：服务方法 + RPC 围栏 + 状态机
│   └── render-test.mjs      离线渲染测试（可选）
├── docs/                      本文 + 截图
├── README.md / CHANGELOG.md / LICENSE
└── .github/workflows/ci.yml (P4)
```

### 9.2 package.json 关键字段

```json
{
  "name": "@ponydev/dsh-tailscale",
  "version": "0.1.0",
  "type": "module",
  "engines": { "dsh": ">=0.2.0-rc.2 <0.3.0", "node": ">=22.5" },
  "exports": { ".": "./lib/index.js", "./client": "./lib/client.js" },
  "files": ["lib", "cordis.patch.yml", "README.md", "CHANGELOG.md", "LICENSE"],
  "dsh": {
    "manifestVersion": 1,
    "bundle": { "patch": "./cordis.patch.yml" },
    "client": {
      "platform": "web",
      "immediately": true,
      "inject": ["@deepseek-ai/dsh-client-ui-settings", "@deepseek-ai/dsh-client-locale"]
    }
  }
}
```

### 9.3 cordis.patch.yml

```yaml
- insert:
    - id: tailscale
      name: "@ponydev/dsh-tailscale"
      config:
        autoPublish: true
        httpsPort: 443
        publishPath: /
        unpublishOnExit: true
```

### 9.4 配置项（schemastery，Host 侧）

| key | 默认 | 说明 |
|---|---|---|
| `cliPath` | `'auto'` | `auto` 按 §6.5 顺序探测；也可显式给路径（Windows/非标准安装） |
| `autoPublish` | `true` | 启动时自动发布（本机语义：替代 launchd 脚本） |
| `httpsPort` | `443` | serve 的 HTTPS 端口 |
| `publishPath` | `'/'` | 单实例用 `/`；多实例 P4 用 `/dsh2` |
| `unpublishOnExit` | `true` | 正常退出时撤回自己建的路由 |
| `adoptExisting` | `true` | 启动时认领上次崩溃残留（target 精确匹配才认） |
| `trustHost` | `true` | 自动把 `<dnsName>` 推进 `connection.trustedHosts` |
| `deviceTtlMs` | `10000` | `status --json` 缓存 |
| `probeTimeoutMs` | `800` | `probe()` 默认超时 |
| `allow` | `[]` | 设备过滤正则（空 = 全部） |

### 9.5 `/tailscale/*` RPC（给浏览器）

统一 POST + JSON，`{ ok, value } | { ok: false, error: { code, message } }`，每个请求先 `connection.admit()`：

| 端点 | 作用 |
|---|---|
| `snapshot` | 状态 + 发布信息 + 设备列表 + health 一屏数据（设置页首屏一次拿全） |
| `health` | 深检（可带 `deep: true`） |
| `login-url` | 返回含 token 的登录链接（仅认证请求；不缓存） |
| `publish` / `unpublish` | 开关入口 |
| `devices` | 设备列表（供未来其他插件的浏览器侧复用） |

客户端调用约定：**必须用相对路径**（`fetch('tailscale/snapshot')`，不带前导 `/`），以兼容 `/dsh2/` 这类挂载前缀；model-usage / dsh-phone 都是这么写的。不要用 SSE/WS（v1 轮询足够，两个现成插件也全是轮询）。

---

## 10. 安全与隐私

| 面 | 措施 |
|---|---|
| 网络暴露 | 只用 `serve`（tailnet 内）；**永不 Funnel**；health 检测 Funnel 并告警 |
| 认证 | `/tailscale/*` 全部 `connection.admit()`；未认证 401、伪造 Origin 403 |
| Token / Cookie | `loginUrl` 只在认证请求中现取现给；不落盘、不日志、不进状态文件；UI 生成后自动隐藏 |
| 命令执行 | 一律 `execFile` + 参数数组；host/port/tag 全部白名单校验；不跑 `up/down/login/reset` |
| 状态文件 | `$DSH_HOME/tailscale.json`，`0600`，只有 URL/端口/归属，无凭据 |
| 探测 | `probe()` 只接受 tailnet 地址；单次 connect、短超时；不做端口扫描循环（由消费方限制） |
| 隐私 | 设备清单只在本机 Host 与已认证浏览器之间流转；不向任何第三方上报 |

---

## 11. 与现有手工配置的迁移（本机）

现状（2026-10-22 起）：

- `~/Library/LaunchAgents/local.dsh-tailnet-serve.plist` → `~/.local/bin/dsh-tailnet-serve.sh`，登录时补 `serve --bg --https=443 http://127.0.0.1:3080`。
- dsh 启动参数带 `--trusted-host macstudio.tail8fbb79.ts.net`。
- 实测 `https://macstudio.tail8fbb79.ts.net/` 返回 401（路由与认证层正常）。

迁移步骤：

1. `dsh plugin --profile web add link:/Users/pony/deepseek/plugins/dsh-tailscale`，重启 `dsh web`。
2. 设置页确认：入口已开启、诊断全绿、手机能打开。
3. `launchctl bootout gui/$(id -u)/local.dsh-tailnet-serve`，plist 改名备份（先不删）。
4. 观察一个重启周期：dsh 重启后入口自动恢复、退出后路由撤回。
5. 可选：从启动参数去掉 `--trusted-host`（插件运行期补；保留也无害，会去重）。
6. 回滚：重新 `bootstrap` plist + 卸载插件。

注意：`--trusted-host` 去掉之前，插件对 `trustedHosts` 的推送会与 CLI 配置去重；两处同时存在不冲突。

---

## 12. 分阶段计划

| 阶段 | 内容 | 验收标准 | 预估 |
|---|---|---|---|
| **P0 探针** | 写一个一次性 `spike.mjs`：真实跑 `status --json` / `serve status --json`，确认 serve 增删命令与 JSON 字段；在 dsh 里验证 `ctx.provide` + 另一插件 `ctx.get`、`trustedHosts.push` 后 ts.net 的 `/api` 不再 403；验证 `authenticatedUrl` 在手机上的完整登录 | 手机经 ts.net 能进 UI、能发一条消息；`serve` 路由可精确增删；记录 CLI 版本差异 | 0.5 天 |
| **P1 v0.1 入站 MVP** ✅ | Host：cli/serve/trust/service + `/tailscale/*` + 状态文件/认领；Client：设置页「远程访问」（状态/开关/入口/登录链接/诊断）；假 CLI 冒烟；装进 profile；迁掉 launchd | ✅ 2026-10-24 完成并现网验证（自动发布、ts.net 登录 303、围栏 401/403、RPC 撤回/重建）；剩余：重启恢复与 SIGTERM 撤回待手动验证；launchd 下线待重启验证后执行 | 1.5 天 |
| **P2 v0.2 设备感知** 🟡 | `devices()` / `device()` / `probe()` / `subscribe()`；设备列表 UI；health 深检；平台差异（Linux operator、Windows） | v0.1 已带 devices/snapshot/health/设备列表（现网 30 台/17 在线）；剩余：deep 健康检查 UI 接线、Linux/Windows 平台差异实测 | 0.5–1 天 |
| **P3 v0.3 手机联动** | dsh-phone 消费 `ctx.get('tailscale')`：`/phone/tailnet` + 连接面板「Tailnet 设备」分组 + 一键 connect + allow/autoConnect 配置 | 打开面板能看到云手机并点一下连上，画面/点按正常；卸载 dsh-tailscale 后 dsh-phone 行为完全不变 | 1–1.5 天 |
| **P4 v0.4 加固与发布** | 崩溃认领/多实例 path 的自动化测试、CI、README/CHANGELOG、npm 发布；可选：手机端精简 client 插件图、Windows 支持 | 冒烟+单测进 CI；发布 0.4.0；升级矩阵（0.2.1-rc.2 实测） | 1 天 |

建议先做 **P0 + P1**：P1 完成就能替代现有 launchd 手工件，价值立刻兑现；P2/P3 再把"感知 + 手机"接通。

---

## 13. 测试策略

| 层 | 做法 |
|---|---|
| 纯函数 | `devices.js` 用 canned `status --json` fixture（在线/离线/自节点/tags/无 DNSName）做单测 |
| CLI 层 | `scripts/fake-tailscale.mjs` 模拟 `status` / `serve status` / `serve` 增删，覆盖：未运行、HTTPS 未启用、路由冲突、超时、非 JSON 输出 |
| 服务层 | `smoke.mjs` 用假 CLI + 假 webServer/connection 断言：publish→状态文件→adopt→unpublish；`trustHost` 缺失时降级 |
| RPC | 未认证 401 / 非 POST 405 / 坏 JSON 400 / 正常快照字段完整 |
| 端到端（本机） | ts.net 首页 401 → token 登录 200 → `/api/sessions` 200 → 发一条消息；退出 dsh 后 `tailscale serve status` 无本路由；`kill -9` 后重启认领 |
| 隐私 | `/tailscale/*` 响应里 grep 不到 token；日志/状态文件 grep 不到 token；README 无真实 token |
| 回归 | 卸载/未安装 tailscale CLI 时插件不崩、UI 显示"未安装"；DSH 升级后跑一遍 P0 探针 |

---

## 14. 风险与待验证

| 风险 | 影响 | 缓解 |
|---|---|---|
| `connection.trustedHosts` 是 TS private / 非公开 API | DSH 升级后可能改名或变只读 | 运行期 `Array.isArray` 特性检测；失败 → health 明确提示改用 `--trusted-host`（附可复制命令）；engines 锁 `<0.3.0`；每次升级跑探针 |
| serve 配置格式随 CLI 版本漂移（1.104 已进 serve v2，`serve status --json` 被标 legacy） | 路由判断失效 → 误建/误撤 | 防御式解析（字段缺失=未知）；P0 记录 CLI 版本；判断"存在"用 `ServeConfig.Web[authority].Handlers[path].Proxy` 归一化比较；升级跑回归 |
| 误用 `serve reset` / `tailscale down` | 清空用户全部 serve 配置 / 切断本机全部 tailnet 流量（含 adb、ssh） | 代码里不出现这两个命令；只撤自己那条（末位 `off`）；只有自己 `up` 过才允许 `down`（本插件永不 `up`） |
| 与现有 launchd 脚本并存 | 两边都以为自己拥有路由；脚本用子串 grep 判"已存在"会误判 | 迁移顺序：先装插件验证 → 再 bootout 脚本；插件创建前先 classifyServe，`exact` 只认领 |
| 沙箱内执行 Tailscale CLI SIGTRAP(133) | 若将来加 agent 工具会假故障 | v1 只在 host 进程 `execFile`（不受工具沙箱影响）；未来加工具走非沙箱路径 |
| launchd host 进程无 `TERM`，App Store CLI 假成功（stdout 报 GUI 失败、exit 0） | 插件误判 CLI 可用、status 解析失败 | 子进程 env 补 `TERM`；version 首行校验；health 显示真实错误 |
| 同一手机多个 serial（USB / 100.x / MagicDNS 名） | 设备列表重复、点错设备 | 消费方（dsh-phone）按 model+设备标识归并；本插件只给 peer 级信息 |
| tailnet 未启用 HTTPS / MagicDNS | serve 起不来 | health 把 stderr 原文归类（`https-disabled`/`not-logged-in`），hint 指向 admin console 开关 |
| macOS App Store 版无 CLI | 功能不可用 | 探测失败明确提示换 standalone 版（不尝试安装） |
| 崩溃后路由残留/与他人冲突 | 入口重复或指向旧端口 | 状态文件 + classifyServe：`exact` 才认领，`conflict` 只报不覆盖 |
| cookie 30 天过期 | 手机突然进不去 | health 提示 + 设置页一键重发登录链接；文档给 `cookieMaxAgeDays` 调法 |
| 手机端首屏加载 5 MB+ 插件 | 弱网体验差 | P4 可选做精简 client 插件图（参考 dsh-tailscale-remote 的 lite 模式） |
| 同名/同类插件混淆 | 用户误装 | README 明确覆盖范围（入站+服务层），与 dsh-tailscale-remote（只入站）、dsh-tailscale-console（运维面板）、hoiwanchang/dsh-tailscale（绑 tailnet IP）划清界限 |
| 不可用状态下刷屏 | 日志噪音 | 所有预期不可用走 health/状态，不抛不打 error 日志；状态变化才打一条 |
| 设备探测被当成扫描器 | 安全质疑 | 只探 tailnet 地址、单次 connect、消费方自限；README 写明 |

待 P0 实测确认的清单（第 1、2 项已部分完成，见 §3.6）：

1. ~~`tailscale status --json` 字段名~~ ✅ 已验证（`BackendState`、`Self.DNSName`、`Peer.*.Online/OS/Tags/CurAddr/Relay/LastSeen`；离线节点会出现在 `Peer` 里）。剩余：`PeerRelay` / `Expired` 的语义在消费方要不要用。
2. ~~`serve status --json` 结构 / 撤单条语法~~ ✅ 已确认并在现网实测（`ServeConfig` 结构、`serve --https=<port> --set-path=<path> off` 撤单条、按 path 只撤自己、根路由不受影响、`reset` 清空、v2 迁移警告）。
3. ~~`connection.trustedHosts.push` 运行期是否生效~~ ✅ 已现网验证：push 后经 ts.net 的 `/tailscale/*` 与 `/api` 围栏通过（未带 cookie 401 / 伪造 Origin 403 / 带 cookie 200）。
4. ~~`authenticatedUrl()` 登录流程~~ ✅ 已验证到「303 + Set-Cookie」；「跨 DSH 重启 cookie 仍有效」由签名密钥持久化保证，待重启实测。
5. ~~`tailscale serve` 在 launchd 启动的 host 进程里是否可用~~ ✅ 可用（补 `TERM` 后）；注意 App Store CLI 的无 TERM 假成功坑。
6. ~~现有 Android peer 是否开了 adb tcpip~~ ✅ 已确认：`adb devices -l` 能看到 `100.107.25.26:5555` / `unicom-openclaw-pony:5555` 等 tailnet 通道。剩余：hdc 直连 tailnet 设备未验证。

---

## 15. 备选方案对比

| 方案 | 做法 | 优点 | 缺点 | 结论 |
|---|---|---|---|---|
| **A. serve + 运行期信任 + 服务层（推荐）** | 本文 | TLS 由 Tailscale 管理；不改 DSH 核心；能力可复用；与现有手工配置一致 | 依赖一个半公开字段；serve 语法随版本 | ✅ 采用 |
| B. 让 DSH 直接监听 tailnet IP | `dsh web --host 100.x` | 不需要 serve | 无 TLS → `crypto.randomUUID` 不可用，客户端 RPC 直接废；且暴露面变大 | ❌ |
| C. `--public-url` 方案 | 只用 CLI 广告 URL | 无 | 不改信任围栏，/api 仍 403；需要用户改启动参数 | ❌ 仅作降级提示 |
| D. SSH 隧道（现有 MacBook 方案） | `ssh -L 3080` | 不依赖 serve | 手机端不可用/体验差；需 SSH 凭据 | ❌ 保持为备用 |
| E. 直接用 `dsh-tailscale-remote` | 装现成插件 | 立刻有入站、四态认领、lite 模式 | 没有 `ctx.tailscale` 服务层，给不了 dsh-phone；持久登录入口依赖 `browserAuth`/credentials 内部；不可控 | ❌ 借经验，不依赖 |
| F. 用 tailscale funnel | 公网直出 | 无需 tailnet | 违背私网原则 | ❌ |

### 15.1 同类插件可借鉴 / 需避开（读源码结论）

**借鉴（dsh-tailscale-remote）**

- `classifyServe` 四态：`absent / exact / stale / conflict`；`exact` 视为上次崩溃残留并直接认领。
- 退出顺序：先摘 `connection.trustedHosts` 里自己那项，再 `serve --https=<port> off`；只有自己 `up` 过才 `down`（本插件永不 `up`，所以永不 `down`）。
- 状态文件（`~/.dsh/tailscale-remote.json` 同款思路）+ GUI 子进程 `detached` + `unref()`。
- 路由比较时把 DNSName 尾点、Proxy 尾斜杠归一化，否则误判 stale 会撤掉别人的路由。
- lite 模式（手机端按需裁剪 client 插件集）留作 P4。

**借鉴（dsh-tailscale-console）**

- 健康判读用 HTTP 码语义：200 正常 / 401 入口可达且围栏正常 / 403 trustedHosts 未生效。
- `status --json` 解析失败时降级解析 `tailscale status` 文本，避免 CLI 小版本变化直接白屏。
- 设备清单来自 `Self` + `Peer`（同本方案）。

**避开**

- console 的"关入口 = `serve reset`"：会清空用户全部 serve 配置，本插件只用末位 `off`。
- remote 的"自铸 cookie + 写 credentials 换密钥"：v1 不碰，用公开的 `authenticatedUrl` + DSH cookie 持久化。
- hoiwanchang/dsh-tailscale 的"把 web server 绑到 tailnet IP"：没有 TLS，客户端 RPC 依赖 `crypto.randomUUID` 会直接不可用。

---

## 16. 验收清单（P1 + P2）

- [ ] 设置 → 远程访问：状态、入口 URL、设备列表、诊断四项都能显示，无控制台错误。
- [ ] 手机首次用登录链接打开 → 登录成功；关掉再打开（不带 token）仍可用。
- [ ] DSH 重启后入口自动恢复，手机无需重新登录（cookie 未过期时）。
- [ ] `kill -9` 后重启：路由被认领，不重复创建，不误删。
- [ ] 正常退出（SIGTERM）：`tailscale serve status` 里本路由消失。
- [ ] 未安装/未运行/未登录 Tailscale：插件不崩，UI 显示对应状态与修复建议，日志无刷屏。
- [ ] `POST /tailscale/snapshot` 未认证 401、跨站 403；响应中无 token。
- [ ] `ctx.tailscale.devices()` 与 `tailscale status` 设备数/在线数一致（含离线节点）。
- [ ] 卸载 dsh-tailscale 后：dsh-phone、DSH 本身行为完全不变；无残留路由。
- [ ] 卸载 dsh-phone 后：dsh-tailscale 独立工作，不报错。

---

## 17. 待拍板

1. **默认行为**：`autoPublish` 默认 `true`（开机即暴露，替代 launchd）还是 `false`（手动开）？本机建议 `true`。
2. **UI 范围**：只做设置页（本文），还是再加左侧/右侧栏的「Tailnet 设备」常驻入口？建议先只做设置页。
3. **命名**：`@ponydev/dsh-tailscale`（推荐，和 model-usage 一致）还是裸名 `dsh-tailscale`？两者 npm 都可用。
4. **dsh-phone 改动范围**：P3 只做「发现 + 一键连接」，还是同时把 hdc transport 也做了？建议先只做 adb，hdc 看设备情况。
5. **旧手工件**：P1 验收后是否立即下线 launchd 脚本、并去掉 `--trusted-host`？建议下线脚本，参数先留着（无害）。

---

## 18. 统一系统 Tailscale：复用 + 安装/登录/配置向导（v0.2 规划）

> **2026-10-24 决策（替代原「独立节点」方案）**：只维护**本机这一套 Tailscale**。
> 默认复用；没装就由插件**自动安装并引导配置**；不创建 DSH 专属节点，不存在第二套 state/登录/hostname。
> 所有配置集中在同一个设置页，一套状态机。

### 18.1 状态机（设置页 / 顶部图标的唯一口径）

```
未安装 ──安装──▶ 已安装未运行/未登录 ──登录──▶ 运行中（未发布入口）──开启──▶ 已发布
   ▲                    │   ▲                                              │
   └────卸载检测─────────┘   └────────── 登录过期/退出登录 ◀────────────────┘
```

| 状态 | 判定 | 主操作 |
|---|---|---|
| 未安装 | 找不到 CLI/daemon（PATH、`/Applications/Tailscale.app`、brew 路径都无） | **一键安装**（见 18.2） |
| 已安装未运行 | `BackendState` ∈ Stopped/Starting/NoState | 启动 Tailscale（macOS `open -a Tailscale`） |
| 未登录 | `BackendState = NeedsLogin` 且 `AuthURL` 非空 | **扫码登录**（AuthURL 本地二维码）/ 浏览器打开 / auth key |
| 运行中 | `Running` | 开启入口（serve） |
| 已发布 | serve 路由 `exact` | 复制/二维码手机入口、关闭入口 |

### 18.2 自动安装（平台矩阵）

安装是**系统级操作**，插件不静默提权，只做"代跑 + 系统授权弹窗"：

| 平台 | 首选 | 回退 | 权限 |
|---|---|---|---|
| macOS（本机有 Homebrew） | `brew install --cask tailscale-app`（后台跑，输出进日志） | 下载官方 `.pkg` → `osascript … installer … with administrator privileges`（系统密码框，插件不接触密码） | 可能弹管理员授权 |
| macOS（无 Homebrew） | 官方 pkg + 系统授权弹窗 | 打开 <https://tailscale.com/download/mac> 引导手动安装 | 管理员授权 |
| Linux | 显示 `curl -fsSL https://tailscale.com/install.sh \| sh`；root/免密 sudo 时可代跑 | 复制命令手动执行 | root/sudo |
| Windows | `winget install Tailscale.Tailscale` | 打开下载页 | 可能 UAC |

- 安装前必须**用户点击并二次确认**；安装中显示进度/日志尾部；结束自动重新检测。
- **App Store 版**与 **standalone 版** CLI 路径不同但命令一致；本机当前是 App Store 版（沙箱 entitlements，`/Applications/Tailscale.app`），插件兼容两者。
- macOS 装完 standalone 后需要用户首次打开 App、批准 VPN 配置（系统扩展），插件只能引导不能代做。
- 卸载不是本插件职责；只做检测与提示。

### 18.3 登录（两种都做）

| 方式 | 交互 | 实现 |
|---|---|---|
| **扫码/链接登录**（推荐） | 设置页把 `AuthURL` 渲染成**本地二维码**（纯前端生成，不外发）+「在浏览器打开」 | `tailscale up`（未登录时 CLI 返回 AuthURL）或直接读 `status --json.AuthURL`；二维码 60s 自动隐藏 |
| **auth key 登录**（无头） | 环境变量优先（`TAILSCALE_AUTH_KEY`，可配 env 名）；设置页粘贴只走 Host 内存，不落盘/不进日志 | `tailscale up --authkey=… [--hostname=…]`，必须用户显式点击；仅在未登录/需要重新登录时可用 |

安全红线：**绝不自动 `up`/`login`**；auth key 不回显、不写状态文件、不写 profile；二维码内容不出本机。

### 18.4 统一配置项

| 配置 | 默认 | 说明 |
|---|---|---|
| `mode` | `auto`（唯一模式） | 不再有 reuse/managed 之分，永远操作本机 Tailscale |
| `autoPublish` / `httpsPort` / `publishPath` / `unpublishOnExit` | 同 v0.1 | 入口行为 |
| `hostname` | 空（保持节点现名） | 设置后执行 `tailscale set --hostname <name>`；**改的是整机节点名**，需二次确认并提示影响其他服务 |
| `authKeyEnv` | `TAILSCALE_AUTH_KEY` | 读取环境变量的键名 |
| `allowAutoInstall` | `false` | 必须显式开启才允许插件代跑安装命令 |
| `installMethod` | `auto` | `auto` / `brew` / `pkg` / `manual`，按平台可用性降级 |
| `deviceTtlMs` / `probeTimeoutMs` / `allow` | 同 v0.1 | 设备感知 |

### 18.5 与 v0.1 的差异

- **不新增** `ManagedBackend`、userspace tailscaled、独立 state/socket/节点；原 §18 方案作废（已实现的服务契约、serve 生命周期、自愈逻辑全部保留）。
- 新增：`SetupManager`（检测/安装/启动）、`AuthURL`/`loginWithAuthKey`、`setHostname`、设置页安装/登录状态机、二维码组件。
- `ctx.tailscale` 契约保持不变；`summary()/status()` 增加 `setup: { installed, cliPath, appPath, method }` 与 `authUrl`（仅 NeedsLogin 时）。

### 18.6 分阶段

| 阶段 | 内容 | 验收 | 预估 |
|---|---|---|---|
| **P2a 安装向导** ✅ | 检测矩阵 + `brew`/`pkg` 代跑（含系统授权弹窗）+ 安装状态机 + 设置页引导 | ✅ 2026-10-24 已实现（detect/install/start + 安装卡轮询）；真机"未安装"场景待找空机器验证 | 1–1.5 天 |
| **P2b 登录与身份** ✅ | AuthURL 本地二维码、auth key 登录、hostname 修改（二次确认） | ✅ 已实现（vendored MIT qrcode-generator；auth key 走 0600 临时文件 + `--auth-key=file:`；hostname `set --hostname` + 二次确认）；现网已装机器上路径已测 | 1 天 |
| **P2c 收口** 🟡 | 状态机与顶部图标统一、错误文案、自动化测试（假 CLI 安装/登录场景）、文档 | ✅ 86 条离线测试覆盖 setup/login/hostname 守卫与降级；剩余：真机「未安装」环境跑一次安装全流程、未登录态视觉验证 | 0.5–1 天 |
| **P3 手机联动** | dsh-phone 的 adb/hdc 通过 `ctx.tailscale` 发现设备 | 原计划 | 1–1.5 天 |

### 18.7 风险

| 风险 | 缓解 |
|---|---|
| 自动安装需要管理员权限，无法全静默 | 只用系统授权弹窗（osascript；插件不接触密码）；失败就给可复制命令 |
| 用户机器没有 Homebrew / 网络受限 | 降级到官方 pkg 下载页 + 手动引导；所有失败路径给出确切原因 |
| App Store 版无法被 brew 管理 | 检测来源；App Store 版只做使用与登录，不尝试覆盖安装 |
| macOS 首次安装需要用户批准 VPN 配置 | 明确提示「打开 Tailscale 并允许 VPN 配置」，未完成时状态机停在"已安装未运行" |
| auth key 泄漏 | 仅环境变量/内存；不落盘；错误信息脱敏 |
| hostname 改动影响整机 | 默认不改；修改前二次确认并列出影响（SSH、serve 域名、其他服务） |
