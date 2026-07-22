#!/usr/bin/env bash
# scan-pii.sh: 简化的 PII 扫描 wrapper
#
# 用途：在命令行 / shell history / terminal scrollback 中**不直接暴露 PII 字面**调用 PII 扫描。
#       内部代理到 scripts/check-pii.sh（PII_PATTERNS 数组在 scripts/ 目录，豁免）。
#
# 用法：
#   bash scripts/scan-pii.sh <file> [<file> ...]   扫指定文件
#   bash scripts/scan-pii.sh                       扫 git staged 文件
#   bash scripts/scan-pii.sh -q <file>             安静模式（不显示 hit pattern 字面，只显示 file:line + 类型）
#   bash scripts/scan-pii.sh -c <file>             计数模式（只显示 N 命中，不显示细节）
#   bash scripts/scan-pii.sh -h                   显示帮助
#
# 退出码：
#   0 — 干净
#   1 — 至少 1 处 PII 命中
#   2 — 调用错误
#
# 设计权衡：
#   - 默认模式透传 check-pii.sh 输出（命中时显示 hit pattern 字面，便于调试）
#   - -q / -c 模式过滤掉 PII 字面（保护 shell history / terminal scrollback）
#   - 命令字面不含 PII（不直接 grep 真实真名/真电话/真公司等真实值）
#   - 真 PII 字面仍在 scripts/check-pii.sh 内部 PATTERNS 数组（scripts/ 豁免，trade-off 已记 PII_REWRITE_LOG §5.3）

set -uo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CHECK_PII="$SCRIPT_DIR/check-pii.sh"

if [ ! -f "$CHECK_PII" ]; then
  echo "❌ scan-pii.sh: $CHECK_PII 不存在" >&2
  exit 2
fi

# 解析参数
MODE="default"
FILES=()
for arg in "$@"; do
  case "$arg" in
    -h|--help)
      sed -n '2,30p' "$0" | sed 's/^# \?//'
      exit 0
      ;;
    -q|--quiet)
      MODE="quiet"
      ;;
    -c|--count)
      MODE="count"
      ;;
    -*)
      echo "❌ scan-pii.sh: 未知选项 $arg（用 -h 看帮助）" >&2
      exit 2
      ;;
    *)
      FILES+=("$arg")
      ;;
  esac
done

# quiet 模式：用 sed 把 check-pii.sh 输出的 PII 字面替换成 [REDACTED]
# 策略：保留 file:line + 命中类型 hint，把 PII='...' 和 match='...' 整段都去掉
filter_quiet() {
  sed -E "s/PII='[^']{0,40}'/PII='[REDACTED]'/g; s/match='[^']{0,80}'/match='[REDACTED]'/g"
}

# 跑 check-pii.sh
RAW_OUTPUT_FILE=$(mktemp)
RAW_EXIT=0
bash "$CHECK_PII" "${FILES[@]}" > "$RAW_OUTPUT_FILE" 2>&1 || RAW_EXIT=$?

case "$MODE" in
  default)
    cat "$RAW_OUTPUT_FILE"
    ;;
  quiet)
    filter_quiet < "$RAW_OUTPUT_FILE"
    ;;
  count)
    # 只显示 PII_HITS 总数
    total=$(grep -oE '[0-9]+ 处 PII 命中' "$RAW_OUTPUT_FILE" | grep -oE '[0-9]+' || echo "0")
    if [ "$total" -gt 0 ]; then
      echo "🚨 scan-pii: $total 处 PII 命中（用默认模式看详情：bash scripts/scan-pii.sh <file>）" >&2
    else
      echo "✓ scan-pii: 0 PII 命中" >&2
    fi
    ;;
esac

rm -f "$RAW_OUTPUT_FILE"
exit $RAW_EXIT
