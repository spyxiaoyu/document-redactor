# 贡献指南

> 感谢你愿意贡献！本项目的**最高优先级**是 **PII 零容忍**——任何包含真合同 / 真路径 / 真邮箱 / 真电话字面字符串的 commit 会被 pre-commit hook 自动拦截。

## 本地开发

```bash
git clone https://github.com/spyxiaoyu/document-redactor
cd document-redactor
npm install
npm run dev          # 浏览器打开 http://localhost:5173
```

### 推荐设置 pre-commit hook（强烈建议）

```bash
bash scripts/setup-hooks.sh
```

这会安装 `.git/hooks/pre-commit`，自动跑 `scripts/check-pii.sh` 拦截 12 类通用 PII 正则。

> ⚠️ 跳过机制：`SKIP_PII_CHECK=1 git commit ...` 仅用于紧急发版，**不应日常使用**。

## 本机增强拦截（可选）

`scripts/check-pii.sh` 默认只拦截 12 类通用 PII 正则（手机号/身份证/银行卡/邮箱/IPv4/合同号/大写金额/公司名后缀/姓名 label 限定/地址 label 限定/项目名 label 限定/TAX_ID label 限定）。

如果你想在本机额外拦截**特定公司字典**（如你自己行业的特定甲方/乙方代号）或**特定合同名前缀**，可以在用户主目录创建外挂字典文件：

```bash
mkdir -p ~/.pii-local
cat > ~/.pii-local/extra-patterns.txt << 'EOF'
# 每行一个 pattern（字面或正则）
# 例：拦截特定公司字典（替换为你的实际公司代号）
SAMPLE-COMPANY-A
SAMPLE-COMPANY-B
# 例：拦截特定合同名前缀
SAMPLE-PRIVATE-CT-
EOF
```

`scripts/check-pii.sh` 启动时会自动读取 `~/.pii-local/extra-patterns.txt`，每行追加为一个 PATTERN。文件不存在时静默跳过。

> **设计权衡**：通用正则 vs 个人字典
> - ✅ 通用正则：clone 仓库就能用，不依赖个人配置
> - ✅ 个人字典：本机专属拦截能力，不污染仓库
> - ⚠️ 个人字典不入仓库，clone 后默认只有通用拦截——这是有意设计，避免 spy 个人 PII 字面泄漏到公开仓库

## 跑测试

```bash
npm test              # 全套 vitest（当前 413+ 个测试）
npm run test:watch    # 监听模式
npm run lint          # ESLint
npm run build         # tsc + vite build（必须 0 errors）
npm run check:pii     # 手动跑 PII 扫描
```

**提 PR 前**必须三连全过：
```bash
npm test && npm run build && npm run lint
```

## 测试先行铁律（核心纪律）

本项目严格遵循 **CLAUDE.md §11 测试先行铁律**——任何 bug 修复或行为变更按以下顺序：

1. **写 probe 测试**（用真实数据 / spy 实战合同）→ 跑 RED 确认能复现
2. **跑全套 baseline**（`npm test`）记录当前测试数和 pass 数
3. **改代码**（最小必要范围，不 refactor）
4. **跑 probe 确认 GREEN**
5. **跑全套对比 baseline**（任何已有测试失败 = 改坏了，停下来排查）
6. **`npm run build` 必须 clean**

**禁止**：跳过 step 1 直接改代码 / 改完只跑自己写的测试 / 用"应该过了"代替跑命令。

## Commit message 规范

参考最近 commit 风格：

```
<type>: <subject>

<可选 body: 复现步骤 + 根因 + 修法 + 全套测试 delta>
```

| type | 用途 |
|------|------|
| `feat:` | 新功能 |
| `fix:` | bug 修复 |
| `test:` | 仅测试改动 |
| `docs:` | 仅文档改动 |
| `refactor:` | 重构（无行为变更）|
| `chore:` | 构建/工具/依赖 |

示例（参考 `f716231`）：
```
security: desensitize 33 files

- 替换 24 unique 真 PII 字符串为占位符（SAMPLE-CT-NNN / SAMPLE-CO-X / 张某某）
- pre-commit hook 增加 12 类通用 PII 正则
- scripts/ 目录豁免（工具代码自身含通用正则 PATTERN 字面）
```

## 报 FP / FN（最有价值的贡献）

发现误识别（FP）或漏识别（FN）请提 issue，附：

1. **触发文件**（**敏感字段脱敏后即可**，不必传原文——见下面"敏感字段提交规则"）
2. **期望行为 vs 实际行为**
3. **出现位置**（行号 / 段落）

### 敏感字段提交规则（**绝对红线**）

- ❌ **不要**把含真合同 / 真邮箱 / 真电话 / 真路径的原文粘贴到 issue / PR / commit message
- ✅ 把敏感字段脱敏为占位符（`[PHONE_0001]` / `[COMPANY_0001]`）再粘贴
- ✅ pre-commit hook 会自动拦——但 issue / PR 评论是 GitHub 上的，**不会被本地 hook 拦**，靠人工自觉

## 项目结构

```
src/
├── parsers/       # mammoth / pdfjs / xlsx / tesseract 解析
├── rules/         # 13 类敏感正则 + 启发式
├── engines/       # 核心算法（cursor-based desensitize + 两趟 restore）
├── utils/         # docxZipReader / docxZipWriter（保真 round-trip）
├── stores/        # zustand 状态管理
├── db/            # dexie / IndexedDB 持久化
├── components/    # React UI
└── pages/         # 路由页面

scripts/
├── check-pii.sh              # pre-commit PII 拦截器（12 类通用正则 + 本机外挂字典）
├── scan-pii.sh               # PII 扫描 wrapper（保护 shell history / scrollback）
├── setup-hooks.sh            # 安装 pre-commit hook
└── __tests__/                # check-pii.sh 的契约测试（17 个用例）

# scripts/__fixtures__/ 探针 fixture 已删除（通用化后不需要）
# 留 .gitkeep 保目录存在
```

## 进阶文档

- [`PRE_FLIGHT_CHECK.md`](./PRE_FLIGHT_CHECK.md) —— 11 章踩坑沉淀 + §11.1~11.3 历史 bug 复盘
- [`TEST_SPECIFICATION.md`](./TEST_SPECIFICATION.md) —— 162 个 spec 覆盖表（132/162 = 81.5%）
- [`SECURITY.md`](./SECURITY.md) —— 隐私保证 + 验证方法
- [`PII_REWRITE_LOG.md`](./PII_REWRITE_LOG.md) —— filter-branch 历史改写全过程（2026-07-21）

## License

MIT © spyxiaoyu —— 详见 [LICENSE](./LICENSE)。
