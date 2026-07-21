#!/usr/bin/env bash
# check-pii.sh: 扫描指定文件（或 git staged 文件）的 PII pattern
#
# 防再犯：本脚本是合同 PII 拦截 hook 的最后一道闸门。脚本作者在合入前必须用
# `npx vitest run scripts/__tests__/check-pii.test.ts` 验证 11 个契约用例全过。
#
# 用法：
#   bash scripts/check-pii.sh <file> [<file> ...]   扫指定文件
#   bash scripts/check-pii.sh                       扫 git staged 文件
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

# —— PII pattern 列表（17 类）——
# 注：脚本自身也是被扫的文件，所以下面字面字符串会在 self-scan 时命中。
# --self-exclude 开关控制（默认排除）。修改 pattern 时记得同步更新本注释。
PII_PATTERNS=(
  '/Users/messi'                          # username 路径（任何出现）
  '中国经济引力场'                         # 真合同文件名（央视节目真名）
  '走进甲乙'                              # 真合同简称
  '20240802-3RFW'                         # 真合同号 1
  '20210128方太'                          # 真合同号 2
  'K-BJYM-TM-20240802-001'                # 真合同号 3
  '佑铭'                                  # 公司 1
  '方太集团'                              # 公司 2
  '茅台集团'                              # 公司 3
  '习酒公司'                              # 公司 4
  '蓝月亮'                                # 公司 5
  '站酷Zcool\|站酷'                       # 公司 6
  '示例'                                # 公司 7
  '中视传媒'                              # 公司 8
  '千千手'                                # 公司 9
  '小田仙人'                              # 公司 10
  '酪神世家'                              # 公司 11
  '千秋岁月'                              # 公司 12
  '五粮液集团'                            # 公司 13
  '央视财经'                              # 公司 14
  'youmingnj\.com'                        # 真邮箱 1
  'walk-on\.com'                          # 真邮箱 2
  '18752008905'                           # 真电话
  '颜超'                                  # 真联系人
)

# ——— 主流程 ———

# 1. 决定要扫的文件列表
TARGETS=()
if [ "$#" -eq 0 ]; then
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
fi

if [ "${#TARGETS[@]}" -eq 0 ]; then
  exit 0  # 没东西可扫 = exit 0
fi

# 2. 排除
# - 目录级：node_modules / dist / coverage / .vite / test-fixtures (gitignore 已隐式排除)
# - 目录级：scripts/ —— 工具代码自身 (check-pii.sh 含 PATTERNS 字面) + 测试 fixture
#   故意含 PII 字面字符串作反例。trade-off：未来 scripts/ 新增工具脚本若含真合同
#   PII 不会被拦截，spy 应在 commit 时人工 review 工具脚本（commit message 注明）
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

  # 自排除：本脚本自身（自身含 'youmingnj' 等字面字符串作为 pattern list）
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

  # 一次性 grep 所有 pattern
  matches=$(grep -nE "$PII_REGEX" "$file" 2>/dev/null || true)
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
  echo "修法：用占位符替换（参考 f716231 / bb73876 commit message）：" >&2
  echo "  - 真路径 /Users/messi/...  → <本仓库根目录>" >&2
  echo "  - 真公司名 / 真合同号 / 真邮箱  → 中文合成代号（如 测试科技 / SAMPLE-CT-001 / contact@client-a.test）" >&2
  echo "  - 真联系人 / 真电话  → 占位（张某某 / 13800000001）" >&2
  exit 1
fi

exit 0
