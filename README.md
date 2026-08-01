# 文档脱敏工具（document-redactor）

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](./LICENSE)
[![Tests](https://img.shields.io/badge/tests-563%20passing-brightgreen)](./TEST_SPECIFICATION.md)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)](https://www.typescriptlang.org/)
[![Privacy](https://img.shields.io/badge/privacy-100%25%20client--side-success)](./SECURITY.md)

**100% 在你浏览器里跑的合同脱敏工具 —— 文件不出本机、加密可逆、支持 6 种文档格式。**

> 🔒 **核心承诺**：你的文件全程在你电脑里，不上传任何服务器。详见 [SECURITY.md](./SECURITY.md)。

## 适合谁

- **法务**：外发合同 / 报价单前脱敏（客户名 / 金额 / 合同号 / 公司名）
- **HR / 招聘**：发简历前脱敏（身份证 / 手机号 / 邮箱 / 银行卡）
- **销售 / BD**：客户敏感信息内部归档，跨部门传阅
- **数据团队**：脱敏后用作 ML 训练 / 演示数据

## 解决什么痛点

| 痛点 | 传统方案 | 本工具 |
|---|---|---|
| 在线脱敏网站 = 把合同上传 = **泄露风险** | 在线 SaaS | 100% 浏览器本地运行，文件不出本机 |
| 脱敏后无法还原（外发后内部归档丢原始信息）| 不可逆 | 加密映射表 + 密码，docx 自带元数据可还原 |
| docx 导出丢格式 / 丢图片 / 丢表格 | 在线工具 | byte-perfect 保真（header / footer / 样式 / 图片全保）|
| 商业 DLP 软件贵 + 部署复杂 | 企业 DLP | 浏览器打开就用，零安装 |
| 图片里的敏感信息（身份证照片）抓不到 | 手工 OCR | tesseract.js 本地 OCR 自动识别 |

---

## 亮点速览

- 🔒 **零上传** — 文件不出你的电脑，断网照样用
- 🔄 **可逆** — 加密映射表 + 密码一键还原（docx 自带加密元数据，主路径不依赖文件名）
- 📄 **真保真** — docx 表格 / 图片 / 样式 byte-perfect 保留，不是 OCR 重排
- 🔍 **13 类敏感识别** — 手机号 / 身份证 / 银行卡 / 邮箱 / 税号 / 公司名 / 合同号 / 金额 / IP / 地址 / 项目名 / 姓名 / 固话
- 🖼️ **OCR 图片** — tesseract.js 本地 wasm，识别图里的敏感信息（截图、扫描件）
- 🆓 **零依赖** — 无后端、无数据库、无需账号；纯前端单页应用
- 🌐 **离线可用** — 第一次加载后断网完整运行，无任何 telemetry

## 核心特性

| 特性 | 说明 |
|---|---|
| ✅ **13 类敏感识别** | 手机号 / 固话 / 身份证 / 邮箱 / 银行卡 / 税号 / 公司名 / 姓名 / 地址 / 金额 / 合同号 / 项目名 / IP |
| ✅ **6 种文档格式** | DOCX / PDF / Excel / 图片 OCR / TXT / MD |
| ✅ **docx round-trip 保真** | header / footer / 表格 / 样式 / 图片 byte-perfect 保留 |
| ✅ **脱敏 ↔ 还原双向** | maskedToken（`[TYPE_NNNN]`）双向映射 |
| ✅ **OCR 图片识别** | tesseract.js 本地 wasm，识别图中敏感信息 |
| ✅ **588 单元测试** | 含 9 批真合同 audit 防回归（badge 同步） |
| ✅ **离线可用** | 断网完整运行，无后端调用 |

## 快速开始

> 三种用法按"上手难度"从低到高排列 —— **普通用户只用看方案一**。

---

### 方案一：直接用（推荐，30 秒上手）

**适合谁**：只想用这个工具，不想折腾任何安装。

**操作步骤**：

1. 打开电脑上的浏览器（Chrome / Edge / Safari 都行，**避免用 IE**）
2. 在浏览器地址栏输入（或直接点这个链接）：
   ```
   https://spyxiaoyu.github.io/document-redactor
   ```
3. 看到首页就算成功 —— 直接上传文件就能用

**常见问题**：

| 问题 | 原因 + 解决 |
|---|---|
| 页面打不开 / 404 | Pages 还在部署（push 后要等 1-2 分钟），刷新重试 |
| 上传后没反应 | 浏览器太旧，升级到最新版（Chrome 90+ / Safari 14+） |
| 关掉浏览器记录就丢了 | 你用了无痕模式（Incognito），关掉它 |
| 工具提示"Persistence: blocked" | 当前域名没 HTTPS 或不是 localhost，方案一不存在这个问题 |

---

### 方案二：在自己电脑跑（适合想改代码的开发者）

**适合谁**：程序员 / 想二次开发 / 想离线用。

**准备工作（第一次用才做，之后跳过）**：

1. **装 Node.js**（运行工具的"发动机"）
   - 打开 https://nodejs.org/
   - 点绿色 **LTS** 按钮下载（约 30MB）
   - 双击安装包，一路点"继续 / 下一步"
   - 验证：打开"终端"输入 `node -v`，看到版本号（如 `v20.10.0`）就成功

2. **装 git**（下载代码的工具）
   - macOS：自带，无需装（终端输入 `git --version` 验证）
   - Windows：打开 https://git-scm.com/ 下载安装

3. **打开"终端"**
   - macOS：按 `Cmd + 空格` → 输入"终端" → 回车
   - Windows：开始菜单 → 搜"cmd" → 回车

**下载并启动**：

4. 在终端粘贴下面整段命令，**每行粘贴完按回车**：
   ```bash
   git clone https://github.com/spyxiaoyu/document-redactor
   cd document-redactor
   npm install
   npm run dev
   ```
   每行作用：
   - `git clone ...`：从 GitHub 下载代码到你电脑
   - `cd document-redactor`：进入刚下载的文件夹
   - `npm install`：下载工具需要的依赖（100MB 左右，**等 1-3 分钟**，第一次才慢）
   - `npm run dev`：启动本地预览服务（**别关这个窗口**，关了就停了）

5. 看到类似这样的输出就成功了：
   ```
   VITE v5.1.4  ready in 543 ms
   ➜  Local:   http://localhost:5173/
   ```
6. 浏览器**自动**打开 `http://localhost:5173`，看到首页即成功

**改完代码想看效果？** 文件保存后浏览器自动刷新，不用重启。

**想停掉？** 在终端按 `Ctrl + C`。

---

### 方案三：自部署给别人用（适合懂一点技术）

**适合谁**：想部署到公司内网 / 自己服务器 / 不放心用第三方 Pages。

**步骤 1-3 同方案二**（装 Node.js、git、打开终端）

**下载并构建**：

4. 在终端粘贴：
   ```bash
   git clone https://github.com/spyxiaoyu/document-redactor
   cd document-redactor
   npm install
   npm run build
   ```
   `npm run build` 会生成 `dist/` 文件夹 —— **这就是你要部署的全部内容**（纯静态文件，无后端）。

**挑一个静态服务器启动**（三选一，按需）：

| 方案 | 命令 | 适用场景 |
|---|---|---|
| **A. Python**（推荐，macOS/Linux 自带） | `cd dist`<br>`python3 -m http.server 8080` | 不想装任何东西 |
| **B. npx serve**（需 Node.js） | `cd dist`<br>`npx serve -l 8080` | Windows 上没 Python |
| **C. npx http-server**（需 Node.js） | `cd dist`<br>`npx http-server -p 8080` | B 装不上时的备胎 |

**访问**：

5. 看到 "Serving HTTP on ... port 8080" 类似输出后
6. 浏览器打开 `http://localhost:8080` 就能用

**部署到真实服务器**：把 `dist/` 整个文件夹上传到任何静态托管（nginx / Apache / Caddy / 阿里云 OSS / 腾讯云 COS）。**不需要在服务器上装 Node.js**。

---

⚠️ **重要提示**：

- 浏览器规定：**HTTPS 域名** 或 **`localhost`** 才能存历史记录（IndexedDB 限制）
- 方案一/二/三本地打开都是 `localhost`，没事 ✅
- 方案三部署到**公网 HTTP 域名**（比如 `http://desensitizer.mycompany.com`）→ 历史记录存不上，每次刷新都丢
- 解决：部署时配 HTTPS（nginx + Let's Encrypt 免费证书 / 阿里云免费证书），或者直接用 GitHub Pages（自带 HTTPS）

## 使用流程

1. **上传文档** —— 拖入 / 点选需脱敏文档（PDF / Word / Excel / 图片 / TXT / MD）
2. **自动识别** —— 高亮标出敏感字段
   - 可手动增删：勾选字段即可添加，点击高亮即可取消（针对误识别）
   - **手动标记**：搜索关键词后批量勾选 → 一键添加为新敏感字段
3. **生成掩码** —— 敏感字段被替换为**等长下划线**（如手机号 11 位 → `__________`）（受限于技术原因，下载后的脱敏文档中下划线后可能存在一部分空白字段）
4. **设置密码** —— 首次脱敏时弹出密码框（≥6 位 + 二次确认）
   - ⚠️ **请牢记此密码**，丢失无法找回
   - 密码**只保护映射表的加密**，不写入脱敏文件本身
5. **下载导出** —— 下载脱敏后的文件（docx / pdf / xlsx / txt）
   - **docx 内嵌加密映射表**（`docProps/desensitizer.xml`）—— 你可以把脱敏 docx + 密码**直接发给同事**，对方无需你的浏览器就能还原
6. **恢复** —— 回到"恢复"页：上传脱敏文件 + 输入密码 → 一键还原原值

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