import type { Rule, SensitiveType } from '@/types';
import { generateUUID } from '@/utils';

export interface BuiltinRuleDefinition {
  type: SensitiveType;
  pattern: RegExp;
  weight: number;
  description: string;
}

export const BUILTIN_RULES: BuiltinRuleDefinition[] = [
  {
    type: 'PHONE',
    // v2 修复（spy audit batch #7 — fixture 固话 FN）：
    //   原 regex 只接 1[3-9]\d{9} 11 位手机号，桌面固话/服务热线（010/0XX-XXXXXXXX）全漏识别
    //   修法：top-level alternation 加固话格式 `0\d{2,4}[-.\s]?\d{7,8}`
    //     - 11 位 0 开头 → 11 chars ✅
    //     - 区号-号码 (4-7) → 12 chars（含 -） ✅
    //     - 区号-号码 (3-8) → 12 chars（含 -） ✅
    //   风险：低数字短串（如 "01012345" 8 chars）误吃 → 长度 ≥ 11 兜底
    pattern: /(\+?86[-.\s]?)?(?:1[3-9]\d{9}|0\d{2,4}[-.\s]?\d{7,8})/g,
    weight: 0.95,
    description: '中国大陆手机号/固话'
  },
  {
    type: 'ID_CARD',
    pattern: /[1-9]\d{5}(?:18|19|20)\d{2}(?:0[1-9]|1[0-2])(?:0[1-9]|[12]\d|3[01])\d{3}[\dXx]/g,
    weight: 0.98,
    description: '中国大陆居民身份证号码'
  },
  {
    type: 'EMAIL',
    pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    weight: 0.95,
    description: '电子邮箱地址'
  },
  {
    type: 'TAX_ID',
    // capture group 提取税号本体：[A-Z0-9]{15,20} 是 match[1]
    // SensitiveFinder.ts:69-72 会用 match[1] 作为 value，这样"纳税人识别号："作为 label 保留不脱敏
    //
    // v2 修复（spy 6-docx audit — fixture "纳税识别号：【18位USCC】" FP）：
    //   - 原 regex label alt 只有"纳税人识别号"（6 字），不匹配文档常用简写"纳税识别号"（5 字）
    //   - 即使 label 改对，`[:：]?\s*` 也不允许中文 `【】（）()` 作分隔符
    //     → BANK_CARD 抢匹配把 18 位税号当银行卡（脱敏语义错位）
    //   - 修法：
    //     1. label alt 加 "纳税识别号"（5 字 variant）
    //     2. label 和 capture group 之间允许 `[（(【]?\s*` / `\s*[)）]?` 中文括号分隔符
    //   - 规则位置从 list 末尾上移至 BANK_CARD 之前，使 TAX_ID 先入 matches array
    //     mergeOverlappingValueAware 同范围保留先入 → TAX_ID 优先于 BANK_CARD
    // v3 修复（spy audit batch #7 — fixture 合同反复出现的"统一社会信用代码：..." FP）：
    //   - 真合同最常用 label 是"统一社会信用代码"（9 字），原 regex 不收 → 18 位 USCC 漏识别
    //   - mammoth 拼接常丢尾部字母校验码（18 位 USCC 退化成 17 位纯数字）
    //     → 退化成 17 位纯数字被 BANK_CARD regex 抢匹配 → 错标税号身份为银行卡
    //   - 修法：label alt 加"统一社会信用代码"+ "统一社会信用代码编号"（11 字 full form）
    //     → TAX_ID 先入 matches array（规则位置在 BANK_CARD 前）→ 优先识别完整 18 位
    pattern: /(?:纳税人识别号|纳税识别号|税号|税务登记号|统一社会信用代码|统一社会信用代码编号|TIN)\s*[:：]?\s*[（(【]?\s*([A-Z0-9]{15,20})\s*[)）】]?/gi,
    weight: 0.92,
    description: '纳税人识别号'
  },
  {
    type: 'BANK_CARD',
    // v2 修复（spy 设备采购 docx FP）：
    //   原 regex `[1-9]\d{4}` 硬性拒绝前导 0，前导 0 的 19 位账号被截成 18 chars
    //   修法：[0-9]\d{4} 允许任意首位数字
    // v3 修复：支持 19 位银联卡（原 regex 限制 16-18 位）
    //   \d{3,5} → \d{3,6} 允许最后一组 3-6 位（总 16-19 位）
    // v4 修复（spy audit batch #7 — fixture 外币账号 21 位被截 19 位 FN）：
    //   真实合同外币账户（美元/欧元）21 位（regex 上限 19 位）→ 截 19 位丢失末尾 2 位
    //   （脱敏语义错位 — 标记 19 位 vs 实际 21 位）
    //   修法：\d{3,6} → \d{3,8} 允许最后一组 3-8 位（总 16-21 位）
    //   安全性：USCC 18 位纯数字 9[123] 开头 + 长度 20-21 形态几乎不存在（USCC 必有 18 位字母校验码）
    //   post-filter 不需要扩展 — USCC 形态仍是 17-19 字符检查
    //
    // 规则位置在 TAX_ID 之后：18 位纯数字既是"纳税识别号"又是潜在银行卡时，
    //   TAX_ID 先入 matches array，merge 同范围保留先入 → TAX_ID 优先
    //   → "纳税识别号：【18位USCC】" 正确识别为 TAX_ID（不会被 BANK_CARD 抢匹配）
    pattern: /[0-9]\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{3,8}/g,
    weight: 0.90,
    description: '银行卡号'
  },
  {
    type: 'BANK_ACCOUNT_LABEL',
    // 2026-07-26 spy 截图反馈：合同收款信息表格 "银行账号：15位数字" 没识别
    //   BANK_CARD regex 限 16-21 位纯数字，15 位落不进（部分对公账号、银行流水号都是 12-15 位）
    //   修法：label 限定 12-21 位数字（label 锚定 FP 风险低）
    //   label alt：银行账号 / 账号 / 账户 / 帐号 / 收款账号 / 付款账号
    //   数字范围 12-21 位（兼容对公账号 12-19 位常见形态）
    //   规则位置在 BANK_CARD 之后：16-21 位纯数字 BANK_CARD 先入 matches array → 合并时 BANK_CARD 优先
    //   → 真银行卡号不会被 BANK_ACCOUNT_LABEL 抢匹配
    pattern: /(?:银行账号|银行帐号|账号|帐号|账户|收款账号|付款账号|收款账户|付款账户)\s*[:：]?\s*([0-9]{12,21})/g,
    weight: 0.92,
    description: '银行账号(label 限定)'
  },
  {
    type: 'IP',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    weight: 0.85,
    description: 'IPv4地址'
  },
  {
    type: 'AMOUNT',
    pattern: /(?:(?:价格|金额|总计|合计|付款|收款|工资|月薪|年薪|费用|报价|人民币)[：:\s]*)\b\d+(?:[,，]\d{3})*(?:\.\d{1,2})?(?:\s*元)?|(?:¥|￥|\$|€|£|USD|CNY|RMB|HKD|JPY)\s*\d+(?:[,，]\d{3})*(?:\.\d{1,2})?(?:\s*(?:元|万|千|美元|欧元|英镑|港币|日圆))?/gi,
    weight: 0.80,
    description: '小写金额'
  },
  {
    type: 'AMOUNT_UPPER',
    // v2 修复（spy 设备采购 docx [452-457] FP）：
    //   原 regex "(?:万|亿|元|整)+" 只能消费 1 次，遇到 "】"（中文括号）切断
    //   "(大写：人民币【壹拾伍万陆仟肆佰肆拾】元整)" 被截成 "壹拾伍万陆" 5 chars
    //   v3 修复（贰元叁角伍分 → 贰元叁 + 伍 拆分 bug）：
    //     "(?:元[...]*)?[角分]*" 中 "(?:元[...]*)? greedy 吃掉了 "叁"（在主字符类里）
    //     → sub-unit (?:\d[角分])+ 拿不到叁角伍分
    //   修法：terminal marker alternation 二选一
    //     - 元 + 任意 digits + 0+ sub-units + 整?  （含元主形态）
    //     - 1+ sub-units（无元，仅 角分链）
    //   v4 修复（设备采购 [441-443] 】元 FP）：
    //     主字符类含 】 导致 "156,440.00】元" 中 单独的 "】元" 被识别为 AMOUNT_UPPER
    //     修法：】 只作 digit-group 分隔符，不进主字符类
    //     主类: [零壹贰叁...万亿]   分隔符: (?:[万亿】][digits]*)* （注意 * 不是 +）
    //     * 允许 "】元" 中 】 后直接接 元（0 digit）
    //     + 会要求 】 后必须有 digit，导致 "】元整" 跨不过去 → A1 反而 0 match
    //   v5 修复（6 docx audit — 节目丙 [538-540] "180万元" 只 match "万元" 2 chars）：
    //     修法：top-level alternation 加 Arabic digit 版本
    //       \d+(?:,\d{3})*(?:\.\d+)?[万亿]元?(?:[digit][角分])*(?:整)?
    //     覆盖 "180万元" / "180万" / "1.5万元" / "180,000元"
    //   v6 修复（spy 第五批 audit — 弱电改造 [907]/[977]/[1054]/[1103] 4 处 FP）：
    //     原 regex `[万亿】]` 作分隔符允许 `】` 出现在 amount 中段（如 "伍万壹仟玖佰】元整"）
    //     → 中段 `】` 是 docx 表格单元格残余括号，不是真金额的一部分
    //     修法：`】` 只允许紧贴 form `元` 之前（bracket-wrapped amount 场景），不允许作主分隔符
    //     新 regex：`[零壹...]+(?:[万亿][零壹...]*)*】?元(?:[零壹...]*[角分])*(?:整)?|...`
    //       - `】?` 直接放在 `元` 前（可选），允许 `壹拾伍万陆仟肆佰肆拾】元整` ✓（v4 保留 case）
    //       - 不允许 `伍万壹仟玖佰】元整` 中段 `】` 被吃进 ✓（v6 修 FP）
    pattern: /(?:人民币)?(?:\d+(?:,\d{3})*(?:\.\d+)?[万亿]元?(?:[零壹贰叁肆伍陆柒捌玖][角分])*(?:整)?|[零壹贰叁肆伍陆柒捌玖拾佰仟万亿]+(?:[万亿][零壹贰叁肆伍陆柒捌玖拾佰仟万亿]*)*】?元(?:[零壹贰叁肆伍陆柒捌玖拾佰仟万亿]*[角分])*(?:整)?|(?:[零壹贰叁肆伍陆柒捌玖][角分])+)/gi,
    weight: 0.92,
    description: '大写金额'
  },
  {
    type: 'ADDRESS',
    pattern: /(?:(?:北京|上海|天津|重庆|香港|澳门)(?:市|省|区)?|(?:[\u4e00-\u9fa5]{2,6}省))[\u4e00-\u9fa5]{2,10}(?:市|区|县|镇|乡|街道)[\u4e00-\u9fa5\d\s-]{6,80}(?:路|街|道|巷|弄|号|楼|室|单元|栋|层|座|大厦|花园|小区|公寓|广场|中心|城|馆|酒店|宾馆|医院|学校|银行)/g,
    weight: 0.75,
    description: '中文地址'
  },
  {
    type: 'CONTRACT_NO',
    pattern: /(?:合同(?:书)?号|Contract\s*(?:No\.?|Number)?)\s*[:：]?\s*([A-Z0-9]{6,24})/gi,
    weight: 0.90,
    description: '合同编号'
  },
  {
    type: 'PROJECT_NAME',
    pattern: /(?:项目(?:名|称|书)|Project\s*Name)\s*[:：]?\s*([\u4e00-\u9fa5A-Za-z0-9]{4,30})/gi,
    weight: 0.80,
    description: '项目名称'
  },
  {
    type: 'COMPANY',
    // alt A：完整型公司名（标准"X有限公司"等）
    // v2 修复（spy 截图反馈"公司名识别太贪婪"）：
    //   1. 左边界负向后顾 (?<![这那每该各某自己诸何之与和及或其的了在为于而则])
    //      → 防止 "委托北京甲集团公司"、"这家公司"、"A和B公司" 整段被左贪婪吞
    //   2. body {2,30}（最小 2 字、最多 30 字）→ 防止 "X公司" 单字字号 + 防止超长匹配
    //   3. 行业词 16 个 + 0-10 字缓冲（"融媒体科技文化" 这种）
    //
    // v4 拆分（spy 6-docx audit - fixture "X集团...及其关联公司" 回归）：
    //   - 原 regex `alt A | alt B` 单条 alternation，alt A greedy 抢匹配导致 alt B 没机会
    //     例 "合作方为阿里巴巴集团及其关联公司"：
    //       - alt A: 16 chars greedy (body=14 "合作方为阿里巴巴集团及其关联" + form="公司")
    //         → post-filter 拒（"及其"在 reject chars）
    //       - alt B 在 same alternation 中没机会跑（first-match-wins）
    //       → 整段无 match
    //   - 修法：拆成两条独立 regex pattern（list 内两条 COMPANY 类型 rules）
    //     SensitiveFinder 按顺序 process，都过 post-filter，最终 mergeOverlappingValueAware 用
    //     长短逻辑合并。alt B 即使被 alt A 抢位置，自身 process 也能正常 emit
    pattern: /(?<![这那每该各某自己诸何之与和及或其的了在为于而则])(?<!委托)(?<!代理)(?<!代表)(?:(?:[\u4e00-\u9fa5]{2,8}(?:省|市|自治区))?[\u4e00-\u9fa5（）()]{2,30}(?:[\u4e00-\u9fa5]{0,10}(?:科技|投资|实业|商贸|文化|传媒|网络|信息|电子|建筑|工程|咨询|管理|服务|贸易|发展|控股|融媒体))?(?:集团有限公司|股份有限公司|科技有限公司|投资有限公司|实业有限公司|商贸有限公司|有限公司|分公司|公司))/g,
    weight: 0.88,
    description: '公司名称(完整型)'
  },
  {
    type: 'COMPANY',
    // alt B：简称 + 集团（如"阿里巴巴集团"）
    // v4 拆分（见上 alt A 注释）
    // 副词前缀拒保护（spy 6-docx audit - fixture "同时配合集团"）：
    //   - 纯 post-filter 处理（看 body 前 2-3 字符），不在 regex 里
    //     单字副词（时/同/也/又/还/但/或/仍/即/仅）会出现在真公司名（"时代集团"/"同方集团"）
    //     → 必须在 post-filter 用 2-3 字符副词链判定
    pattern: /(?<![这那每该各某自己诸何之与和及或其的了在为于而则])(?<!委托)(?<!代理)(?<!代表)[\u4e00-\u9fa5]{2,8}集团/g,
    weight: 0.88,
    description: '公司名称(集团简称)'
  },
  {
    type: 'BANK_LABEL',
    // 2026-07-26 spy 截图反馈：合同收款信息表格 "开户银行：XX银行XX支行" 没识别
    //   BANK_CARD 只吃数字；ADDRESS 要 5 大城市或"X省"开头，"广州"不在白名单
    //   修法：label 限定 + 中文/数字 + 可选支行/分行/营业部/总行后缀
    //   label alt：开户银行 / 开户行 / 收款银行
    //   银行名 body 4-30 字（"招商银行广州体育东路支行" = 12 字）
    //
    //   规则位置在 COMPANY 之后（回归 case 42 保护）：
    //     "开户行：<某国有大行完整公司名>"（CompanyRecognition case 42）既是 BANK_LABEL
    //     又是 COMPANY 完整形态 → COMPANY 先入 matches array
    //     → merge 同范围保留先入 → COMPANY 优先
    //     BANK_LABEL 只兜 COMPANY 吃不到的 "XX银行XX支行"（无公司 form 后缀）形态
    pattern: /(?:开户银行|开户行|收款银行)\s*[:：]?\s*([\u4e00-\u9fa50-9]{4,30}(?:支行|分行|营业部|总行)?)/g,
    weight: 0.85,
    description: '开户银行(label 限定)'
  },
  {
    type: 'NAME',
    // v2 修复（spy audit batch #7 — fixture 合同 "项目负责人为张三" 漏识别）：
    //   原 regex lookbehind 只收 4 个 label（姓名/名字/客户姓名/联系人），合同"项目负责人"未覆盖
    //   分隔符只允许 `[:：]`，合同叙述用"为"作分隔符（"联系人为张三"/"项目负责人为张三"）→ 漏识别
    //   修法：
    //     1. label alt 加 "项目负责人"
    //     2. 分隔符改 `[:：是为]`（含"为"叙述句常见写法）
    //     3. 分隔符必须存在（去掉 ?）— 避免 lookbehind 短路匹配导致 "为" 被吞入姓名（如 "联系人为张三" → "为张三"）
    //   注意：必须用 capture group 形式确保分隔符被 lookbehind 消费（不让 "为" 进入 capture）
    //   回归保护：现有 "联系人："/"姓名：" 等 5+ label 行为不变
    // v3 修复（spy smoke test — "联系人：张三、李四" 漏识别"李四"）：
//   原 regex 只 match label 直后 1 个姓名，多姓名用 "、" / "，" / "；" 分隔时第 2+ 个姓名无 label 锚定 → 漏
//   修法：match 后追加续接段 `(?:[、，；]\s*[\u4e00-\u9fa5]{2,4})*` + SensitiveFinder post-filter 切分验证
//   FP 控制（post-filter 在 SensitiveFinder.ts）：
//     - 段不以"本"开头
//     - 段不匹配 label 词表（电话/邮箱/地址 等常见 label）
//     - 段不包含数字 / 英文 / 括号
//     - 段不以合同动词开头（负责/委托/联系 等叙述词）
//   回归保护：单姓名场景行为不变（continuation 0 iter）
    pattern: /(?<=姓名\s*[:：是为]\s*|名字\s*[:：是为]\s*|客户姓名\s*[:：是为]\s*|联系人\s*[:：是为]\s*|项目负责人\s*[:：是为]\s*)[\u4e00-\u9fa5]{2,4}(?:[、，；]\s*[\u4e00-\u9fa5]{2,4})*/g,
    weight: 0.85,
    description: '中文姓名'
  },
  {
    type: 'URL',
    // 2026-07-26 spy 反馈：合同里出现 "https://example.com" / "www.example.com" / "example.com.cn"
    //   等网址没识别（合同里常引用对方官网、监管平台、第三方平台 URL）
    //   三段式 alternation：
    //     A. http(s):// + 域名 + 路径 + 查询（覆盖最常见 URL 形态）
    //     B. www. + 域名（常见省略协议头的 URL）
    //     C. 裸域名 + 顶级域（"example.com.cn" / "site.org" 等无 www 也无协议头）
    //   域名部分：[\w-]+(\.[\w-]+)+ 至少 2 段（防 "abc.com" 误匹配普通词）
    //   TLD 白名单：com/cn/org/net/io/gov/edu/co/ai/app/me/info/xyz/biz
    //     （避免误吃普通英文词如 "table.com" 等字典词误判）
    //   path/query 部分：可选 (/[^\s<>"']+)  — 合同里 URL 常带查询参数
    //   FP 控制（post-filter 在 SensitiveFinder.ts）：
    //     - 域名部分必须 ≥ 4 chars（防 "x.cn" 这种 3 字过短）
    //     - 必须含 . （已 regex 保证）
    //   2026-07-27 spy 合同反馈 FP-A：URL 后紧跟中文右括号）时贪吞后续中文
    //     修法：path/query 排除集加中文标点（）】」』，。；、和全角空格），URL 停在中文标点前
    pattern: /(?:https?:\/\/[\w-]+(?:\.[\w-]+)+(?:\/[^\s<>"'）】」』，。；、\u3000]*)?|www\.[\w-]+(?:\.[\w-]+)+(?:\/[^\s<>"'）】」』，。；、\u3000]*)?|(?<![\w@.])(?:[\w-]+\.)+(?:com|cn|org|net|io|gov|edu|co|ai|app|me|info|xyz|biz|com\.cn|org\.cn|net\.cn|gov\.cn|edu\.cn)(?:\/[^\s<>"'）】」』，。；、\u3000]*)?)/gi,
    weight: 0.85,
    description: '网址(URL/域名)'
  }
];

export function createRulesFromBuiltin(): Rule[] {
  return BUILTIN_RULES.map(rule => ({
    id: generateUUID(),
    type: rule.type,
    pattern: rule.pattern,
    weight: rule.weight,
    description: rule.description,
    enabled: true
  }));
}

export const SENSITIVE_TYPE_LABELS: Record<SensitiveType, string> = {
  PHONE: '手机号',
  ID_CARD: '身份证',
  EMAIL: '邮箱',
  BANK_CARD: '银行卡',
  BANK_LABEL: '开户银行',
  BANK_ACCOUNT_LABEL: '银行账号',
  IP: 'IP地址',
  AMOUNT: '小写金额',
  AMOUNT_UPPER: '大写金额',
  ADDRESS: '地址',
  CONTRACT_NO: '合同号',
  PROJECT_NAME: '项目名称',
  COMPANY: '公司名称',
  NAME: '姓名',
  TAX_ID: '纳税人识别号',
  URL: '网址',
  CUSTOM: '自定义'
};
