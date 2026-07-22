# 项目概要 (Project Summary)

> **2026-07-22 大修**：移除 3 处过期内容 + 新增 PII 安全 + 测试覆盖章节。
> 上次更新 2026-04-22（3 个月前，已严重过期）。

## 项目背景

用于中文法务 / 合同的隐私信息处理工具：

- **隐私信息隐藏**（合同、报价单、简历外发前脱敏）
- **商业敏感信息处理**（客户名、合同金额、合作方代号）
- **生成公开版本文件**（内审 / 外发 / 招投标）
- **测试/训练数据准备**（脱敏后可用于 ML pipeline / 演示）
- **PII 零容忍**：所有真合同 / 真路径 / 真邮箱 / 真电话 / 真联系人字面字符串不得入 commit（pre-commit hook 拦截 17 类 pattern）

## 技术架构

- **位置**: `<本仓库根目录>`（仓库名 `document-redactor`）
- **技术栈**: React 18 + TypeScript 5（strict）+ Vite 5
- **状态管理**: Zustand 4
- **持久化**: IndexedDB (Dexie 3)
- **加密**: AES-GCM + PBKDF2（key 派生）
- **解析器**: mammoth（DOCX） / pdfjs-dist（PDF） / xlsx（Excel） / tesseract.js（OCR 图片）
- **测试工具链**: vitest 2 + ESLint 8 + jsdom（TypeScript strict，408 tests pass）

## 已实现功能

| 功能 | 状态 | 说明 |
|------|------|------|
| 多文件格式解析 | ✅ | PDF / DOCX / XLSX / 图片 (OCR) / TXT / MD |
| **13 类敏感信息识别** | ✅ | PHONE / ID_CARD / EMAIL / BANK_CARD / IP / AMOUNT / AMOUNT_UPPER / ADDRESS / CONTRACT_NO / PROJECT_NAME / COMPANY / NAME / TAX_ID + CUSTOM（手动添加）|
| **docx round-trip byte-perfect 保真** | ✅ | header / footer / 表格 / 样式 / 图片（媒体文件）全部 byte-perfect 保留（旧描述"只输出 .txt"已推翻，参见 `RealDocxRoundTripAudit.test.ts`）|
| 并排对比视图 | ✅ | 原文 / 脱敏结果左右对照，敏感词高亮 |
| 手动标记 | ✅ | 选中文字连续添加，一键搜索脱敏 |
| 脱敏恢复 | ✅ | 上传脱敏文件 + 密码还原（AES-GCM 解密 mapping table）|
| 同步滚动 | ✅ | 原文与脱敏结果面板同步滚动 |
| 点击切换选中 | ✅ | 原文高亮处点击可取消 / 选中脱敏 |
| **pre-commit PII 拦截** | ✅ | `scripts/check-pii.sh` 17 类 pattern + `scripts/` 豁免（trade-off 见 §PII 安全）|
| **filter-branch 历史清理** | ✅ | 2026-07-21（内容脱敏）+ 2026-07-22（author 脱敏）共 2 轮，全部 commit 0 PII |

### 测试覆盖

- **408 tests pass / 3 skip**（baseline 稳定 0 回归）
- **162 spec 覆盖表**（132 ✅ + 29 ⚠️ + 1 ❌ = 81.5% 覆盖）
- 详见 `TEST_SPECIFICATION.md`

## 设计决策（重要）

### 1. 数据存储
- 脱敏后的**文件内容不存储**，只在用户下载时生成（避免服务器风险）
- IndexedDB 只存储**映射表加密数据**（用于恢复，含 salt + iv）
- 用户必须在脱敏完成后立即下载文件

### 2. 页面功能划分
- **上传页面**（UploadPage）：处理文件 → 识别敏感词 → 脱敏 → 下载
- **恢复页面**（RestorePage）：上传脱敏文件 + 密码 → 恢复原始内容
- **文件 / 历史页面**：仅作记录管理（无下载功能，纯本地持久化）

### 3. 部署方式
- 纯前端静态应用，可部署到 Vercel / Netlify / GitHub Pages
- 数据完全存在用户本地浏览器，无服务器风险
- GitHub Pages URL：`https://spyxiaoyu.github.io/document-redactor`（待启用）

## PII 安全（2026-07-21 / 22 新增）

本项目处理真实合同 PII，**零容忍原则**：所有真合同名 / 真路径 / 真邮箱 / 真电话 / 真联系人字面字符串不得入 commit。

### 三层防护

| 层 | 机制 | 触发时机 |
|---|------|---------|
| **L1 工作树** | `scripts/check-pii.sh`（17 类 pattern）| `git commit` 时（pre-commit hook 自动跑）|
| **L2 历史改写** | `git filter-branch`（msg-filter + tree-filter + env-filter）| 手动触发，2 轮（2026-07-21 内容 / 2026-07-22 author）|
| **L3 文档脱敏** | `REDACTED` / `<PII category>` 占位符 | 写日志 / 描述文档时 |

### 17 类 PII pattern（见 `scripts/check-pii.sh`）

- 真路径（`<username path>` 任何出现，e.g. `/Users/<username>/...`）
- 真合同文件名 + 简称
- 真合同号（4 类）
- 真公司代号（14 家）
- 真邮箱（2 个域名）
- 真电话
- 真联系人

### scripts/ 豁免的 trade-off

`scripts/` 目录在 pre-commit 扫描中**豁免**——因为工具代码自身含 PATTERN 字面字符串 + probe fixture 含 6 类 PII。
- **收益**：工具代码不被自我拦截
- **代价**：未来 scripts/ 新增工具脚本若含真 PII 不被拦，靠 spy 人工 review 兜底

### 当前状态

- **0 PII 命中**（working tree + 76 commit history 双 clean）
- 详见 `PII_REWRITE_LOG.md`

## 用户偏好

- **语言**：中文界面为主，文档中英双语（GitHub 面向全球贡献者）
- **工具名称**：Data Masking Tool（界面显示名）/ document-redactor（仓库名）
- **部署意向**：GitHub Pages（待启用）+ 未来 Tauri 桌面应用打包（CHANGELOG 计划中）

## 敏感信息识别规则

文件：`src/rules/BuiltinRules.ts`

**已识别类型**（13 类 + CUSTOM）：
- `PHONE` — 11 位中国大陆手机号（含 +86 前缀）
- `ID_CARD` — 18 位身份证（末位 X/x）
- `EMAIL` — 标准 email 格式
- `BANK_CARD` — 16-19 位银行卡（含空格分隔）
- `IP` — IPv4 地址（0-255 边界）
- `AMOUNT` / `AMOUNT_UPPER` — 金额数字 / 大写金额
- `ADDRESS` — 中文地址（省市区 + 路楼号）
- `CONTRACT_NO` — 合同编号
- `PROJECT_NAME` — 项目名称
- `COMPANY` — 公司名称（基于上下文识别，非纯字典）
- `NAME` — 中文姓名（label 限定 + lookbehind）
- `TAX_ID` — 纳税人识别号（label 不消费，capture group 只取本体）
- `CUSTOM` — 手动添加（addManualMatch）

**地址识别**：支持直辖市、省份、市区街道门牌号
**公司名识别**：支持有限公司 / 集团 / 股份 / 科技 / 投资 / 实业 / 商贸 / 分 / 有限 后缀
**大写金额识别**：支持 "人民币伍拾肆万柒仟壹佰陆拾玖元捌角壹分" 格式
**银行卡识别**：支持带空格格式

## 快捷操作

```bash
# 启动开发服务器
cd <本仓库根目录> && npm run dev

# 构建生产版本
npm run build

# 跑全套测试
npm test                   # 408 vitest tests

# 手动 PII 扫描
npm run check:pii

# lint + type check
npm run lint
npx tsc --noEmit
```

## 相关文件路径

- 主页面：`src/pages/UploadPage.tsx`
- 恢复页面：`src/pages/RestorePage.tsx`
- 状态管理：`src/stores/fileStore.ts`
- 识别规则：`src/rules/BuiltinRules.ts`
- 敏感查找核心：`src/engines/SensitiveFinder.ts`
- 脱敏算法：`src/engines/Desensitizer.ts`
- 加密：`src/engines/CryptoManager.ts`
- 侧边栏：`src/components/layout/Sidebar.tsx`
- PII 拦截器：`scripts/check-pii.sh`
- pre-commit hook：`.git/hooks/pre-commit`

## 进阶文档

- [`README.md`](./README.md) — 用户面向的项目说明
- [`CHANGELOG.md`](./CHANGELOG.md) — 版本历史
- [`SECURITY.md`](./SECURITY.md) — 隐私保证 + 验证方法
- [`CONTRIBUTING.md`](./CONTRIBUTING.md) — 贡献指南（含测试先行铁律）
- [`PRE_FLIGHT_CHECK.md`](./PRE_FLIGHT_CHECK.md) — 11 章踩坑沉淀
- [`TEST_SPECIFICATION.md`](./TEST_SPECIFICATION.md) — 162 spec 覆盖表
- [`PII_REWRITE_LOG.md`](./PII_REWRITE_LOG.md) — filter-branch 历史改写全过程

---

*最后更新: 2026-07-22*
