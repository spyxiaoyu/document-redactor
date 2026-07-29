/**
 * check-pii-msg.sh 行为测试：
 *   - bash 脚本扫 git commit message 文件的 PII pattern
 *   - 命中 exit 1 + pattern 列表
 *   - 干净 exit 0
 *
 * 【2026-07-29 新增】结构性 fix 配套契约：
 *   commit-msg hook 拦截 commit message 含 PII 字面 — 防止 248 命中 PII
 *   通过 commit message 进 git history 的事再发生（详见 PII_REWRITE_LOG §6）。
 *
 * 修改 scripts/check-pii-msg.sh 的 PII pattern 列表时必须同步更新本测试。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = path.resolve(__dirname, '..', 'check-pii-msg.sh');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'check-pii-msg-test-'));

function writeFixture(name: string, content: string): string {
  const p = path.join(TMP_DIR, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

function runCheck(msgFile: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT, msgFile], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, stdout, stderr: '' };
  } catch (err: any) {
    return {
      code: err.status ?? 1,
      stdout: err.stdout?.toString() ?? '',
      stderr: err.stderr?.toString() ?? '',
    };
  }
}

describe('check-pii-msg.sh: 拦截 commit message 含 PII', () => {
  beforeAll(() => {
    if (!fs.existsSync(SCRIPT)) {
      throw new Error(`check-pii-msg.sh 不存在 @ ${SCRIPT}`);
    }
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('干净 commit message 应 exit 0', () => {
    const f = writeFixture('clean-msg.txt', 'fix: 修某 bug\n\n详细说明。\n');
    const r = runCheck(f);
    expect(r.code, `stdout=${r.stdout} stderr=${r.stderr}`).toBe(0);
  });

  it('含手机号应 exit 1', () => {
    const f = writeFixture('bad-phone.txt', 'fix: 用户 13800001234 反馈 bug\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
    expect(r.stderr).toMatch(/check-pii-msg/);
  });

  it('含身份证号应 exit 1', () => {
    const f = writeFixture('bad-id.txt', 'fix: 110101199003078888 校验问题\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
  });

  it('含银行卡号应 exit 1', () => {
    const f = writeFixture('bad-bank.txt', 'fix: 6222021234567890123 误识别\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
  });

  it('含邮箱应 exit 1', () => {
    const f = writeFixture('bad-email.txt', 'fix: test@example.com 解析失败\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
  });

  it('含 IPv4 应 exit 1', () => {
    const f = writeFixture('bad-ip.txt', 'fix: 192.168.1.1 拒绝连接\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
  });

  it('含合同号格式应 exit 1', () => {
    const f = writeFixture('bad-contract.txt', 'fix: SAMPLE-CT-2024-001 解析\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
  });

  it('含大写金额应 exit 1', () => {
    const f = writeFixture('bad-amount.txt', 'fix: 壹贰叁肆伍陆柒捌玖 解析\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
  });

  it('含公司名后缀应 exit 1', () => {
    const f = writeFixture('bad-company.txt', 'fix: 北京示例科技有限公司 解析\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
  });

  it('含 NAME label 应 exit 1', () => {
    const f = writeFixture('bad-name.txt', 'fix: 联系人：张三 重复匹配\n');
    const r = runCheck(f);
    expect(r.code).toBe(1);
  });

  it('缺参数应 exit 2', () => {
    try {
      execFileSync('bash', [SCRIPT], { encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] });
      throw new Error('应 exit 2');
    } catch (err: any) {
      expect(err.status).toBe(2);
    }
  });

  it('文件不存在应 exit 2', () => {
    const r = runCheck('/tmp/__nonexistent_msg_file__.txt');
    expect(r.code).toBe(2);
  });
});