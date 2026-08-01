import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { execSync } from 'child_process'

// Inject build-time constants so the deployed bundle carries a unique fingerprint.
// Critical for users to verify they're not running a cached stale build.
function getGitShortHash(): string {
  try {
    return execSync('git rev-parse --short HEAD', { cwd: __dirname })
      .toString().trim();
  } catch {
    return 'unknown';
  }
}
function getBuildTime(): string {
  return new Date().toISOString();
}

export default defineConfig(({ mode }) => ({
  plugins: [react()],
  // GitHub Pages 子路径部署（xxx.github.io/document-redactor/）vs 本地开发（/）
  // 生产构建用子路径，dev 用根路径——避免本地 URL 多一段 /document-redactor/
  base: mode === 'production' ? '/document-redactor/' : '/',
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __BUILD_HASH__: JSON.stringify(getGitShortHash()),
    __BUILD_TIME__: JSON.stringify(getBuildTime()),
  },
  optimizeDeps: {
    exclude: ['pdfjs-dist']
  },
  worker: {
    format: 'es'
  }
}))
