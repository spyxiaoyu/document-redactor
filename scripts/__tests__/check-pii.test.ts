/**
 * check-pii.sh 行为测试：
 *   - bash 脚本扫指定文件（或 git staged）的通用 PII 正则
 *   - 命中 exit 1 + pattern 列表
 *   - 干净 exit 0
 *
 * 防再犯：本测试是 commit 时 PII 拦截 hook 的契约。
 * 修改 scripts/check-pii.sh 的 PII pattern 列表时必须同步更新本测试。
 *
 * 注：本测试只测通用 PII 正则（不测 spy 个人定制字典）。
 * 用户本机外挂字典 ~/.pii-local/extra-patterns.txt 在 P0-5 中已加支持。
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

function runCheck(extraArgs: string[] = [], cwd?: string): { code: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync('bash', [SCRIPT, ...extraArgs], {
      encoding: 'utf-8',
      stdio: ['ignore', 'pipe', 'pipe'],
      cwd,
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

describe('check-pii.sh: 12 类通用 PII 正则拦截', () => {
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

  it('含手机号占位符应 exit != 0', () => {
    const f = writeFixture('bad-phone.ts', 'const p = "13800001234";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/1[3-9][0-9]{9}/);
  });

  it('含身份证号占位符应 exit != 0', () => {
    const f = writeFixture('bad-id.ts', 'const id = "110101199003078888";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/1[0-9]{16}[0-9Xx]/);
  });

  it('含银行卡号占位符应 exit != 0', () => {
    const f = writeFixture('bad-bank.ts', 'const b = "6222021234567890123";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/[0-9]{16,19}/);
  });

  it('含邮箱占位符应 exit != 0', () => {
    const f = writeFixture('bad-email.ts', 'const e = "test@example.com";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+/);
  });

  it('含 IPv4 占位符应 exit != 0', () => {
    const f = writeFixture('bad-ip.ts', 'const ip = "192.168.1.1";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/([0-9]{1,3}\.){3}[0-9]{1,3}/);
  });

  it('含合同号占位符应 exit != 0', () => {
    const f = writeFixture('bad-contract.ts', 'const ct = "SAMPLE-CT-2024-001";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/SAMPLE-CT-2024-001/);
  });

  it('含大写金额占位符应 exit != 0', () => {
    const f = writeFixture('bad-amt.ts', 'const a = "壹佰贰拾叁元肆角伍分";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/[零壹贰叁肆伍陆柒捌玖拾佰仟万亿元圆角分]/);
  });

  it('含公司名后缀占位符应 exit != 0', () => {
    const f = writeFixture('bad-co.ts', 'const c = "测试科技有限公司";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/有限公司|集团|股份|科技|投资|实业|商贸/);
  });

  it('含姓名 label 限定占位符应 exit != 0', () => {
    const f = writeFixture('bad-name.ts', 'const n = "甲方：张三";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/甲方|乙方|姓名|联系人/);
  });

  it('含地址 label 限定占位符应 exit != 0', () => {
    const f = writeFixture('bad-addr.ts', 'const a = "地址：示例省示例市示例区示例路88号";\n');
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/地址|住址|住所/);
  });

  it('多 pattern 同时命中应 exit != 0', () => {
    const f = writeFixture('multi.ts', [
      'const phone = "13800001234";',
      'const email = "test@example.com";',
      'const co = "测试有限公司";',
    ].join('\n'));
    const r = runCheck([f]);
    expect(r.code).not.toBe(0);
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

  it('scripts/ 目录文件应被豁免（含 check-pii.sh 自身通用 PII 正则不被自拦）', () => {
    // check-pii.sh 自身含通用 PII 正则（如 PHONE / EMAIL 正则）
    // 因为 EXCLUDE_DIRS_REGEX 包含 scripts/，应跳过扫描避免自拦截
    const r = runCheck([SCRIPT]);
    expect(r.code, `scripts/ 豁免失败：${r.stdout}${r.stderr}`).toBe(0);
  });

  it('用户本机外挂字典 ~/.pii-local/extra-patterns.txt 缺失时应跳过', () => {
    // 文件不存在时，check-pii.sh 应继续正常工作
    // 此测试隐式覆盖：默认行为不依赖外挂字典
    const f = writeFixture('clean2.ts', '// 干净代码\nexport const x = 2;\n');
    const r = runCheck([f]);
    expect(r.code).toBe(0);
  });
});

describe('check-pii.sh: staged 模式只扫新增行（2026-07-26 diff-line 扫描）', () => {
  // 触发来源：feat(rules) commit 被 hook 拦 113 处 —— 全是 PII 识别引擎源码
  //   注释里的历史合成样例（引擎源码天然长得像 PII）。
  // 修法契约：
  //   - staged 模式（无参数）只扫 git diff --cached 的新增行（+ 行）
  //     → 历史行的占位样例不再永远拦截 commit
  //   - 显式文件模式保持全文件扫描（本文件前 16 个用例语义不变）
  //   - __tests__ 目录豁免（probe 测试按 CONTRIBUTING 约定只放占位符，人工 review 兜底）
  //
  // 每个用例在独立临时 git repo 里跑（不污染项目仓库的 staging area）。
  function makeRepo(): string {
    const repo = fs.mkdtempSync(path.join(os.tmpdir(), 'check-pii-repo-'));
    execFileSync('git', ['init', '-q'], { cwd: repo });
    execFileSync('git', ['config', 'user.email', 'test@example.invalid'], { cwd: repo });
    execFileSync('git', ['config', 'user.name', 'tester'], { cwd: repo });
    return repo;
  }
  const repos: string[] = [];

  afterAll(() => {
    repos.forEach(r => fs.rmSync(r, { recursive: true, force: true }));
  });

  it('staged-1: 已 commit 的旧行含占位 PII，新增行干净 → exit 0（不翻旧账）', () => {
    const repo = makeRepo();
    repos.push(repo);
    const f = path.join(repo, 'engine.ts');
    // 第一次 commit：文件含 PII 形态占位（模拟引擎源码历史注释）
    fs.writeFileSync(f, '// 历史注释：示例卡号 6222021234567890123\nexport const a = 1;\n');
    execFileSync('git', ['add', 'engine.ts'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init', '--no-verify'], { cwd: repo });
    // 第二次改动：只加一行干净代码，stage
    fs.appendFileSync(f, 'export const b = 2;\n');
    execFileSync('git', ['add', 'engine.ts'], { cwd: repo });
    const r = runCheck([], repo);
    expect(r.code, `旧行占位 PII 不应拦截：${r.stdout}${r.stderr}`).toBe(0);
  });

  it('staged-2: 新增行含占位 PII → exit 1（新增内容仍拦）', () => {
    const repo = makeRepo();
    repos.push(repo);
    const f = path.join(repo, 'engine.ts');
    fs.writeFileSync(f, 'export const a = 1;\n');
    execFileSync('git', ['add', 'engine.ts'], { cwd: repo });
    execFileSync('git', ['commit', '-q', '-m', 'init', '--no-verify'], { cwd: repo });
    // 新增一行含 PII 形态
    fs.appendFileSync(f, 'const card = "6222021234567890123";\n');
    execFileSync('git', ['add', 'engine.ts'], { cwd: repo });
    const r = runCheck([], repo);
    expect(r.code, `新增行 PII 必须拦截`).not.toBe(0);
    expect(r.stdout + r.stderr).toMatch(/6222021234567890123/);
  });

  it('staged-3: 新建文件含占位 PII → exit 1（新文件所有行都是新增行）', () => {
    const repo = makeRepo();
    repos.push(repo);
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init', '--no-verify'], { cwd: repo });
    const f = path.join(repo, 'new.ts');
    fs.writeFileSync(f, 'const phone = "13800001234";\n');
    execFileSync('git', ['add', 'new.ts'], { cwd: repo });
    const r = runCheck([], repo);
    expect(r.code, `新文件 PII 必须拦截`).not.toBe(0);
  });

  it('staged-4: __tests__ 目录新增占位 PII → exit 0（probe 测试豁免）', () => {
    const repo = makeRepo();
    repos.push(repo);
    execFileSync('git', ['commit', '-q', '--allow-empty', '-m', 'init', '--no-verify'], { cwd: repo });
    const dir = path.join(repo, 'src', 'rules', '__tests__');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, 'probe.test.ts'), 'const t = "联系人：张三";\n');
    execFileSync('git', ['add', '.'], { cwd: repo });
    const r = runCheck([], repo);
    expect(r.code, `__tests__ 目录应豁免：${r.stdout}${r.stderr}`).toBe(0);
  });
});
