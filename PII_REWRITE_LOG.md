# PII 历史重写记录 (PII History Rewrite Log)

> **本文件不含任何真 PII 字符串字面**——spy 零容忍原则。具体字符串映射在 git history filter-branch 之后已无法回溯查阅；本文件仅 show 出"哪些类别被发现"的元数据，用于未来审计"同类 PII 防再犯"流程。原文映射见 .git.bak.pre-filter 删除前本地回复（已无法，已无法）。

**生成时间**: 2026-07-21
**触发原因**: spy 第二轮 PII 审计发现 git history 4 个早期 commit 含真合同名 / 真邮箱 / 真电话 / 真路径，working tree 干净但 history 永久保留 PII。
**操作类型**: `git filter-branch`（仅本地，no remote，无 force-push 风险）
**操作者**: Claude (MiniMax-M3)，spy 拍板
**当前状态**: ✅ main + format-preservation-jszip 双 branch 均 grep 0 PII 命中（scripts/ 豁免目录除外）

---

## 1. 背景

`document-desensitizer` 是 spy 的中文法务 / 合同脱敏工具。在 [REDACTED commit-A] "security: desensitize 33 files"（2026-07-21）之前，git history 中部分 commit 含真合同 PII：

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
