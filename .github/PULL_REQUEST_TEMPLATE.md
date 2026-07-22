## 变更类型

- [ ] Bug 修复
- [ ] 新功能
- [ ] 重构（无行为变更）
- [ ] 测试改动
- [ ] 文档改动
- [ ] 构建 / 工具链

## 关联 Issue

> 关联的 issue 编号（如 `Closes #123`）

## 变更说明

> 一两句话说清楚改了什么、为什么改。

## 测试先行铁律（必填）

> 参考 [`CONTRIBUTING.md`](../../CONTRIBUTING.md) §测试先行铁律 + [`CLAUDE.md`](../../CLAUDE.md) §11

### Step 1: probe 测试（RED → GREEN）

- probe 测试文件路径：
- 复现 bug 的最小输入（脱敏后）：
- 期望输出：

### Step 2: 全套 baseline

修改前：
```
测试总数: ___
通过数:   ___
失败数:   ___
```

### Step 3: 改代码（最小必要范围）

> 简述改了哪些文件、改了什么

### Step 4: probe 跑过（GREEN）

修改后 probe 测试结果：
```
✓ ___
```

### Step 5: 全套回归（**已有测试不许失败**）

修改后：
```
测试总数: ___
通过数:   ___
失败数:   ___
delta:    ___
```

### Step 6: tsc + lint + build（必须全 clean）

```
$ npm run build
___

$ npm run lint
___
```

## 根因分析（如是 bug 修复）

> 为什么会出这个 bug？（不是"症状是什么"是"为什么会出这个症状"）

## 沉淀（重要！）

> 本次发现的 bug 是否要追加到 [`PRE_FLIGHT_CHECK.md`](../../PRE_FLIGHT_CHECK.md)？
> 新增的测试 spec 是否要追加到 [`TEST_SPECIFICATION.md`](../../TEST_SPECIFICATION.md)？

- [ ] 已追加到 PRE_FLIGHT_CHECK.md（如适用）
- [ ] 已追加到 TEST_SPECIFICATION.md（如适用）

## PII 自检（必填）

- [ ] working tree PII 扫描：`bash scripts/check-pii.sh` → 0 命中
- [ ] commit message 不含真合同 / 真邮箱 / 真电话 / 真路径字面
- [ ] 代码改动不引入真 PII 字面

## 截图 / GIF（如适用）

> UI 改动请附 before/after 截图（**敏感字段打码后**）

## Checklist

- [ ] 三连全过：`npm test && npm run build && npm run lint`
- [ ] commit message 含复现步骤 + 根因 + 修法 + 测试 delta
- [ ] 已自审 code diff（无调试代码 / console.log / TODO 残留）
- [ ] 已更新相关文档（如功能变更）
