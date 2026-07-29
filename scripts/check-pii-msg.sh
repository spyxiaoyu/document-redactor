#!/usr/bin/env bash
# check-pii-msg.sh: 拦截 git commit message 含 PII 字面
#
# 【2026-07-29 教训】filter-branch 跑 4 次才清干净 commit message 里的 27 处 PII。
# 根因：pre-commit hook 只拦 file content，不拦 commit message body。
# 结构性 fix：本脚本 + commit-msg hook 从源头堵，commit message 含 PII 一律拒收。
#
# 用法：
#   bash scripts/check-pii-msg.sh <commit-msg-file>
#
# git commit-msg hook 调用方式（.git/hooks/commit-msg）：
#   #!/usr/bin/env bash
#   bash scripts/check-pii-msg.sh "$1" || exit 1
#
# 退出码：
#   0 — 干净
#   1 — 至少 1 处 PII 命中（输出 file:line:match）
#   2 — 调用错误
#
# 修改本脚本时记得同步更新 scripts/__tests__/check-pii-msg.test.ts。

set -uo pipefail

if [ "$#" -ne 1 ]; then
  echo "❌ check-pii-msg.sh: 用法 bash $0 <commit-msg-file>" >&2
  exit 2
fi

MSG_FILE="$1"

if [ ! -f "$MSG_FILE" ]; then
  echo "❌ check-pii-msg.sh: 文件不存在: $MSG_FILE" >&2
  exit 2
fi

# —— PII pattern 列表 ——
# 复用 scripts/check-pii.sh 的 12 类通用正则（同源 → 易维护）
# 注：本脚本里 PII_PATTERNS 跟 check-pii.sh 完全一致——但本脚本只扫纯文本
# commit message body，不扫 file content。
PII_PATTERNS=(
  '\b1[3-9][0-9]{9}\b'
  '\b[0-9]{17}[0-9Xx]\b'
  '\b[0-9]{16,19}\b'
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'
  '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b'
  '\b[A-Z]{1,5}-[A-Z0-9-]{2,}-[A-Z0-9-]{2,}\b'
  '[零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分]{4,}'
  '[一-龥]+(有限公司|集团|股份|科技|投资|实业|商贸|分公司)'
  '(姓名|联系人|甲方|乙方|丙方|经办人|法人|代表)[[:space:]:：]+[一-龥]{2,4}'
  '(地址|住址|住所|联系地址)[[:space:]:：]+[一-龥0-9]+'
  '(项目名称|工程名称|项目|工程)[[:space:]:：]+[一-龥0-9A-Za-z]+'
  '(纳税人识别号|税号|统一社会信用代码)[[:space:]:：]+[A-Z0-9]{15,20}'
)

# 用户本机外挂字典（可选）
PII_LOCAL_FILE="${HOME}/.pii-local/extra-patterns.txt"
if [ -f "$PII_LOCAL_FILE" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && PII_PATTERNS+=("$line")
  done < "$PII_LOCAL_FILE"
fi

PII_REGEX=$(IFS='|'; echo "${PII_PATTERNS[*]}")

# 扫 commit message
matches=$(grep -nE "$PII_REGEX" "$MSG_FILE" 2>/dev/null || true)

if [ -n "$matches" ]; then
  echo "🚨 check-pii-msg 拦截：commit message 含 PII" >&2
  echo "" >&2
  while IFS= read -r line; do
    lineno=$(echo "$line" | cut -d: -f1)
    content=$(echo "$line" | cut -d: -f2-)
    hit_pattern=""
    for p in "${PII_PATTERNS[@]}"; do
      if echo "$content" | grep -qE "$p"; then
        hit_pattern="$p"
        break
      fi
    done
    printf '  line %s  PII=%s  match=%s\n' "$lineno" "$hit_pattern" "${content:0:80}" >&2
  done <<< "$matches"
  echo "" >&2
  echo "修法建议：用占位符（示例公司 / 13800000000 / 占位人 / 示例路）替代真 PII。" >&2
  echo "如确需本机拦截特定字典，可在 ~/.pii-local/extra-patterns.txt 加 pattern。" >&2
  exit 1
fi

exit 0