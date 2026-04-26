import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dir = dirname(fileURLToPath(import.meta.url));

/**
 * Embeds the locally-built KNARR dist into a virtual module so the
 * WebContainer uses local code instead of the npm-published package.
 * Run `pnpm build` in the repo root before starting the playground.
 */
function localKNARRDev(): Plugin {
  const KNARRRoot = join(__dir, '..');
  const distDir = join(KNARRRoot, 'dist');
  const pkgPath = join(KNARRRoot, 'package.json');

  return {
    name: 'local-KNARR-dev',
    resolveId(id) {
      if (id === 'virtual:local-KNARR') return '\0virtual:local-KNARR';
    },
    load(id) {
      if (id !== '\0virtual:local-KNARR') return;

      if (!existsSync(distDir)) {
        console.warn('[local-KNARR-dev] dist/ not found — run `pnpm build` in repo root first');
        return 'export default null;';
      }

      // Build a flat FileSystemTree: { 'package.json': {file:{contents}}, dist: {directory:{...}} }
      const pkgJson = readFileSync(pkgPath, 'utf-8');
      const distFiles: Record<string, { file: { contents: string } }> = {};
      for (const name of readdirSync(distDir)) {
        distFiles[name] = { file: { contents: readFileSync(join(distDir, name), 'utf-8') } };
      }

      const tree = {
        'package.json': { file: { contents: pkgJson } },
        dist: { directory: distFiles },
      };

      return `export default ${JSON.stringify(tree)};`;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), localKNARRDev()],
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
    },
    port: 5174,
  },
});
