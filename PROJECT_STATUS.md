# 项目当前状态（Project Status — 2026-07-30）

> **目的**：新会话窗口打开后，5 分钟内吃透项目当前状态。
>
> **关系**：
> - `PROJECT_SUMMARY.md` — 项目背景 / 技术架构 / 已实现功能 / 设计决策（**严重过期**：408 tests → 545 tests）
> - `PII_REWRITE_LOG.md` — PII 历史清理审计（不变）
> - `TEST_SPECIFICATION.md` — 162 spec 覆盖表（不变）
> - `PRE_FLIGHT_CHECK.md` — 11 章踩坑沉淀（不变）
> - `PROJECT_STATUS.md`（本文件）— **当前状态 + 待办 + 新会话提示**，**唯一聚焦"现在能干什么 + 还有什么没干"**

---

## 1. 一句话定位

`document-desensitizer` 是 spy 的中文法务 / 合同脱敏浏览器工具。**核心能力**：

- 上传 DOCX/PDF/XLSX/图片（OCR）→ 13 类敏感信息自动识别（PHONE/ID_CARD/EMAIL/BANK_CARD/IP/AMOUNT/ADDRESS/CONTRACT_NO/PROJECT_NAME/COMPANY/NAME/TAX_ID/AMOUNT_UPPER）+ 手动添加
- 浏览器端 AES-GCM 加密 mapping table → 下载脱敏 docx（**byte-perfect 保真**）
- 上传脱敏 docx + 密码 → 还原原文

**部署**：纯前端 Vite 5 + React 18，无后端。`vite preview --port 3000` 启本地服务。

---

## 2. 当前硬状态（截止 2026-07-30）

| 维度 | 值 | 证据 |
|------|---|------|
| **HEAD** | `d9c4932` (Q1 trim 修法 commit) | `git log --oneline -1` |
| **测试** | **545 pass / 3 skip / 1 todo / 0 fail** | `npx vitest run` |
| **tsc** | clean | `npx tsc --noEmit` |
| **ESLint** | 0 errors（4 pre-existing useCallback warnings） | `npm run lint` |
| **git status** | 干净（无 working tree 修改） | `git status` |
| **PII 真值** | 见 §8 — 真合同类 PII 0 命中（golden case 关键词 84 命中预期保留） | `bin/pii-clean.sh` step 4 |
| **MEMORY 行数** | 280+ 行（已超 200 上限，建议拆） | `~/.claude/projects/-Users-messi-CC/memory/MEMORY.md` |

---

## 3. 最近 10 个 commit（业务上下文）

```
d9c4932 fix(docxWriter): replace full trimmed range to stop original-value残留
74cfcef test(docxWriter): add Q1 multi-space padding probe + trim padding contract
6864a22 fix(docxWriter): trim surrounding whitespace on maskedToken replace
aea7275 test(file-store): R1 测试 fixture 同步换 ASCII 占位符
2abc6a8 fix(file-store): addManualMatch 返回 boolean 让 toast 按结果分支
22ea2f2 fix(upload-page): 7 个 UX bug 修复 + 4 个 grep 契约
c8a1742 fix(upload-page): 缓存 rawOffset 到 ref 解决 Chrome button click selection race
5af9616 fix(crypto): 长字段压缩到 MAX_VISIBLE_UNDERSCORE_LEN — 消除"撑开"
d59607c fix(upload-page): 回退 v3 widening CSS 修正 + 修图片提示说明后文字添加失灵 regression
2157b5f fix(scripts): pii-clean.sh (4) working tree 验证 — 修 xargs LC_ALL bug
```

**主旋律**：Q1「下划线+空白」修法（6864a22 → 74cfcef → d9c4932 三连）+ 真值 PII 防护 + UX 收尾。

---

## 4. 已知问题（已识别，未修）

### 4.1 Q1「下划线+空白」未完全解决（**主动放弃**）

**症状**：spy 真合同截图里占位符仍是短下划线，下划线之后无空白（trim 修法保住了），但长字段压缩到 8 个 `_`。

**决策**：spy 决定不再追更长下划线。**Q1 现状 = d9c4932**。

**未来启 Q1 的入口**（详见 MEMORY §Q1）：
- 架构层：scanner 支持 vanish run 元数据
- 或换标记方案：`generateDisplayToken` 输出 `[TYPE_NNNN]` 不含 ZWS（需重设计 occurrence 配对）
- **不要在 docxWriter 层打补丁** — 两次失败教训

### 4.2 MEMORY.md 超 200 行硬限（**建议拆**）

**症状**：当前 280+ 行，已超 MEMORY.md 文档建议的 200 行硬限。

**建议**：拆成 `commit-journal.md`（已有）/ `ooxml-gotchas.md`（已有）/ `regression-patterns.md`（已有）+ MEMORY.md 只保留目录。

**状态**：未做（不影响功能，但 MEMORY 加载变慢）。

### 4.3 PROJECT_SUMMARY.md 严重过期

**症状**：写的是 408 tests，实际 545 tests（多了 137 个）。

**建议**：下次有空时同步 PROJECT_SUMMARY.md 的数字。

**状态**：未做（不影响功能）。

### 4.4 widening bug 主动放弃（v3 CSS 容错）

**症状**：长 match 撑爆 panel 横向 → 跳位。

**状态**：✅ **真正 offset bug 已用 v2（`data-raw-offset` + `getRawOffsetFromSelection`）根治**，落点精准。widening CSS 容错在 Safari + Chrome 都失败，已回退（d59607c）。

---

## 5. 待办（TodoList）

| 任务 | 状态 | 阻塞 |
|------|------|------|
| #45 阶段 4 — 全套验证 + spy 端到端 + commit | ✅ completed | — |
| #50 spy 真合同端到端验证 | ✅ completed | — |
| #51 rebuild + 重启 vite preview | ✅ completed | — |
| #52 commit trim 修法（fix + test） | ✅ completed | — |
| **#53 写项目状态交接文档** | 🔄 in_progress | — |

**无 pending 业务任务**。需要 spy 拍板才能启新功能。

---

## 6. 失败教训（必须看，新人最容易踩）

### 6.1 Q1 vanish run 方案两次失败（最新）

- **坑**：`scanNodes` 不区分 vanish run → restore 时 originalValue 被塞进 vanish run → 恢复的正文 Word 看不见
- **坑**：加 unwrap 路径时，docx 库生成的空 run 被误判为"前一个 run"，unwrap 引入 V2/V5 regression
- **教训**：**修法不能只考虑 mask 一侧**，必须同时验证 round-trip；**最小可验证单元必须包含 round-trip**

### 6.2 反复犯错的 5 个模式（详见 `regression-patterns.md`）

1. commit 不验证 build 就给 spy 建议"刷新浏览器"——浪费时间
2. 测试通过 ≠ 修法生效（必须 commit + build + 真合同验证）
3. probe fixture 不脱敏 → 入 git history
4. filter-branch 漏处理测试目录 → 残留 PII
5. 装 hook 的 commit 自己也要遵守契约

### 6.3 真合同 fingerprint 必读（详见 `regression-patterns.md` §5）

- 13【】brackets / 0 ZWS / 83 U+0020 → padding 全在【】内
- 17 个下划线连续串 / 115 个 ZWS → 不能简单删 ZWS 标记
- 长字段压缩到 8 个 `_` → spy 不修短下划线

---

## 7. 关键技术事实（写代码前必须查）

### 7.1 maskedToken / originalValue 双向替换

- **desensitize**：原值 → maskedToken（`[TYPE_NNNN]` 格式，详见 `src/utils/crypto.ts:84`）
- **restore**：maskedToken → 原值（AES-GCM 解密 mapping table）
- **maskedToken 含 ZWS**：`generateDisplayToken` 在下划线后追加 `(index+1)` 个 U+200B（Q1 真因）

### 7.2 docxWriter 关键设计

- `applyDocxEdits` 按 maskedToken 分组，组内按 occurrence 顺序一对一替换（d9c4932 + 6864a22）
- `expandRangeOverSurroundingWhitespace` trim 紧邻 U+0020/U+3000/TAB（覆盖 NBSP/EM SPACE/全角空格）
- `applyPerNodeReplacement` 处理跨 `<w:ins>/<w:del>` 边界
- `mergeRunsForCoverage` 合并相邻 w:r，但保留 `<w:proofErr/>` 等 sibling

### 7.3 mammoth / docx 跨环境差异

- 浏览器 `{ arrayBuffer }`，Node `{ buffer }` —— 跨环境测试要同时传

### 7.4 已知环境踩坑

- **vite build 必须 rm -rf dist + 完整 rebuild**，不能增量（chunk hash 不同步 → "Importing a module script failed"）
- **重建 vite preview 必须 pkill + nohup 重启**，否则跑旧代码
- **EMF 矢量图浏览器无法渲染**（`src/components/preview/replaceEmf.ts` 处理）

---

## 8. PII 防护机制（commit-msg + pre-commit）

**双 hook**：
- `scripts/check-pii-msg.sh` — 拦 commit message 含 PII 字面
- `scripts/check-pii.sh` — staged diff 扫描 12 类 + 外挂字典
- `scripts/` 整目录豁免（工具代码 PATTERN 字面天然像 PII）

**4 个 PII 维度真值**（2026-07-30 重新扫描）：

- (1) reachable commit messages: **7**（`测试占位符` 1 + `融媒体` 5 + `辛公司` 1 — golden case 关键词，**预期保留**）
- (2) file content diff: **0**（真合同类 PII 字面 — 公司名 / 人名 / 电话 / 邮箱 / 地址 — 全部 0 命中）
- (3) .git/objects/pack: **0**
- (4) working tree: **84**（golden case 关键词 — `测试占位符` 21 + `融媒体` 36 + `辛公司` 27 — **预期保留**；真合同 docx `SAMPLE-CT-005-代理合同-2025.docx` 已删，真合同类 PII 0 命中）

---

## 9. 新会话提示模板（**复制粘贴**）

打开新会话窗口时，**第一句话**输入下面这段（可按需删改）：

```
你好，我是 spy。这是 /Users/messi/CC/document-desensitizer 项目。

【必读】
- /Users/messi/CC/document-desensitizer/PROJECT_STATUS.md — 当前状态、待办、失败教训
- ~/.claude/projects/-Users-messi-CC/memory/MEMORY.md — 我的工作记忆
- ~/.claude/projects/-Users-messi-CC/memory/regression-patterns.md — 5 个反复犯错模式

【当前硬状态】
- HEAD: d9c4932
- 545 pass / 0 fail / tsc clean / git 干净
- 无 pending 业务任务

【要做什么】
<你具体要做的任务>
```

**为什么这样写**：
1. 项目路径明确，避免新 agent 走错目录
2. 3 个必读文档指向明确，省探索时间
3. 硬状态一行字，避免重复 `git log` / `vitest run`
4. 「要做什么」空格—— 让 spy 自由填具体任务

---

## 10. 紧急联系（CLAUDE.md / MEMORY 不覆盖时的退化路径）

如果上面文档有遗漏，按这个优先级查：

1. **`/Users/messi/.claude/projects/-Users-messi-CC/memory/MEMORY.md`**（工作记忆，必读）
2. **`/Users/messi/CC/document-desensitizer/PROJECT_STATUS.md`**（本文件）
3. **`/Users/messi/CC/document-desensitizer/PROJECT_SUMMARY.md`**（项目背景，已过期）
4. **`/Users/messi/CC/document-desensitizer/PRE_FLIGHT_CHECK.md`**（11 章踩坑）
5. **`/Users/messi/CC/document-desensitizer/PII_REWRITE_LOG.md`**（PII 审计）
6. **`/Users/messi/CC/document-desensitizer/TEST_SPECIFICATION.md`**（162 spec 覆盖表）
7. **`/Users/messi/.claude/projects/-Users-messi-CC/memory/regression-patterns.md`**（5 个反复犯错模式）

---

## 11. 元数据

- **文件路径**：`/Users/messi/CC/document-desensitizer/PROJECT_STATUS.md`
- **创建时间**：2026-07-30
- **创建原因**：spy 要求"打开新会话能快速全面知道项目情况"
- **更新频率**：每次重大 commit / 任务完成后
- **不替代** PROJECT_SUMMARY.md / PII_REWRITE_LOG.md —— 互补关系

---

> **最后说一句**：本文件不是死文档。如果未来 30 天没有更新，且项目有重大 commit / bug 修复 / PII 事故，**必须更新本文件**。否则下次新会话打开仍会卡在"现状模糊"。