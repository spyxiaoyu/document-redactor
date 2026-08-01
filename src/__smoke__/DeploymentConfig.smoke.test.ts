/**
 * GitHub 公开部署配置 — 锁死项
 *
 *   spy 决议：上传 GitHub 公开，让用户能 ① 在线用 Pages / ② 拉源码 npm run dev / ③ build dist/ 自托管。
 *
 *   锁死项（防止后续 PR 改回去）：
 *   - vite build 产物 base path = /document-redactor/（Pages 子路径部署必加，否则静态资源 404）
 *   - vite dev mode base path = /（不影响本地开发）
 *   - build script 自动生成 dist/404.html（GitHub Pages SPA fallback，刷新 /upload 不再 404）
 *   - package.json 必含 description / license / author / repository（GitHub 仓库页 metadata 自动填）
 *   - README 测试 badge 同步到 563 passing（防止 stale 数字误导用户）
 *   - README 含三套使用文档：Pages 在线 / 本地开发 / 自托管 dist/
 *   - .github/workflows/deploy.yml 存在（push main 自动部署到 Pages）
 */
import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

const REPO_ROOT = path.resolve(__dirname, '../..');

function readFile(relPath: string): string {
  return fs.readFileSync(path.resolve(REPO_ROOT, relPath), 'utf-8');
}

function exists(relPath: string): boolean {
  return fs.existsSync(path.resolve(REPO_ROOT, relPath));
}

describe('部署配置 — vite base path', () => {
  it('vite.config.ts 包含条件化 base（production 用 /document-redactor/，dev 用 /）', () => {
    const content = readFile('vite.config.ts');
    // 条件表达式：mode === 'production' 或类似判断
    expect(content).toMatch(/base\s*:/);
    // 必须含 /document-redactor/ 子路径（Pages 部署）
    expect(content).toContain('/document-redactor/');
    // 必须有 conditional（不能硬编码）
    expect(content).toMatch(/mode\s*===\s*['"]production['"]|process\.argv/);
  });
});

describe('部署配置 — 404.html fallback', () => {
  it('package.json build script 自动复制 404.html', () => {
    const pkg = JSON.parse(readFile('package.json'));
    const buildScript: string = pkg.scripts?.build ?? '';
    // 复制 dist/index.html → dist/404.html
    expect(buildScript).toMatch(/cp\s+dist\/index\.html\s+dist\/404\.html|copy.*dist.*404\.html/);
  });
});

describe('部署配置 — package.json metadata', () => {
  it('含 description（GitHub 仓库页副标题）', () => {
    const pkg = JSON.parse(readFile('package.json'));
    expect(typeof pkg.description).toBe('string');
    expect(pkg.description.length).toBeGreaterThan(10);
  });

  it('含 license（标识开源协议）', () => {
    const pkg = JSON.parse(readFile('package.json'));
    expect(pkg.license).toBe('MIT');
  });

  it('含 author（标识作者）', () => {
    const pkg = JSON.parse(readFile('package.json'));
    expect(typeof pkg.author).toBe('string');
    expect(pkg.author.length).toBeGreaterThan(0);
  });

  it('author 不含 email 字面（避免简化版 noreply 邮箱收不到邮件的坑 + 减少隐私暴露面）', () => {
    const pkg = JSON.parse(readFile('package.json'));
    const author: string = pkg.author;
    // 名字里不应该有 email 格式（含 @ + 域名点）
    expect(author).not.toMatch(/[\w.+-]+@[\w-]+\.[\w.-]+/);
    // 不应该有 noreply 字样
    expect(author.toLowerCase()).not.toContain('noreply');
    expect(author.toLowerCase()).not.toContain('users.noreply');
  });

  it('含 repository（指向 GitHub 仓库）', () => {
    const pkg = JSON.parse(readFile('package.json'));
    expect(pkg.repository).toBeDefined();
    expect(pkg.repository.url).toMatch(/github\.com/);
  });
});

describe('部署配置 — GitHub Actions 自动部署', () => {
  it('.github/workflows/deploy.yml 存在', () => {
    expect(exists('.github/workflows/deploy.yml')).toBe(true);
  });

  it('workflow 触发条件含 push main', () => {
    const content = readFile('.github/workflows/deploy.yml');
    expect(content).toMatch(/on:\s*[\s\S]*push/);
    expect(content).toMatch(/branches:\s*[\s\S]*main/);
  });

  it('workflow 用官方 actions/deploy-pages', () => {
    const content = readFile('.github/workflows/deploy.yml');
    expect(content).toContain('actions/deploy-pages');
    expect(content).toContain('actions/configure-pages');
    expect(content).toContain('actions/upload-pages-artifact');
  });
});

describe('部署配置 — README 文档', () => {
  it('badge 测试数同步到 563（实际跑出来的数字）', () => {
    const content = readFile('README.md');
    expect(content).not.toContain('393%20passing');
    expect(content).toContain('563');
  });

  it('README 含 "GitHub Pages 在线" 使用文档', () => {
    const content = readFile('README.md');
    expect(content).toContain('GitHub Pages');
    expect(content).toContain('github.io');
  });

  it('README 含 "本地开发" 使用文档', () => {
    const content = readFile('README.md');
    expect(content).toContain('npm run dev');
  });

  it('README 含 "自托管 dist/" 使用文档（含具体 serve 命令）', () => {
    const content = readFile('README.md');
    // 必须含 build + serve dist/ 的具体步骤
    expect(content).toContain('npm run build');
    expect(content).toContain('dist/');
    // 必须含至少一种静态文件服务命令
    expect(content).toMatch(/python\s+-m\s+http\.server|npx\s+serve|http-server/);
  });
});
