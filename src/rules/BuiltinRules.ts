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
    pattern: /(\+?86)?[-.\s]?1[3-9]\d{9}/g,
    weight: 0.95,
    description: '中国大陆手机号码'
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
    type: 'BANK_CARD',
    // v2 修复（spy 设备采购 docx [971-989] FP）：
    //   原 regex `[1-9]\d{4}` 硬性拒绝前导 0，"0413090103000048204" 被截成 "413090103000048204" 18 chars
    //   修法：[0-9]\d{4} 允许任意首位数字
    // v3 修复：支持 19 位银联卡（原 regex 限制 16-18 位）
    //   \d{3,5} → \d{3,6} 允许最后一组 3-6 位（总 16-19 位）
    pattern: /[0-9]\d{4}[\s]?\d{4}[\s]?\d{4}[\s]?\d{3,6}/g,
    weight: 0.90,
    description: '银行卡号'
  },
  {
    type: 'IP',
    pattern: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
    weight: 0.85,
    description: 'IPv4地址'
  },
  {
    type: 'AMOUNT',
    pattern: /(?:(?:价格|金额|总计|合计|付款|收款|工资|月薪|年薪|费用|报价)[：:\s]*)\b\d+(?:[,，]\d{3})*(?:\.\d{1,2})?(?:\s*元)?|(?:¥|￥|\$|€|£|USD|CNY|RMB|HKD|JPY)\s*\d+(?:[,，]\d{3})*(?:\.\d{1,2})?(?:\s*(?:元|万|千|美元|欧元|英镑|港币|日圆))?/gi,
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
    pattern: /(?:人民币)?[零壹贰叁肆伍陆柒捌玖拾佰仟万亿]+(?:[万亿】][零壹贰叁肆伍陆柒捌玖拾佰仟万亿]*)*(?:元(?:[零壹贰叁肆伍陆柒捌玖拾佰仟万亿]*[角分])*(?:整)?|(?:[零壹贰叁肆伍陆柒捌玖][角分])+)/gi,
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
    // v2 修复（spy 截图反馈"公司名识别太贪婪"）：
    //   1. 左边界负向后顾 (?<![这那每该各某自己诸何之与和及或其的了在为于而则])
    //      → 防止 "委托北京SAMPLE-CO-E公司"、"这家公司"、"A和B公司" 整段被左贪婪吞
    //   2. body {2,30}（最小 2 字、最多 30 字）→ 防止 "X公司" 单字字号 + 防止超长匹配
    //   3. 2 路 alt 结构：
    //      - alt A: 完整型 <region>?<name 2-30><industry>?<form>（标准公司名）
    //      - alt B: <name 2-8>集团（简称 + 集团，如 "阿里巴巴集团"）
    //   4. industry 部分常见 16 个行业词 + 0-10 字缓冲（"融媒体科技文化" 这种）
    //
    // post-filter 在 SensitiveFinder.ts:80 进一步检查 body 内容合法性（介词/代词/长度兜底）
    pattern: /(?<![这那每该各某自己诸何之与和及或其的了在为于而则])(?<!委托)(?<!代理)(?<!代表)(?:(?:[\u4e00-\u9fa5]{2,8}(?:省|市|自治区))?[\u4e00-\u9fa5（）()]{2,30}(?:[\u4e00-\u9fa5]{0,10}(?:科技|投资|实业|商贸|文化|传媒|网络|信息|电子|建筑|工程|咨询|管理|服务|贸易|发展|控股|融媒体))?(?:集团有限公司|股份有限公司|科技有限公司|投资有限公司|实业有限公司|商贸有限公司|有限公司|分公司|公司)|[\u4e00-\u9fa5]{2,8}集团)/g,
    weight: 0.88,
    description: '公司名称'
  },
  {
    type: 'NAME',
    // Use lookbehind so only the name value is captured, not the label prefix
    pattern: /(?<=姓名\s*[:：]\s*|名字\s*[:：]\s*|客户姓名\s*[:：]\s*|联系人\s*[:：]\s*)[\u4e00-\u9fa5]{2,4}/g,
    weight: 0.85,
    description: '中文姓名'
  },
  {
    type: 'TAX_ID',
    // capture group 提取税号本体：[A-Z0-9]{15,20} 是 match[1]
    // SensitiveFinder.ts:69-72 会用 match[1] 作为 value，这样"纳税人识别号："作为 label 保留不脱敏
    pattern: /(?:纳税人识别号|税号|税务登记号|TIN)\s*[:：]?\s*([A-Z0-9]{15,20})/gi,
    weight: 0.92,
    description: '纳税人识别号'
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
  IP: 'IP地址',
  AMOUNT: '小写金额',
  AMOUNT_UPPER: '大写金额',
  ADDRESS: '地址',
  CONTRACT_NO: '合同号',
  PROJECT_NAME: '项目名称',
  COMPANY: '公司名称',
  NAME: '姓名',
  TAX_ID: '纳税人识别号',
  CUSTOM: '自定义'
};
