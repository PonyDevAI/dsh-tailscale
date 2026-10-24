// 校验 lib/client.js 的 zh/en 字典：
// 1. zh/en 键集合必须完全一致（少一个就 exit 1）
// 2. 代码里字面量 tr('key') 用到的键必须存在于字典（缺失就 exit 1）
// 3. 动态键（状态映射里查表后 tr(x.key)）从映射表提取，避免误报
//
// 动态键来源（不要改成写死名单，UI 状态增减时这里会自动跟上）：
// - STATUS_HINTS 的键（statusRunning / statusNotInstalled / …）和值（hintNotInstalled / …）
// - ERROR_STATUS 的值（错误码 → status 键）
// - CODE_TEXT 的值（错误码 → 文案键）
// 以上三者被 statusInfo() / statusFromErrorCode() / errorText() 用来拼 tr(st.key)、tr(known.hintKey)、tr(CODE_TEXT[code])。
import { readFileSync } from 'node:fs'

const src = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

function die(message) {
  console.error(message)
  process.exit(1)
}

/** 找到 `{` 之后与之配对的 `}` 下标；跳过字符串字面量里的花括号。 */
function objectEnd(text, start) {
  const open = start < 0 ? -1 : text.indexOf('{', start)
  if (open < 0) return -1
  let depth = 0
  for (let i = open; i < text.length; i += 1) {
    const ch = text[i]
    if (ch === "'" || ch === '"' || ch === '`') {
      const quote = ch
      i += 1
      while (i < text.length) {
        if (text[i] === '\\') {
          i += 2
          continue
        }
        if (text[i] === quote) break
        i += 1
      }
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return i
    }
  }
  return -1
}

function sliceBlock(label, startMarker, endMarker, from = 0) {
  const start = src.indexOf(startMarker, from)
  if (start < 0) die(`找不到 ${label}（${startMarker}）`)
  const end = src.indexOf(endMarker, start + startMarker.length)
  if (end < 0) die(`找不到 ${label} 的结束标记（${endMarker}）`)
  return { text: src.slice(start, end), start }
}

const zhStart = src.indexOf('const zh = {')
const enStart = src.indexOf('const en = {')
const trStart = src.indexOf('function trWith')
if (zhStart < 0 || enStart < 0 || trStart < 0) {
  die('找不到 zh/en 字典或 trWith（本脚本依赖 lib/client.js 的字典与 trWith 结构）')
}
if (!(zhStart < enStart && enStart < trStart)) {
  die('字典顺序异常：期望 const zh = { … } 在 const en = { … } 之前、trWith 之后')
}

const zhEnd = objectEnd(src, zhStart)
const enEnd = objectEnd(src, enStart)
if (zhEnd < 0 || enEnd < 0 || enEnd < enStart) die('无法定位 zh/en 字典的结束花括号')

// 字典里每个条目形如 `key: '文案'`（值都是单引号字符串）；只取键名。
const keysOf = (block) =>
  new Set([...block.matchAll(/([A-Za-z][A-Za-z0-9]*):\s*'(?:[^'\\]|\\.)*'/g)].map((m) => m[1]))

const zh = keysOf(src.slice(zhStart, zhEnd + 1))
const en = keysOf(src.slice(enStart, enEnd + 1))

// 字面量使用：tr('someKey') / tr('someKey', { … })
const literal = new Set([...src.matchAll(/tr\('([A-Za-z][A-Za-z0-9]*)'/g)].map((m) => m[1]))

// 动态使用：状态映射里的字符串键。只从这三张表提取，避免把 'ok' / 'warn' 之类 tone 误当文案键。
const dynamic = new Set()
const hints = sliceBlock('STATUS_HINTS 映射', 'const STATUS_HINTS = {', 'const STATUS_TONES')
for (const m of hints.text.matchAll(/([A-Za-z][A-Za-z0-9]*):/g)) dynamic.add(m[1])
for (const m of hints.text.matchAll(/:\s*'([A-Za-z][A-Za-z0-9]*)'/g)) dynamic.add(m[1])
const errorStatus = sliceBlock('ERROR_STATUS 映射', 'const ERROR_STATUS = {', 'const CODE_TEXT')
for (const m of errorStatus.text.matchAll(/:\s*'([A-Za-z][A-Za-z0-9]*)'/g)) dynamic.add(m[1])
const codeText = sliceBlock('CODE_TEXT 映射', 'const CODE_TEXT = {', 'function checksOf')
for (const m of codeText.text.matchAll(/:\s*'([A-Za-z][A-Za-z0-9]*)'/g)) dynamic.add(m[1])

const used = new Set([...literal, ...dynamic])

const onlyZh = [...zh].filter((k) => !en.has(k))
const onlyEn = [...en].filter((k) => !zh.has(k))
const missing = [...used].filter((k) => !zh.has(k))

let bad = false
if (onlyZh.length) {
  console.error('仅 zh 有（en 缺失）:', onlyZh.join(', '))
  bad = true
}
if (onlyEn.length) {
  console.error('仅 en 有（zh 缺失）:', onlyEn.join(', '))
  bad = true
}
if (missing.length) {
  console.error('代码使用但字典缺失:', missing.join(', '))
  bad = true
}
if (bad) process.exit(1)

console.log(
  `i18n OK（zh ${zh.size} 键 / en ${en.size} 键 / 字面量 ${literal.size} 键 / 动态 ${dynamic.size} 键）`,
)
