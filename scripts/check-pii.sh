#!/usr/bin/env bash
# check-pii.sh: 扫描指定文件（或 git staged 文件）的 PII pattern
#
# 防再犯：本脚本是合同 PII 拦截 hook 的最后一道闸门。脚本作者在合入前必须用
# `npx vitest run scripts/__tests__/check-pii.test.ts` 验证 11 个契约用例全过。
#
# 用法：
#   bash scripts/check-pii.sh <file> [<file> ...]   扫指定文件（全文件扫描）
#   bash scripts/check-pii.sh                       扫 git staged 改动（只扫新增行）
#
# 模式语义（2026-07-26 diff-line 扫描改造）：
#   - 显式文件模式：全文件逐行扫（人工审计用，语义不变）
#   - staged 模式：只扫 git diff --cached 的新增行（+ 行）
#     根因：PII 识别引擎源码（src/rules / src/engines）注释里的历史合成样例
#     天然长得像 PII，全文件扫描导致任何 touch 这些文件的 commit 永远被拦。
#     只扫新增行 → 历史行不再翻旧账，新增真 PII 仍然拦得住。
#
# 退出码：
#   0 — 干净
#   1 — 至少 1 处 PII 命中（输出 file:line:pattern）
#   2 — 调用错误（缺参数 / 文件不存在）
#
# 修改 PII pattern 列表时必须同步更新：
#   - scripts/__tests__/check-pii.test.ts（probe 契约）
#   - CHANGELOG.md（如需记录新发现的 PII 类别）

set -uo pipefail

# —— PII pattern 列表（12 类通用正则）——
#
# 注：本脚本设计为"通用 PII 拦截器"——不含任何用户真实 PII 字面。
# 拦截覆盖：
#   1. PHONE         中国大陆手机号 11 位
#   2. ID_CARD       18 位身份证（含末位 X/x）
#   3. BANK_CARD     16-19 位银行卡
#   4. EMAIL         标准 email 格式
#   5. IP            IPv4（0-255 边界由调用者语义保证）
#   6. CONTRACT_NO   标准合同号格式（前缀-年-月-序号 或 类似）
#   7. AMOUNT_UPPER  大写金额（零壹贰叁...圆角分）
#   8. COMPANY       中文公司名后缀（有限公司/集团/股份/科技/投资/实业/商贸）
#   9. NAME          中文姓名 label 限定（姓名/联系人/甲方/乙方/经办人 等）
#   10. ADDRESS      中文地址 label 限定（地址/住址/联系地址 等）
#   11. PROJECT_NAME 项目名称 label 限定（项目名称/工程名称 等）
#   12. TAX_ID       纳税人识别号 label 限定（税号/统一社会信用代码 等）
#
# 用户本机想要"个人定制拦截"（特定公司字典、特定合同名）时：
#   在 ~/.pii-local/extra-patterns.txt 加额外 PATTERN（每行一个字面或正则）
#   本脚本自动追加到 PII_PATTERNS 后（详见 CONTRIBUTING.md §本机增强拦截）
#
# 修改本列表时记得同步更新 scripts/__tests__/check-pii.test.ts。
PII_PATTERNS=(
  '\b1[3-9][0-9]{9}\b'                                                          # 1. PHONE
  '\b[0-9]{17}[0-9Xx]\b'                                                        # 2. ID_CARD
  '\b[0-9]{16,19}\b'                                                            # 3. BANK_CARD
  '[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}'                              # 4. EMAIL
  '\b([0-9]{1,3}\.){3}[0-9]{1,3}\b'                                             # 5. IP
  '\b[A-Z]{1,5}-[A-Z0-9-]{2,}-[A-Z0-9-]{2,}\b'                                  # 6. CONTRACT_NO
  '[零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分]{4,}'                                 # 7. AMOUNT_UPPER
  '[一-龥]+(有限公司|集团|股份|科技|投资|实业|商贸|分公司)'                        # 8. COMPANY
  '(姓名|联系人|甲方|乙方|丙方|经办人|法人|代表)[[:space:]:：]+[一-龥]{2,4}'        # 9. NAME (label 限定)
  '(地址|住址|住所|联系地址)[[:space:]:：]+[一-龥0-9]+'                            # 10. ADDRESS (label 限定)
  '(项目名称|工程名称|项目|工程)[[:space:]:：]+[一-龥0-9A-Za-z]+'                  # 11. PROJECT_NAME (label 限定)
  '(纳税人识别号|税号|统一社会信用代码)[[:space:]:：]+[A-Z0-9]{15,20}'             # 12. TAX_ID (label 限定)
)

# —— 用户本机外挂字典（可选）——
# 文件不存在或为空时跳过；存在时每行追加为一个 pattern（字面或正则）
PII_LOCAL_FILE="${HOME}/.pii-local/extra-patterns.txt"
if [ -f "$PII_LOCAL_FILE" ]; then
  while IFS= read -r line; do
    [ -n "$line" ] && PII_PATTERNS+=("$line")
  done < "$PII_LOCAL_FILE"
fi

# ——— 主流程 ———

# 1. 决定要扫的文件列表
#    STAGED_MODE=1 时（无参数）：只扫 git diff --cached 新增行
TARGETS=()
STAGED_MODE=0
if [ "$#" -eq 0 ]; then
  STAGED_MODE=1
  # 无参数：扫 git staged 新增/修改的文件
  if ! git rev-parse --git-dir >/dev/null 2>&1; then
    echo "❌ check-pii.sh: 不是 git 仓库，无法扫 staged files" >&2
    echo "   用法：bash scripts/check-pii.sh <file> [<file> ...]" >&2
    exit 2
  fi
  # 兼容 macOS bash 3.2（无 mapfile）：用 while-read 收集 staged 文件
  # git diff --cached --name-only + --diff-filter=AM（新增/修改，不含 deleted）
  while IFS= read -r line; do
    [ -n "$line" ] && TARGETS+=("$line")
  done < <(git diff --cached --name-only --diff-filter=AM 2>/dev/null)
fi

if [ "$#" -gt 0 ]; then
  TARGETS=("$@")
  STAGED_MODE=0
fi

if [ "${#TARGETS[@]}" -eq 0 ]; then
  exit 0  # 没东西可扫 = exit 0
fi

# 2. 排除
# - 目录级：node_modules / dist / coverage / .vite / test-fixtures (gitignore 已隐式排除)
# - 目录级：scripts/ —— 工具代码自身 (check-pii.sh 含通用正则 PATTERN 字面)
#   + 测试 fixture（占位符测试）。scripts/ 不被本工具自身扫描，避免自拦截。
#
# 【2026-07-29 教训】__tests__/ 不再豁免：
#   2026-07-21 + 2026-07-28 两次 filter-branch 漏处理测试目录 PII 残留，
#   根因就是豁免了 __tests__/。probe 测试应用占位符（与生产一致），
#   真 PII 字面进测试 = 同样要拦。spy 人工 review 兜底不再可靠（曾漏 248 命中）。
EXCLUDE_DIRS_REGEX='(^|/)(node_modules|dist|coverage|\.vite|test-fixtures|scripts)(/|$)'

# 3. 命中跟踪
PII_HITS=0
declare -a HIT_REPORT=()

# 4. 拼 alternation regex（一次 grep -nE 命中所有 pattern）
PII_REGEX=$(IFS='|'; echo "${PII_PATTERNS[*]}")

# 5. 扫每个文件
for file in "${TARGETS[@]}"; do
  # 文件存在性
  if [ ! -f "$file" ]; then
    if [ "$#" -gt 0 ]; then
      # 显式传文件但不存在 = 用户输入错，exit 2
      echo "❌ check-pii.sh: 文件不存在: $file" >&2
      exit 2
    fi
    # git staged 模式：跳过（文件可能在 .gitignore 或已删除）
    continue
  fi

  # 排除目录（git 模式下用相对路径判断；显式模式下用绝对/相对都行）
  if [[ "$file" =~ $EXCLUDE_DIRS_REGEX ]]; then
    continue
  fi

  # 自排除：本脚本自身（自身含通用 PII 正则作为 pattern list，避免自拦截）
  real_file=$(realpath -m -- "$file" 2>/dev/null || echo "$file")
  real_self=$(realpath -m -- "$0" 2>/dev/null || echo "$0")
  if [ "$real_file" = "$real_self" ]; then
    continue
  fi

  # 跳过 binary（grep -I：只对文本文件操作）
  if ! grep -qI . "$file" 2>/dev/null; then
    continue  # binary → 跳过
  fi

  # 跳过空文件
  if [ ! -s "$file" ]; then
    continue
  fi

  # 扫描：
  #   - staged 模式：只扫 git diff --cached 的新增行（awk 解析 hunk header 跟踪新行号，
  #     输出与 grep -n 相同的 "行号:内容" 格式，历史行不参与扫描）
  #   - 显式文件模式：全文件 grep -n（人工审计语义不变）
  if [ "$STAGED_MODE" = "1" ]; then
    matches=$(git diff --cached -U0 -- "$file" 2>/dev/null | awk '
      /^\+\+\+/ { next }
      /^@@ /   { split($3, a, ","); sub(/^\+/, "", a[1]); ln = a[1] + 0; next }
      /^\+/    { print ln ":" substr($0, 2); ln++ }
    ' | grep -E "$PII_REGEX" || true)
  else
    matches=$(grep -nE "$PII_REGEX" "$file" 2>/dev/null || true)
  fi
  if [ -n "$matches" ]; then
    while IFS= read -r line; do
      # 行格式：line_number:content
      lineno=$(echo "$line" | cut -d: -f1)
      content=$(echo "$line" | cut -d: -f2-)
      # 提取命中的具体 pattern（贪婪匹配第一个匹配项）
      hit_pattern=""
      for p in "${PII_PATTERNS[@]}"; do
        if echo "$content" | grep -qE "$p"; then
          hit_pattern="$p"
          break
        fi
      done
      HIT_REPORT+=("$file:$lineno  PII='${hit_pattern}'  match='${content:0:80}'")
      PII_HITS=$((PII_HITS + 1))
    done <<< "$matches"
  fi
done

# 6. 报告
if [ "$PII_HITS" -gt 0 ]; then
  echo "🚨 check-pii 拦截：检测到 ${PII_HITS} 处 PII 命中" >&2
  echo "" >&2
  printf '  %s\n' "${HIT_REPORT[@]}" >&2
  echo "" >&2
  echo "修法建议（用占位符 / 泛化字符串替换）：" >&2
  echo "  - 真路径 / 真用户名  → <占位符> 或 <repo-path>" >&2
  echo "  - 真公司名 / 真合同号 / 真邮箱  → 中文合成代号 或 SAMPLE-CT-NNN / SAMPLE-CO-X" >&2
  echo "  - 真联系人 / 真电话  → 张某某 / 13800000001" >&2
  echo "" >&2
  echo "如确需本机拦截特定公司字典，可在 ~/.pii-local/extra-patterns.txt 加 pattern" >&2
  exit 1
fi

exit 0
