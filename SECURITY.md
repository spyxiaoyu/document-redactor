# 安全与隐私声明

> 文档脱敏工具的核心承诺：**你的文件不出你的电脑**。

## 我们不收集什么

本项目**不会**、**没有能力**、**也不打算**收集以下任何信息：

- ❌ 你的文件内容（合同、文档、表格、图片）
- ❌ 你的文件名
- ❌ 你的识别出的敏感数据（手机号、身份证、银行卡号、公司名等）
- ❌ 任何遥测（telemetry）、分析、追踪
- ❌ 任何形式的网络上传

## 文件如何处理

| 阶段 | 位置 |
|---|---|
| 上传 / 选择文件 | 你的浏览器本地（`<input type="file">`） |
| 解析（mammoth / pdfjs / xlsx） | 浏览器内存 |
| 规则匹配（regex + 中文 NLP） | 浏览器内存 |
| 生成脱敏文档（docx / pdf / xlsx writer） | 浏览器内存 → 浏览器下载 |
| 持久化（IndexedDB，dexie） | 你电脑本地（不联网） |

**整个流程没有后端服务器、没有云端 API、没有第三方 SaaS 调用**。你断网也能完整使用。

## 验证方式

不需要信我，你可以验证：

1. 打开浏览器 DevTools → Network 标签 → 上传并脱敏一份文档
2. 你会看到：**0 个网络请求**（除加载静态资源外）
3. 在 Sources 标签搜 `fetch` / `XMLHttpRequest` / `axios` — 业务代码**零调用**

或者更彻底：

```bash
git clone https://github.com/<user>/document-desensitizer
cd document-desensitizer
grep -r "fetch\|axios\|XMLHttpRequest" src/   # 应该只命中 IndexedDB wrapper
```

## 已知第三方依赖（均纯前端、无后端）

| 库 | 用途 | 隐私风险 |
|---|---|---|
| mammoth | DOCX 解析 | 无，纯前端 |
| pdfjs-dist | PDF 渲染 | 无，纯前端 |
| xlsx | Excel 解析/写入 | 无，纯前端 |
| tesseract.js | 图片 OCR | 无，纯前端，wasm 本地跑 |
| dexie | IndexedDB 包装 | 无，纯本地 |

所有依赖均为**客户端 JavaScript 库**，不发起任何网络请求到作者服务器。

## 报告漏洞

发现安全问题请发邮件给项目维护者（GitHub profile 上找），**不要**在公开 issue 里贴 PoC。

## 免责声明

本工具按"原样"提供，不对脱敏结果的完整性、合规性做任何保证。
**关键合同建议**：脱敏后请人工核对，确认无敏感信息残留后再外发。
工具是辅助，**人工最终核对是法律合规的硬底线**。