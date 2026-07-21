/**
 * check-pii.sh 行为测试：
 *   - bash 脚本扫指定文件（或 git staged）的 PII pattern
 *   - 命中 exit 1 + pattern 列表
 *   - 干净 exit 0
 *
 * 防再犯：本测试是合同 PII 真合同名 / 真路径 / 真邮箱 等 commit 时拦截 hook 的契约。
 * 修改 scripts/check-pii.sh 的 PII pattern 列表时必须同步更新本测试。
 */
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

const SCRIPT = path.resolve(__dirname, '..', 'check-pii.sh');
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'check-pii-test-'));

function writeFixture(name: string, content: string): string {
  const p = path.join(TMP_DIR, name);
  fs.writeFileSync(p, content, 'utf-8');
  return p;
}

function runCheck(extraArgs: string[] = []): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...extraArgs], {
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

describe('check-pii.sh: 17 PII pattern 拦截', () => {
  beforeAll(() => {
    if (!fs.existsSync(SCRIPT)) {
      throw new Error(`check-pii.sh 不存在 @ ${SCRIPT} — 本测试是它的契约，先实现脚本再跑测试`);
    }
  });

  afterAll(() => {
    fs.rmSync(TMP_DIR, { recursive: true, force: true });
  });

  it('干净 fixture 应 exit 0', () => {
    const f = writeFixture('clean.ts', '// 纯测试代码，无 PII\nexport const x = 1;\n');
    const r = runCheck([f]);
    expect(r.code, `stdout=${r.stdout} stderr=${r.stderr}`).toBe(0);
  });

  it('含 /Users/messi 应 exit != 0', () => {
    const f = writeFixture('bad-path.ts', 'const PATH = "/Users/messi/Desktop/secret.docx";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/\/Users\/messi/);
  });

  it('含 真合同号 应 exit != 0', () => {
    const f = writeFixture('bad-contract.ts', 'const CT = "20240802-3RFW";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/20240802-3RFW/);
  });

  it('含 真邮箱 应 exit != 0', () => {
    const f = writeFixture('bad-email.ts', 'const e = "yanchao@youmingnj.com";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/youmingnj\.com/);
  });

  it('含 真电话 应 exit != 0', () => {
    const f = writeFixture('bad-phone.ts', 'const p = "18752008905";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/18752008905/);
  });

  it('含 真合同文件名（中国经济引力场）应 exit != 0', () => {
    const f = writeFixture('bad-title.ts', 'const t = "中国经济引力场";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/中国经济引力场/);
  });

  it('含 14 家真公司代号（佑铭）应 exit != 0', () => {
    const f = writeFixture('bad-co.ts', 'const c = "佑铭科技";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/佑铭/);
  });

  it('多 pattern 同时命中（路径 + 真合同 + 邮箱）应 exit != 0', () => {
    const f = writeFixture('multi.ts', [
      'const PATH = "/Users/messi/secret";',
      'const CT = "20240802-3RFW";',
      'const E = "yanchao@youmingnj.com";',
    ].join('\n'));
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    const all = r.stdout + r.stderr;
    expect(all).toMatch(/\/Users\/messi/);
    expect(all).toMatch(/20240802-3RFW/);
    expect(all).toMatch(/youmingnj\.com/);
  });

  it('空 fixture 应 exit 0', () => {
    const f = writeFixture('empty.ts', '');
    const r = runCheck([f]);
    expect(r.code).toBe(0);
  });

  it('二进制 fixture 应跳过（不阻塞 commit）', () => {
    // PNG binary：含 .docx pattern 字节序列不构成 PII，应跳过
    const f = path.join(TMP_DIR, 'pic.png');
    // 写一个 binary 内容（包含 zhuang huo 这类 ASCII 字母不算 PII）
    fs.writeFileSync(f, Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
    const r = runCheck([f]);
    expect(r.code).toBe(0);  // 跳过 = 不报错
  });

  it('不存在的 path 应 exit != 0（错误信息明确）', () => {
    const r = runCheck([path.join(TMP_DIR, 'does-not-exist.ts')]);
    expect(r.code).not.toBe(0);
    expect(r.stderr + r.stdout).toMatch(/not found|不存在|ENOENT|does not exist/i);
  });

  it('scripts/ 目录文件应被豁免（fixture PII 不会被拦）', () => {
    // 复现预装 fixture：scripts/__fixtures__/piy-self.ts 含 6 类 PII
    // 因为 EXCLUDE_DIRS_REGEX 包含 scripts/，应跳过扫描
    const fixturePath = path.resolve(__dirname, '..', '__fixtures__', 'piy-self.ts');
    expect(fs.existsSync(fixturePath), '预装 fixture 应存在').toBe(true);
    const r = runCheck([fixturePath]);
    expect(r.code, `scripts/ 豁免失败：${r.stdout}${r.stderr}`).toBe(0);
  });
});
