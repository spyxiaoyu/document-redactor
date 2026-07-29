# PII 历史重写记录 (PII History Rewrite Log)

> **本文件不含任何真 PII 字符串字面**——spy 零容忍原则。具体字符串映射在 git history filter-branch 之后已无法回溯查阅；本文件仅 show 出"哪些类别被发现"的元数据，用于未来审计"同类 PII 防再犯"流程。原文映射见 .git.bak.pre-filter 删除前本地回复（已无法，已无法）。

**生成时间**: 2026-07-21
**触发原因**: spy 第二轮 PII 审计发现 git history 4 个早期 commit 含真合同名 / 真邮箱 / 真电话 / 真路径，working tree 干净但 history 永久保留 PII。
**操作类型**: `git filter-branch`（仅本地，no remote，无 force-push 风险）
**操作者**: Claude (MiniMax-M3)，spy 拍板
**当前状态**: ✅ main + format-preservation-jszip 双 branch 均 grep 0 PII 命中（scripts/ 豁免目录除外）

---

## 1. 背景

`document-redactor` 是 spy 的中文法务 / 合同脱敏工具。在 [REDACTED commit-A] "security: desensitize 33 files"（2026-07-21）之前，git history 中部分 commit 含真合同 PII：

| 旧 commit hash | PII 类别（不显示字面） | 涉及的脱敏工具 |
|---|---|---|
| `[REDACTED]` | 真合同文件名 + 真合同路径 | spy 第六批 TAX_ID bug 来源 |
| `[REDACTED]` | 真姓名 + 真电话 | B5VerifyRealFlow / UnderscoreDisplay / docxWriter 测试 |
| `[REDACTED]` | 真邮箱 + 真姓名 | B4StructurePreservation / docxWriter / docxZipReader 测试 |
| `[REDACTED]` | commit message 引用真合同路径 | "desensitize 33 files" commit 自身 |

具体旧 hash 见 §4（原已脱敏但 commit 引用已脱敏不准，此处主动 REDACTED）。

### Spy 拍板后的修复

spy's 命令：**"查 remote"** → `git remote -v` 输出空（无 origin，未 push 到任何远端）→ 确认仅本地历史 → **"跑 A"** → 选择 filter-branch 清理（方案 B/C 拒选原因参见 [REDACTED prefilter commits] message）。

---

## 2. 操作步骤（事后重建，供未来参考）

### Step 1: 备份
```bash
cp -r .git .git.bak.pre-filter
```
- backup 7.8MB
- Step 6 验证通过后删除

### Step 2: filter-branch msg-filter（commit messages）
第一轮只覆盖部分 PII，**漏了** <REDACTED-1> + <REDACTED-2> 单字。第二轮补完。第三轮单独补 <REDACTED-2>。

### Step 3: filter-branch tree-filter（file content）
第一轮漏 <REDACTED-1> + <REDACTED path-2> + <REDACTED pattern-X>*。恢复 backup + 第二轮补完。

### Step 4: 清理
- `rm -rf .git.bak.pre-filter`
- `rm -rf .git/refs/original`（filter-branch 自动 backup）

---

## 3. PII 替换映射（已脱敏 — 字面 REDACTED）

> 原文一侧不显示真 PII 字面以满足 spy 零容忍原则。

**真合同号（4 处）**：
| 替换为 |
|---|
| `SAMPLE-CT-001-TITLE` (单字 title) |
| `SAMPLE-CT-001` (前缀 title + suffix) |
| `SAMPLE-CT` (纯 suffix) |
| `SAMPLE-CT-002` |
| `SAMPLE-CT-003` |
| `SAMPLE-CT-004` |

**真路径（2 处）**：
| 替换为 |
|---|
| `<repo-path>` (Downloads) |
| `<repo-path>` (Desktop/file) |

**真公司代号（13 处）**：
| 替换为 |
|---|
| `SAMPLE-CO-Y` (短词) |
| `SAMPLE-CO-Z` (短词+科技) |
| `SAMPLE-CO-A` ~ `SAMPLE-CO-M` (剩余 11 家，字母序) |

**真联系人 / 真邮箱 / 真电话（5 处）**：
| 替换为 |
|---|
| `张某某` (真姓名) |
| `contact@client-a.test` (邮箱 1) |
| `contact@client-b.test` (邮箱 2) |
| `13800000001` (电话) |

**合计**: 24 unique 字符串映射条目，已全部 filter-branch 改写。

---

## 4. 新 commit hash vs 旧 hash 映射（已知参照点）

> **新 hash 永久有效。旧 hash 已废弃。**

| 旧 hash（部分 REDACTED） | 旧 message | 新 hash（main 上） |
|---|---|---|
| `1ca38b9` | feat: 加 pre-commit PII 拦截 hook 层（17 pattern 防真合同/真路径泄漏） | `dc8dc4d` |
| `bb73876` | fix: 修 7 处 PII 路径泄漏（真合同文件名 + username + 真合同字眼） | `b322edf` |
| `b35adff` | fix: NARRATIVE_BOUNDARY_VERB_END 删 "为" 误伤真品牌名 | `88552ce` |
| `afc81b4` | fix: COMPANY 二次检查从单字字符集改 2 字连词链 | `760a703` |
| `a461ac1` | feat: NAME 多姓名匹配拆成独立 SensitiveMatch | `f716420` |
| `c2c911a` | feat: AMOUNT 人民币前缀 + NAME 多姓名续接 + post-filter 截断兜底 | REDACTED |
| `170d244` | test: add detect smoke | REDACTED |
| `f716231` | security: desensitize 33 files | REDACTED |
| `802a6f3` | fix: 第九批 spy 真合同 audit | REDACTED |

旧 commit hash 与新 commit hash 一一对应但**没有一一映射表**（filter-branch 改写所有 commit，新 hash 顺序按原 commit 时间序）。若需要找特定旧 hash 对应的新 hash：`git show <old-hash> 2>/dev/null` 会失败——用 `git log --all --grep="<message 关键字>"` 重新定位。

---

## 5. 教训（积累到 MEMORY.md §6）

### 5.1 工作模式漏洞
1. **5 轮 working tree grep 漏 git history**——宣告"已脱敏" ≠ 真脱敏。grep 必须包含 `git log --all -p` 才算闭环。
2. **某 commit message 自称"0 泄漏"是骗自己的**——注释里含真合同路径 + commit message 自己留了完整真合同名。每次 commit message 写"已脱敏 X 处"必须 force-check。
3. **filter-branch sed 漏字符串**——第一轮只覆盖了 14 个里 13 个 + 漏路径变体。每次 sed 必须先 `grep -oE` 抓全集再写脚本。
4. **写 PII_REWRITE_LOG.md 时又写入了真 PII 字面**——即使是"描述 PII 类别"，字面字符串也不能进文件。本次 commit 改用 REDACTED 占位。

### 5.2 下次必须做的（working tree 流程补充）
- 所有 PII 修复 declare-complete 前必须执行：
  ```bash
  # 1. working tree 干净
  grep -rn "<PII_PATTERN>" src/ docs/ tests/ --include="*.ts" --include="*.md"
  # 期望 0 命中

  # 2. git history 全 clean（scripts/ 豁免）
  git log --all -p -- . ':!scripts/*' | grep -E "<PII_PATTERN>" | head -3
  # 期望 0 命中
  ```
- commit hook scripts/check-pii.sh 已包含 17 pattern。**新发现的 PII 类别必须同步加入 PATTERN 列表 + scripts/__tests__/check-pii.test.ts 加 1 条契约用例**——不要放过。
- backup .git 是 filter-branch 唯一兜底——必须 `cp -r .git .git.bak.pre-filter` 在 destructive 前做。
- **写 PII 描述文档时也要脱敏**：即使是元数据描述、真值映射表，**字面字符串不进文件**，用 REDACTED / `<PII category>` 占位。

### 5.3 scripts/ 豁免的设计权衡
- scripts/ 包含工具代码自身 (check-pii.sh 的 PATTERN 字面) + probe fixture 字面（piy-self.ts 含 6 类 PII 字面）。豁免换得工具代码不被自我拦截。
- **trade-off**：未来 scripts/ 目录新增 .sh 工具脚本若含真合同 PII 不会被拦截。spy 应在 commit 时人工 review 工具脚本 commit message + 不允许真合同信息入 scripts/。

---

**事后清理**：
- `.git.bak.pre-filter` 已删除（节省 7.8MB）
- `.git/refs/original/` 已删除（避免旧 commit object 继续含 PII）
- 总 .git: 9.8MB（filter-branch 后历史略增加）
- **未 push 到任何远端**（`git remote -v` 输出空），因此 filter-branch 不需 force-push，未来 push 也是"干净 push"。

---

## 6. 第三次 PII 历史清理（2026-07-28~29）

**触发原因**：第二次 PII 清理（§1-5）后 `git log --all -p` 看似 0 PII，但深入审计发现仍有两处遗漏：

1. **commit message 含 PII**：`--tree-filter` 只改 file content，**不改 commit messages** → 历史 88 个 commit message 里藏着 27 处 PII 字符串（如 REDACTED-co-N / REDACTED-person / REDACTED-phone / REDACTED-co-M 等被 commit 注释引用）
2. **dangling commit objects 残留**：filter-branch 创建新 commit objects 但旧 commit object 留在 `.git/objects` 默认 90 天（gc 之前可恢复）→ 即使 `git log --all` 0 命中，dangling 仍含 PII

**Spy 拍板**："跑 filter-branch 清理历史，确保不能保留任何真实 PII"。

**操作步骤**：

1. 写 `/tmp/replace-pii-msg.pl`（commit message 专用 perl 脚本）
   - **关键 fix**：`use utf8;` + `binmode(STDIN, ':utf8');` + `binmode(STDOUT, ':utf8');` —— perl 脚本字面里中文字符必须 utf8 模式才能跟 UTF-8 stdin bytes 匹配（之前缺这一行，msg-filter 跑 88 commits 实际 0 替换）
2. `git filter-branch -f --msg-filter 'perl /tmp/replace-pii-msg.pl' --tag-name-filter cat -- --all`（第一次跑 88 commits 实际 0 替换 = use utf8 缺失）
3. 修 perl 脚本加 `use utf8;` + 第二次跑 88 commits（替换生效）
4. **关键后续**：
   - `git reflog expire --expire=now --all` + `git gc --prune=now --aggressive` 物理删 dangling PII commits
   - `git for-each-ref refs/original/ | xargs git update-ref -d` 删 filter-branch 自动建的 90 天回滚通道
   - 删 `backup/pre-pii-history-cleanup` tag（被 filter-branch rewrite 指向新 hash，**不再起回滚作用**）
5. 验证 3 层全 clean：
   - reachable refs（main / format-preservation-jszip / stash）0/26 PII in messages + diff
   - dangling objects 0（`git fsck --unreachable` 无输出）
   - `.git/objects/pack/*.pack` 0/26 PII（grep F-scan）

**踩坑（必须写入 MEMORY §6 防再犯）**：

- **`use utf8` 不是 optional**——perl 脚本里中文字面 vs stdin UTF-8 bytes 匹配**必须** utf8 模式 + binmode，否则替换全部静默失败
- **filter-branch 三次跑不是 redundant**——每次修不同的漏（tree 漏 / msg 漏 / dangling 漏）
- **msg-filter 比 tree-filter 难**——debug 时直接拿 commit message 跑 perl 看 output，filter-branch 内部 stdin 传递可能丢字
- **dangling commit 仍含 PII**——`git log --all` 不显示 dangling，必须 `git gc --prune=now` 物理删
- **filter-branch 重写 stash ref**——stash 中我自己加的 PII_REWRITE_LOG §6 段 unstash 时被丢弃，working tree reset 到 HEAD 状态 → **stash + filter-branch 联合操作要 re-verify 自己的 stash**

**当前状态（2026-07-29）**：
- ✅ reachable refs：0/26 PII in commit messages + 0/26 PII in file content diff
- ✅ dangling objects：0（git fsck --unreachable 0 hits）
- ✅ .git/objects/pack/*.pack：0/26 PII（grep scan）
- ✅ 464 tests pass / 3 skip / 0 fail
- ✅ tsc clean / eslint 0 errors（4 pre-existing warnings）
- main head: 新 hash（filter-branch 第四次 rewrite 后；旧 5c185b7 → 32d6d26 → 7e1ef56 → 5900c07 各次 rewrite）
- **未 push 到任何远端**（无 force-push 风险）

## 7. 结构性 fix — PII 不再进 git history（2026-07-29）

**触发原因**：filter-branch 是事后清理（4 轮 rewrite 浪费 6+ 小时），根因是 pre-commit hook 只拦 file content，commit message 完全裸奔，**第二次清理漏 commit message 里的 27 处 PII**。

**核心结论**：cleanup 不能代替 prevention。结构性 fix 让 PII 字面根本进不到 git history。

### 7.1 commit-msg hook 拦截 commit message 含 PII 字面

**新增文件**：
- `scripts/check-pii-msg.sh` — 12 类通用正则（与 `scripts/check-pii.sh` 同源）+ 用户本机外挂字典 `~/.pii-local/extra-patterns.txt`
- `.git/hooks/commit-msg` — 调 `check-pii-msg.sh`，可 `SKIP_PII_CHECK=1` 紧急绕过
- `scripts/__tests__/check-pii-msg.test.ts` — 12 个 contract 测试

**实战验证**：`60969de` commit message 第一次含真 PII literal（描述脚本用了 REDACTED-co / REDACTED-phone / REDACTED-person 占位），被 hook 拦截 → 重写用占位符描述后通过。**证明结构性 fix 有效**。

### 7.2 pre-commit hook 不再豁免 `__tests__/`

**问题**：`__tests__/` 豁免是 2026-07-21 + 2026-07-28 两次 filter-branch 漏处理测试目录 PII 残留的根因（spy 人工 review 兜底曾漏 248 命中）。

**修法**：移除 `__tests__/` 从 `EXCLUDE_DIRS_REGEX`（保留 `scripts/` 豁免 —— 工具代码 PATTERN 字面天然像 PII，且 `scripts/check-pii-msg.sh` 自身的 12 类 PII 正则会自拦）。probe 测试应用占位符（与生产一致）。

**测试更新**：`staged-4: __tests__/ 目录新增占位 PII → exit 1`（取消豁免契约）。

### 7.3 bin/pii-clean.sh — 一次性 PII 清理脚本

**新增文件**：`bin/pii-clean.sh`（可执行，205 行）

**封装经验**：把"tree-filter + msg-filter + dangling cleanup + 4 维度验证"四步封装成一次性脚本，下次再需清理 1 次跑完，不再手动 4 轮 filter-branch。

**设计要点**（写在脚本注释里）：
1. **perl script 用独立 .pl 文件，从 `$ENV{PII_PATTERNS_FILE}` 读 pattern** —— 不嵌 pattern 进 perl source，避开"bash → perl source → perl string" 3 层 escape 灾难（第一版踩坑：`sprintf '%q' "$to"` 在 bash 里把空 `$to` 变 `%q` 字面）
2. **tree-filter 用 `find + xargs + perl -CSD -i`** —— `filter-branch --tree-filter` 语义是"command 在 working tree 上 in-place edit"，不靠 stdin/stdout。第一版用 `perl $SCRIPT` 喂 stdin 是错的，file content 没改
3. **`perl -CSD` flag** —— `-CSD` = STDIN/STDOUT/ARGV 全 UTF-8，让 perl 默认按 UTF-8 读 ARGV 文件（中文 literal 替换才生效）。`binmode(STDIN/STDOUT, ':utf8')` + `binmode(ARGV, ':utf8')` 在某些 perl 版本会报 "binmode on unopened filehandle ARGV"，用 `-CSD` flag 最稳
4. **macOS BSD grep 兼容** —— BSD grep 对 `^\+` 解析失败（即使 `-E` 也一样），验证逻辑用 `'^+'` 替代（BRE 里 `+` 是 literal char）
5. **idempotent** —— 已 clean 的 repo 跑完仍 0 PII（filter-branch "Ref unchanged" 是预期）

**dry-run 验证**（`/tmp/pii-clean-dryrun-60211`）：
- 6 类真 PII literal（公司名 / 邮箱 / 手机 / 身份证 / 银行卡 / 人名）→ 全部替换成占位值
- 4 维度验证：✅ 0 命中（reachable commit msg / reachable file diff / pack files / working tree）
- idempotent：再跑 2 次仍 0 命中
- **未在主 repo 上跑**（保留 `.git.bak.pre-clean-*` 备份策略，仅 dry-run 验证）

**前置**：必须未 push 到远端（脚本自动 `cp -r .git → .git.bak.pre-clean-<ts>`，验证通过后 `rm -rf .git.bak.pre-clean-*`）。

### 7.4 当前状态（2026-07-29 commit 60969de 后）

- ✅ 4 结构性 fix 已落地：
  - pre-commit hook（file content 含 PII 拦截）
  - pre-commit hook 不豁免 `__tests__/`
  - commit-msg hook（commit message 含 PII 拦截）
  - bin/pii-clean.sh（事后清理一键脚本）
- ✅ 476 tests pass / 3 skip / 0 fail（12 个新增 commit-msg contract 测试）
- ✅ tsc clean / eslint 0 errors（4 pre-existing warnings）
- ✅ 4 维度 PII 验证：
  - (1) reachable commit messages: **0**（关键修复：85115f1 自身 message 含 4 个 PII literal，已 amend）
  - (2) file content diff: **3**（全是 4 类 probe fixture 占位符，详见 §3 + §7.5，**预期保留**）
  - (3) .git/objects/pack: **0**
  - (4) working tree: **0**
- main head: `efa2506`（amend + rebase 后）→ `aae8325` → `cd02845` → `e899d36`
- **未 push 到任何远端**

### 7.5 关键修复记录：85115f1 自身含 PII literal 的 amend

**事件**：`cd02845`（旧 `85115f1`）的 commit message body 写了真 PII literal 描述"曾发生的 PII 泄露"：
```
- 27 处 PII 字符串藏在 commit message 里（REDACTED-co-x4 / REDACTED-person / REDACTED-phone 等）
```
4 个真字面（公司/公司/人名/手机号）进了 git history（详见 §3 PII 替换映射）。

**讽刺**：装 hook 的 commit 自己被 PII literal 污染了。原因：commit-msg hook 跟 commit 85115f1 一起 commit 进去，hook 装的时刻晚于 commit。

**修法**：amend `85115f1` message → 新 hash `cd02845`，把 4 个真字面替换成"REDACTED-co-x4 / REDACTED-person / REDACTED-phone 等"。然后 rebase 后续 2 个 commit（60969de → aae8325，4eee6af → efa2506）到新 `cd02845` 上。

**为什么不用 `bin/pii-clean.sh` 跑全清**：pattern file `/tmp/pii-patterns.txt` 26 个 PII literal 里含 4 类 probe fixture 占位符（具体字面见 §3 映射表的"占位符"列），tree-filter 跑会把这些 fixture 字面也清掉 → 测试断。amend + rebase 只改 commit message，不动 file content，最干净。

**教训（必须写入 MEMORY §6 防再犯）**：
- **结构性 fix 装 hook 的 commit 自己也要遵守契约**——装 hook 的 commit message 应该用占位符描述示例，不能写真 PII literal
- **不要在 commit message / 文档里写真值作"反例"**——即使是描述"曾经犯的错误"，字面字符串仍然会进 git history
- **amend + rebase vs filter-branch**：只改 commit message 时，amend + rebase 更轻量（filter-branch 会建 refs/original/ 备份 + 改 hash 链）
