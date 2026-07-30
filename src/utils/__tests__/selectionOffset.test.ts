/**
 * [STUB] computeSelectionOffset 已被删除。
 *
 * 此测试文件是 v1 fix（2026-07-29 第一版）配套测试，v1 fix 用了
 * computeSelectionOffset (TreeWalker) 算 offset，结果被 JSX whitespace
 * text node 偏 6 chars，导致 spy 截图的 "+ 添加 跳到不相关位置" bug。
 *
 * v2 fix 切换到 getRawOffsetFromSelection + data-raw-offset 方案，完全绕开
 * TreeWalker / previewText.slice。computeSelectionOffset 已删除。
 *
 * 行为契约（v2）请见：
 *   src/utils/__tests__/RawOffsetFromSelection.test.ts
 *   src/pages/__tests__/upload-page-add-bugfix-contract.test.ts
 *
 * 此文件保留仅为占位，防止 v1 路径被人重新启用。如确认 v1 不会复活，
 * 安全删除本文件。
 */
import { describe } from 'vitest';

describe.skip('[DEPRECATED v1] computeSelectionOffset — 已删除', () => {});
