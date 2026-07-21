# 更新日志

所有 notable 变更记录在此文件。格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)。

## [Unreleased]

### 计划中
- Tauri 桌面应用打包（让用户离线运行，无需 VPN）
- Gitee Pages 镜像（大陆法务用户直连）

## [1.0.0] - 2026-07-21

### 已验证
- 393 个测试全部通过（vitest，38 个测试文件）
- TypeScript 编译 0 错误（`tsc --noEmit` clean）
- ESLint 0 错误（4 个 useCallback warning pre-existing）
- 生产构建 3.23s 完成
- 真合同 docx 端到端 round-trip：header / footer / 表格 / 样式 / 媒体（图片）全部 byte-perfect 保留

### 已支持 13 类敏感信息识别

| 类型 | 例子 |
|---|---|
| `PHONE` | 13812345678 / 01000000000 |
| `ID_CARD` | 18 位居民身份证 |
| `EMAIL` | foo@bar.com |
| `TAX_ID` | 纳税人识别号 / 统一社会信用代码 |
| `BANK_CARD` | 16-21 位银行卡 / 外币账户 |
| `COMPANY` | 公司名（基于上下文识别，非纯字典） |
| `NAME` | 中文姓名（启发式 + 上下文） |
| `ADDRESS` | 邮寄地址 |
| `AMOUNT` / `AMOUNT_UPPER` | 金额数字 / 大写金额 |
| `CONTRACT_NO` | 合同编号 |
| `PROJECT_NAME` | 项目名称 |
| `IP` | IP 地址 |

### 支持的文档格式

| 格式 | 读 | 写 |
|---|---|---|
| DOCX | ✅ mammoth | ✅ docx（保留 header/footer/样式/表格/图片） |
| PDF | ✅ pdfjs-dist | ✅ pdf-lib |
| XLSX | ✅ xlsx | ✅ xlsx |
| 图片 | ✅ tesseract.js（OCR）| — |
| TXT / MD | ✅ 原生 | ✅ 原生 |

### 隐私
- 100% 客户端处理，0 网络请求
- IndexedDB 本地持久化（dexie），不上传

### 测试覆盖
- 162 个 spec（132 ✅ 全覆盖 + 29 ⚠️ 部分 + 1 ❌ 缺失）
- 详见 `TEST_SPECIFICATION.md`

## [0.x] - 2026 早期

迭代期间共 61 个 commits、9 批实战合同 audit，详细 RCA 见 git log。
早期版本未单独发版。

---

**版本号约定**（遵循 [SemVer](https://semver.org/lang/zh-CN/)）：
- MAJOR：不兼容的 API 变更
- MINOR：向下兼容的功能新增
- PATCH：向下兼容的 bug 修复