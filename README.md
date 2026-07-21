# 文档脱敏工具

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-393%20passing-brightgreen)](./TEST_SPECIFICATION.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Privacy](https://img.shields.io/badge/privacy-100%25%20client--side-success)](./SECURITY.md)

**浏览器内运行的文档脱敏与还原工具** —— DOCX / PDF / Excel / 图片 OCR / TXT / MD。

> 🔒 **核心承诺**：你的文件不出你的电脑。详见 [SECURITY.md](./SECURITY.md)。

---

## 它解决什么问题

法务、销售、HR 在外发合同 / 报价单 / 简历时需要：
- 抹掉客户姓名、手机号、身份证、银行卡号、公司名、合同金额……
- 抹掉后还要能**还原**（内部归档需要）
- 不能把敏感文件传上任何云端（合规要求）

传统方案：在线脱敏网站 = 把合同上传 = **泄露风险**。
本工具：**100% 在你的浏览器里跑**，合同不出本机。

## 核心特性

| 特性 | 说明 |
|---|---|
| ✅ **13 类敏感识别** | 手机号 / 固话 / 身份证 / 邮箱 / 银行卡 / 税号 / 公司名 / 姓名 / 地址 / 金额 / 合同号 / 项目名 / IP |
| ✅ **6 种文档格式** | DOCX / PDF / Excel / 图片 OCR / TXT / MD |
| ✅ **docx round-trip 保真** | header / footer / 表格 / 样式 / 图片 byte-perfect 保留 |
| ✅ **脱敏 ↔ 还原双向** | maskedToken（`[TYPE_NNNN]`）双向映射 |
| ✅ **OCR 图片识别** | tesseract.js 本地 wasm，识别图中敏感信息 |
| ✅ **393 单元测试** | 含 9 批真合同 audit 防回归 |
| ✅ **离线可用** | 断网完整运行，无后端调用 |

## 快速开始

### 在线试用

> 🚧 GitHub Pages 部署中。访问 `https://<user>.github.io/document-desensitizer` （首次启用 Pages 后生效）。

### 本地开发

```bash
git clone https://github.com/<user>/document-desensitizer
cd document-desensitizer
npm install
npm run dev          # 浏览器打开 http://localhost:5173
```

### 生产构建

```bash
npm run build        # 输出到 dist/
npm run preview      # 本地预览生产构建
```

## 使用流程

1. **上传文档** —— 拖入 / 点选文件
2. **自动识别** —— 高亮标出敏感字段（可手动增删）
3. **生成掩码** —— 一键替换为 `[PHONE_0001]` 形式
4. **导出** —— 下载脱敏后的 docx/pdf/xlsx
5. **还原** —— 用原始映射表（保留在本地 IndexedDB）一键还原

## 文档

- [SECURITY.md](./SECURITY.md) —— 隐私保证、技术验证方法
- [CHANGELOG.md](./CHANGELOG.md) —— 版本历史
- [TEST_SPECIFICATION.md](./TEST_SPECIFICATION.md) —— 162 个 spec 的覆盖表（132/162 = 81.5%）

## 架构

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
```

**关键技术**：
- **恢复算法**：`Desensitizer.restore` 两趟替换，处理交叉 originalValue / maskedToken 命中（无 searchPos 漂移）
- **docx 保真**：JSZip 直接改 `word/document.xml` 内联，不重建 XML → 表格/图片/样式零损失
- **规则权重**：`weight ∈ [0,1]`，配合 `mergeOverlappingValueAware` 处理重叠区间

## 开发命令

```bash
npm run dev        # Vite dev server + HMR
npm run build      # tsc --noEmit + vite build
npm run preview    # 预览生产构建
npm test           # 跑全部 vitest（393 个）
npm run test:watch # 监听模式
npm run lint       # ESLint
```

## 贡献

欢迎 issue 和 PR。提 PR 前请跑 `npm test` 确保全部通过。

**报告 FP（误识别）/ FN（漏识别）** 最有用 —— 请附上：
1. 触发文件（敏感字段脱敏后即可，不必传原文）
2. 期望行为 vs 实际行为
3. 出现位置（行号 / 段落）

## License

MIT © spy —— 详见 [LICENSE](./LICENSE)。

## 免责声明

本工具按"原样"提供。**关键合同请人工核对**后再外发 —— 工具是辅助，合规是底线。