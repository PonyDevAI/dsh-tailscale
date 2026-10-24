# 发布规范（自动发布 · Tag 触发）

本项目**不手动 `npm publish`**。发布唯一入口是**推送 `v*` tag**，由 GitHub Actions 自动完成。

## 一、链路总览

```
git push --follow-tags
        │
        ▼
GitHub Actions: .github/workflows/release.yml   (触发: push tags: v*)
  1. 校验 tag 与 package.json 版本一致（不一致 → 失败，防误发）
  2. 语法检查 + 冒烟测试（scripts/smoke.mjs）+ i18n 键校验（scripts/check-i18n.mjs）
  3. npm Trusted Publishing（OIDC）发布，附 SLSA provenance 签名
     - 版本已存在则跳过（幂等，可安全重跑）
  4. 从 CHANGELOG.md 抽取当前版本条目（缺失/为空 → 失败）
  5. 创建 GitHub Release（正文 = 第 4 步产物）
```

CI（`.github/workflows/ci.yml`）在 push `main` / PR 时只跑检查（语法 + 冒烟 + i18n + `npm pack` 内容校验），**不会发布**。

## 一·五、CHANGELOG 与 Release 正文（强制）

- **每个版本必须在 `CHANGELOG.md` 有对应 `## <版本>` 条目**，缺失时 release workflow 直接失败（`scripts/release-notes.mjs`）
- GitHub Release 正文 = **自动从 CHANGELOG 抽取当前版本条目**（不是全文、不是手写）
- 发版前把 `(unreleased)` 占位换成日期；条目格式：

```markdown
## 0.2.0 — 2026-10-25

- 用户可感知的变化（不写实现流水账）
- ...
```

- 语言：与仓库一致用中文；写"用户可感知的变化"，不写实现细节流水账
- 版本标题格式：`## <semver> — <YYYY-MM-DD>`（工具按 `## <version>` 前缀匹配，`(unreleased)` 也能抽到，但正式发布必须带日期）

本地预演（打 tag 前跑一次，确认能抽到正文）：

```bash
node scripts/release-notes.mjs /tmp/release-notes.md
cat /tmp/release-notes.md
```

## 二、认证方式（OIDC，永不过期）

使用 **npm Trusted Publishing（OIDC）**：

- npm 包设置 → Trusted Publisher → GitHub Actions
  - Organization or user: `PonyDevAI`
  - Repository: `dsh-tailscale`
  - Workflow filename: `release.yml`
- workflow 权限：`id-token: write` + `contents: write`
- **不需要** `NPM_TOKEN` secret、不需要 OTP、不会过期
- 发布包自动获得 `dist.attestations.provenance`（SLSA v1）

### 首次发布（包在 npm 上还不存在时）

Trusted Publisher 只能在**已存在的包**的设置页里配置，所以首个版本需要引导一次：

1. 维护者在本机用一次性 **granular access token**（勾选 `@ponydev` 范围、写权限，开启 2FA）手动发布首个版本：
   ```bash
   npm publish --access public --otp=<OTP>   # 本机首次发布不带 --provenance（没有 OIDC 环境）
   ```
2. 包出现在 npm 后，打开包设置 → Trusted Publisher，按 §二 填三项。
3. **立即 revoke 那个一次性 token**；之后所有版本都走 tag + OIDC，不再需要任何长期 token。

> 不要长期使用 bypass-2FA token：最长 7 天，且 2027 年起 npm 禁止直接 token 发布。

## 三、标准发版步骤

```bash
# 0. 确认工作区干净、检查通过
git status
for f in lib/*.js; do node --check "$f"; done
node scripts/smoke.mjs
node scripts/check-i18n.mjs
npm pack --dry-run

# 1. 更新 CHANGELOG.md（新增当前版本条目，去掉 unreleased 占位并写日期）

# 2. 升版本（自动改 package.json + commit + 本地 tag）
npm version patch     # 修复：0.2.0 → 0.2.1
npm version minor     # 新功能：0.2.x → 0.3.0
npm version major     # 破坏性：0.x → 1.0.0

# 3. 推送（--follow-tags 会带上 tag，触发发布）
git push --follow-tags
```

发布完成后验证：

```bash
npm view @ponydev/dsh-tailscale version              # 应为新版本
npm view @ponydev/dsh-tailscale@<ver> dist.attestations   # 应有 provenance
gh run list --limit 3                                # Release workflow success
gh release view v<ver>                               # Release 已创建，正文来自 CHANGELOG
```

## 四、版本规则

| 变更类型 | 版本 | 示例 |
|---|---|---|
| 修 bug / 文案 / 样式 | patch | 0.2.0 → 0.2.1 |
| 新功能（兼容） | minor | 0.2.1 → 0.3.0 |
| 破坏性（改配置结构、RPC、`ctx.tailscale` 契约、去除功能） | major | 0.3.0 → 1.0.0 |

- `engines.dsh` 兼容范围变化视为 major
- `ctx.tailscale` 服务契约（方法名/参数/返回结构）变化视为 major
- 每个版本必须在 `CHANGELOG.md` 增加条目

## 五、手动打 tag（等价方式）

```bash
# 先把 package.json version 改成目标版本并提交到 main
git tag -a v0.2.0 -m "dsh-tailscale 0.2.0"
git push origin v0.2.0
```

tag 与 `package.json` 不一致会导致 workflow 第一步失败。

## 六、发布前检查清单

- [ ] `node scripts/smoke.mjs` 通过
- [ ] `node scripts/check-i18n.mjs` 通过
- [ ] `npm pack --dry-run` 内容正确（含 `lib/`、`docs/`、`AGENTS.md`、`CONTRIBUTING.md`、`RELEASE.md`；无临时文件/密钥/本机状态）
- [ ] `CHANGELOG.md` 已更新，`## <版本> — <日期>` 条目非空
- [ ] `README.md` 的安装命令/包名/配置项/`ctx.tailscale` 示例与实际代码一致
- [ ] `docs/screenshots/` 截图与实际 UI 一致（UI 变更时）
- [ ] `package.json` 的 `version` 与将要打的 tag 一致；`publishConfig.access = public`
- [ ] 默认配置/安全边界没有回归：不自动 `up/down/login`、不 Funnel、不 `serve reset`、auth key 不落盘

## 七、GitHub Release

- 自动创建，标题 `v<版本>`，正文 = `CHANGELOG.md` 当前版本条目
- 不手工编辑历史 Release；如需补充说明，在下一个版本体现

## 八、故障处理

| 现象 | 原因 | 处理 |
|---|---|---|
| `tag x != package.json y` | 版本没改或 tag 打错 | 删本地 tag `git tag -d vX`，改版本后重打 |
| 发布步骤 "already published, skipping" | 该版本已存在 | 正常；要重发请升版本 |
| `E403 ... trusted publisher` | npm 未配置 OIDC，或 repo / workflow 名不匹配 | 检查 npm Trusted Publisher 三项字段（`PonyDevAI` / `dsh-tailscale` / `release.yml`） |
| `CHANGELOG.md 缺少当前版本 …` | 忘了写 CHANGELOG | 补条目后重新推送（同一 tag 重跑即可，发布是幂等的） |
| `CHANGELOG.md 中 ## x.y.z 条目内容为空` | 只有标题没内容 | 补内容 |
| npm 页面差几分钟才出现新版本 | registry 同步延迟 | 等待 2–5 分钟，直接查版本接口 |
| 需要撤回刚发布的版本 | 72 小时内可 unpublish | 见下节（需 2FA/OTP） |

### 撤回/废弃

```bash
# 72 小时内：删除版本
npm unpublish @ponydev/dsh-tailscale@<ver> --force --otp=<OTP>

# 超过 72 小时：标记废弃（推荐）
npm deprecate @ponydev/dsh-tailscale@<ver> "原因，建议升级到 x.y.z"
```

撤回后如需重发同一版本，先删远端 tag 再重新打（不要改写已发布 tag 的历史）。
