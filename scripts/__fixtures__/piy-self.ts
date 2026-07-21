// scripts/__fixtures__/piy-self.ts —— 故意含 PII 字面字符串，验证 scripts/ 目录豁免
// pre-commit hook 必须不再拦它（脚本自身的 PATTERNS 字面字符串是合法的）
// 修改 check-pii.sh 时此 fixture 必须保持命中，但 scripts/ 豁免让它通过

const example = "constant /Users/messi fixture used by scripts/__tests__";
const cn = "中国经济引力场";
const ct = "20240802-3RFW";
const email = "yanchao@youmingnj.com";
const phone = "18752008905";
