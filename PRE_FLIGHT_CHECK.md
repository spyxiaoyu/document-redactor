# 🛫 PRE_FLIGHT_CHECK — 每次交付前的强制自检清单

> **任何一项 ❌ = 不允许报告完成。必须先修复再交付。**
>
> 这份清单来自 project `document-desensitizer` 所有已经踩过的坑（commit `0658bc1` → `0d0dcf2`），
> 每次新 bug 出现都要追加一条新检查项。**改完代码 ≠ 修完 bug**。

---

## 1. 渲染层 ↔ 数据层 invariant（最高频出错）

**历史 bug**：`1f9f93d` addManualMatch push 但不删老 match → 新 CUSTOM 与老 ADDRESS 重叠 → 永远不渲染

- [ ] 所有 push 到 `sensitiveMatches` 的代码路径都做了区间重叠检测 + 删老？
- [ ] `selectedMatches` 跟 `sensitiveMatches` 同步（删老 match id、加新 match id）？
- [ ] `buildHighlightParts` 的 SKIP overlap 假设还成立？**验证至少 1 个 match kind 渲染出来**（用 `buildHighlightParts(text, matches, selected, true)` 跑一次，断言 match parts 数量）。
- [ ] 拼接 invariant：`parts.map(p => p.text).join('') === rawText`（任何高亮逻辑改动后必跑）

**测试模板**：
```ts
const parts = buildHighlightParts(rawText, matches, selected, true);
expect(parts.filter(p => p.kind === 'match').length).toBeGreaterThan(0);
expect(parts.map(p => p.text).join('')).toBe(rawText);
```

---

## 2. cursor 推进模式 `lastEnd` 必须推进（**绝对不能忘**）

**历史 bug**：`ddcd883` `if (!isSelected) continue;` 跳过后 `lastEnd` 没推 → 字段重复 + 部分段消失

**心智模型**：用 `lastEnd` cursor 走字符串时，**任何 `continue / skip / break` 都要想清楚 lastEnd 走不走**。

- [ ] 所有 unselected match 推进 `lastEnd = match.end`（落到 if-else 外）？
- [ ] 所有 `if (match.start < lastEnd) continue;` 之前确认 lastEnd 已被前一个 match 推进过？
- [ ] 反模式 check：搜代码 `continue` 关键字，每个都查 lastEnd 推进

**正模式**：
```ts
for (const m of sorted) {
  if (m.start < lastEnd) continue;       // skip 重叠（lastEnd 已推过）
  if (m.start > lastEnd) push(text.slice(lastEnd, m.start));
  if (isSelected) push(match part);       // 或 push(text part) when unselected
  lastEnd = m.end;                         // ← 永远推进，移到 if-else 外
}
```

---

## 3. 跨环境 module resolution（**测试 pass ≠ 浏览器 pass**）

**历史 bug**：`1a09838` mammoth 浏览器只认 `arrayBuffer`，Node 测试只认 `buffer` → CI 全过，浏览器炸

- [ ] 浏览器源码 vs Node 测试 vs Vite 打包，这三个环境各自认什么字段？（查 package.json `browser` 字段）
- [ ] 跨环境 helper 同时传多个字段（`buffer` + `arrayBuffer` + `path`）？
- [ ] 涉及 unzip / DOM / crypto 的代码必须在真实浏览器跑一次（不要只信 vitest）

**检查方法**：
```bash
grep -A 20 '"browser"' node_modules/<pkg>/package.json   # 看有没有 browser 字段
```

---

## 4. OOXML 节点识别（**字符级精确**）

**历史 bug**：
- `023a174` `<w:t` 子串匹配误命中 `<w:tc>` / `<w:tcPr>` / `<w:tbl>` / `<w:tab/>` → 542 chars escaped XML 注入
- `de941af` scanNodes 不识别 `<w:br/>` → 软换行 `\n` 丢失 → maskedToken 找不到

- [ ] `scanNodes` / `extractTextNodes` 列出所有要识别的语义节点（`w:t` / `w:br` / `w:tab` / 段落结束 / 页结束）？
- [ ] 所有 `xml.indexOf('<w:t', pos)` 都用 `findWTextOpen` 字符级边界检查（`<w:t` 后第 5 个字符必须是 `>` / ` ` / `/` / `\t` / `\n`）？
- [ ] 跟 `mammoth.extractRawText` 输出语义对齐（每个输出字符都有对应节点，不能多不能少）？
- [ ] round-trip test：原始 docx → mammoth 提取 → baseline 字符数 === 脱敏后 mammoth 提取 → restored 字符数（允许 margin <= 5 chars）

**检查方法**：
```bash
# 任意 OOXML 改动后必跑
npx vitest run src/utils/__tests__/DocxRoundTrip.test.ts
```

---

## 5. case preservation（**搜啥 case ≠ 原文 case**）

**历史 bug**：`ce5d5dc` addManualMatch positions 模式 value = 用户输入 case → restore 把 "abc" 替换成 "ABC" 大小写错乱

- [ ] `addManualMatch` positions 模式 `value = rawText.slice(idx, idx + text.length)`？
- [ ] **不能**把用户输入 case 直接写到 `match.value`？
- [ ] 测试覆盖：用户搜 "ABC" 但原文 "abc" → match.value 必须是 "abc"？

**测试模板**：
```ts
it('case preservation', () => {
  const raw = 'aaa abc bbb';
  seedStore(raw, []);
  useFileStore.getState().addManualMatch('abc', [4]);
  expect(useFileStore.getState().sensitiveMatches[0].value).toBe('abc'); // 不是 'ABC'
});
```

---

## 6. 搜索 hit 与 match 边界（**4 个独立 bug 在同一区域**）

**历史 bug**（`947780a` + `ce5d5dc`）：
- Bug A: hit 完全在 match 内部 → mark 不渲染 → jump no-op
- Bug B: hit 跨 part 边界 → 后半段不渲染
- Bug C: 嵌套 mark.onClick 冒泡 → 误触 match 取消
- Bug D: 跨 part hit → ID 重复 → querySelector 拿到第一个

- [ ] `renderHighlightParts` 在 **match part** 内也切碎 hit（不是只在 text part 切）？
- [ ] 跨 part hit 用 **overlap 判定**（`h.start < partEnd && h.end > partStart`）？
- [ ] 嵌套 mark.onClick 加 `e.stopPropagation()`？
- [ ] 跨 part hit ID 用复合格式（`search-hit-{index}-s{partIdx}-{hitIdx}`）+ `data-search-hit="N"` 属性（不用 id 定位，用 data 属性）？
- [ ] `handleJumpToSearchHit` 用 `[data-search-hit="N"]` querySelectorAll + first 定位？

**测试覆盖**（`src/utils/__tests__/searchRender.test.ts`，8 个）：
```bash
npx vitest run src/utils/__tests__/searchRender.test.ts
```

---

## 7. 状态清理（**三层清零**）

**历史 bug**：`ce5d5dc` 切文件不清 searchHits/searchKeyword → 旧 hit 渲染新文件 → 用户误加 match

- [ ] `handleFileSelect` / `setFile` / 文件 drop 时清 searchHits / searchKeyword / 预览状态？
- [ ] 搜索 input onChange 时也清 searchHits（label 显示新词但 hits 还是旧的 → 不一致）？
- [ ] `useEffect` cleanup 函数做了吗（unmount 时清 timer / listener）？
- [ ] `reset()` 函数清所有 transient state（searchHits / keyword / preview / renderKey）？

---

## 8. 测试自身 setup 漏洞（**mock data 必须跟生产一致**）

**历史 bug**：`0d0dcf2` 测试中 `text4='SAMPLE-CO-F文化'`（7 chars）但 `match.end=8` → visibleHits filter 把 hit[6,8) 过滤掉 → 测试 fail 暴露 mock 漏洞

- [ ] mock data 的 length 跟实际生产 data 对齐？
- [ ] `text.length === match.end - match.start === match.value.length`？
- [ ] 所有 `hit.start` / `hit.end` 都在 `[0, text.length]` 范围内？
- [ ] mock function 跑出来的 slices 拼接后 === 原文（invariant）？

**检查方法**：
```ts
const slices = slicePartsForSearchHits(text, matches, selected, hits);
expect(slices.map(s => s.text).join('')).toBe(text);  // invariant 必跑
```

---

## 9. 错误归因纪律（**RCA before fix**）

**纪律**：
- [ ] 每个 bug 都做了 **RCA 根因分析**（不是"症状是什么"是"为什么会出这个症状"）？
- [ ] **修法前**写能重现的测试？（先 red 后 green）
- [ ] 修复后跑了 **回归测试**（已有 + 新加）？
- [ ] 用工具**验证过假设**（不是猜、不是"可能是环境问题"）？

**反模式**（立即触发 L2 灵魂拷问）：
- "可能是环境问题" → 你验证了吗？
- "API 不支持" → 你读了官方文档吗？
- "已尝试所有方法" → 列出完整清单，少于 3 种 = 没穷尽

---

## 10. 交付纪律（**数据闭环**）

- [ ] `npm run build` clean（TS 0 errors）？
- [ ] `npx vitest run` 全过（必须跑全套，不能只跑改动的文件）？
- [ ] `npx eslint` 0 errors？
- [ ] 验证命令的**输出证据贴出来**（不是"应该过了"）？
- [ ] 如果是 bug 修复：commit message 必须含**复现步骤 + 根因 + 修法**？

**完整验证脚本**：
```bash
cd <repo-path>
npx vitest run 2>&1 | tail -10
echo "---"
npm run build 2>&1 | tail -10
echo "---"
npx eslint src --ext .ts,.tsx 2>&1 | tail -10
```

---

## 11. 新 bug 出现时（**沉淀到这份清单**）

每次新发现 bug 都要：
1. 写到这份清单对应 section（追加 case study）
2. 加一个回归测试到对应测试文件
3. 更新 MEMORY.md 的 commit 表
4. **绝对不删除**之前的检查项——历史 bug 永远可能复现

### §11.1 Zero-width 死循环防护（commit `7e9fdf8` 根治）

**历史 bug**：SensitiveFinder.addKeywords(['']) 触发 V8 OOM
- 根因：`indexOf('', index)` 永远返回 `index`（空串匹配每个位置），循环里 `lastIndex + keyword.length === lastIndex` → 死循环
- 影响：用户传空 keyword → 浏览器 OOM → 整个 app 崩

**修法**：addKeywords 入口过滤 `k.length > 0`，永不进入循环

**检查方法**：
- [ ] 任何 regex loop（`while (pattern.exec(text))`、`while (text.indexOf(...) !== -1)`）都要考虑 zero-width pattern / 空 keyword
- [ ] addKeywords / addRule 等 set 操作入口必须过滤空 pattern
- [ ] 用空 keyword / zero-width regex 跑一遍 findSensitiveContent，断言 < 1s 返回 + 不 OOM

**新测试**：`src/engines/__tests__/SensitiveFinderCritical.test.ts` → `SPEC-A2-07: 关键词步长 ≥ 1（zero-width 死循环防护）`

---

### §11.2 批量搜索脱敏必须过滤重叠 hit（commit `e0e16a6` 根治）

**历史 bug**：spy 现场报告——一键搜索词语批量脱敏时，如果新搜索关键词落在已选中的大范围 match 内部（比如已选 17 字 COMPANY "北京示例科技有限公司"，又搜 "示例" 一键脱敏），addManualMatch 的"重叠替换"逻辑（commit `1f9f93d` 修的渲染 bug）会把 17 字 match 替换成 4 字 CUSTOM，导致**脱敏范围变小、用户得手动重选**。

- 根因：`addManualMatch` 的"重叠替换"语义对**单调用**是对的（用户主动覆盖意图），但对**批量场景**错——批量场景下"已选中的 match 永远比新搜索 hit 更优先"，因为：
  1. 用户没主动取消选中 → 旧 match 还在 selectedMatches
  2. 新搜索 hit 通常是无意识的"我搜这个词看看有哪些" → 覆盖意图弱
  3. 替换会让用户的"我以为它还在"被打破 → 反直觉

- 影响：脱敏范围从 17 字 → 4 字，用户得手动重新选中 → UX 崩溃

**修法**：
1. 加 `filterHitsByExistingMatches<H, M>(hits, existingMatches): hits` 纯函数（src/utils/string.ts）
2. UploadPage `handleAddAllSearchHits` + `handleAddCheckedSearchHits` 在调 addManualMatch 前先过滤
3. toast 显示"已添加 N 处（K 处已在范围内，已跳过）"让用户知道
4. **addManualMatch 自身语义不变**（单调用仍走"重叠替换"），因为那是用户主动覆盖意图

**检查方法**（任何"批量 addManualMatch"代码路径）：
- [ ] 批量调用 addManualMatch 前，是否过滤掉与已选 match 重叠的 hit？
- [ ] 跳过的 hit 是否在 toast 里告诉用户跳过了多少？
- [ ] addManualMatch 单调用语义没被改？（单调用仍走"重叠替换"，因为那是用户主动覆盖意图）

**新测试**：`src/utils/__tests__/utilsCore.test.ts` → `filterHitsByExistingMatches` 10 测试（spy 截图回归 + 完全包含 / 部分重叠 / 边界相切 / 空数组 / 顺序保留）

**心智模型**：
- addManualMatch 单调用 = 用户说"我就要这个，旧的不要了"→ 重叠替换 OK
- 批量搜索脱敏 = 用户说"把这些都加上"→ 但没说"覆盖已选中的" → 已选中优先，跳过重叠 hit

---

### §11.3 OOXML 段落级 sibling 元素必须保留（commit `8494c34` 根治）

**历史 bug**：spy 真实 docx（SAMPLE-CO-Z合同，"SAMPLE-CO-F" 18 字跨 3 个 `<w:r>` 中间夹 2 个 `<w:proofErr/>`）走 B 方案 mask→restore 后下载，**提行不连贯、影响阅读**。

- 根因：`mergeRunsForCoverage` 把 [runStart, runEnd) 区间内的所有内容替换成单个新 `<w:r>`。但 `<w:proofErr/>`、`<w:bookmarkStart/>`、`<w:bookmarkEnd/>` 等**不是** `<w:r>` 的子元素，是 `<w:p>` 的直接子元素（OOXML schema 硬性要求）。原实现一并吞掉 → Word/WPS 重新分词时把"run 边界突变 + proofErr 消失"理解为重新换行点
- 影响：脱敏后 docx 视觉段落错乱（line break 错位），spy 截图显示合同正文行间距完全错乱

**修法**：
1. 抽 `extractSiblingElementsFromRuns(content)` — 扫描 content 跳过每个 `<w:r>...</w:r>` 块，收集中间的 raw XML（sibling 元素）
2. 抽 `findRunOpenInString(content, from)` — 字符级精确识别 `<w:r>` 起始，排除 `<w:rPr/>` / `<w:rFonts>` 等以 `<w:r` 开头但不是 `<w:r>` 的标签
3. mergeRunsForCoverage 拼回：`保留的 siblings` + `新的 merged run`

**检查清单**（任何"修改 [runStart, runEnd) 区间"的代码）：
- [ ] 区间内非 `<w:r>` 的 sibling 元素（`<w:proofErr/>`、`<w:bookmarkStart/>`、`<w:hyperlink>` 等）是否被提取保留？
- [ ] OOXML schema 验证：`<w:p>` 直接子元素只允许 `<w:r>` / `<w:hyperlink>` / 段落级 sibling — 把 sibling 塞进 `<w:r>` 是**非法** XML
- [ ] 跑真实 spy docx（SAMPLE-CO-Z 50KB）走 mask→restore 后，mammoth 提取对比 paragraph 数 + line break 数

**新测试**：`src/utils/__tests__/FormatPreservationRegression.test.ts` 3 断言（`<w:proofErr>` 保留 / mammoth delta / mammoth 可解析）+ 视觉对比段落结构

**心智模型**：
- OOXML 段落 = `<w:p>` 树，children 可以是 `<w:r>`（run）、`<w:hyperlink>`（链接）、`<w:proofErr/>`（校对错误标记）、`<w:bookmarkStart/>` / `<w:bookmarkEnd/>`（书签）、`<w:commentRangeStart/>` / `<w:commentRangeEnd/>`（批注范围）
- 任何"对一段连续 run 做合并/替换"的代码都必须**显式处理 sibling** —— 不是优化，是结构正确性要求

---

## 📋 一句话口诀

> **改完跑测试，跑了看输出，输出贴出来，贴完才能说 done。**
>
> 说 "应该过了" = 没跑。说 "可能没问题" = 没验证。说 "差不多" = 不达标。

---

**当前最新检查项**：`8494c34` 暴露的"OOXML 段落级 sibling 元素被吞"已纳入 §11.3。
下次新 bug 出现 → 追加 section → 永远不让历史重演。