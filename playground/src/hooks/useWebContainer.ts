import { useEffect, useRef, useState, useCallback } from 'react';
import { WebContainer } from '@webcontainer/api';
import type { FileSystemTree, WebContainerProcess } from '@webcontainer/api';
import { createBasicTemplate, PLAYGROUND_NAME } from '../templates/basic/files';

export type BootStatus =
  | 'idle'
  | 'booting'
  | 'mounting'
  | 'installing'
  | 'ready'
  | 'error';

export interface UseWebContainerResult {
  status: BootStatus;
  error: string | null;
  webcontainer: WebContainer | null;
  previewUrl: string | null;
  spawnShell: (
    onData: (data: string) => void,
    onExit?: () => void
  ) => Promise<{
    write: (data: string) => void;
    kill: () => void;
  } | null>;
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, contents: string) => Promise<void>;
  readdir: (path: string) => Promise<string[]>;
}

const NPM_REGISTRY_URL = 'https://registry.npmjs.org/knarr';

/** Fetch the latest stable version of KNARR from npm registry */
async function fetchLatestKNARRVersion(): Promise<string> {
  try {
    const res = await fetch(NPM_REGISTRY_URL);
    if (!res.ok) throw new Error(`npm registry returned ${res.status}`);
    const data = await res.json();
    return data['dist-tags']?.latest ?? 'latest';
  } catch (err) {
    console.warn('[KNARR playground] Failed to fetch latest version, using "latest":', err);
    return 'latest';
  }
}

// Singleton WebContainer instance - only one per browser tab
let bootPromise: Promise<WebContainer> | null = null;

// The workdir is always based on PLAYGROUND_NAME which is now stable via sessionStorage
function getWorkdir(): string {
  return `/home/KNARR-${PLAYGROUND_NAME}`;
}

export function useWebContainer(): UseWebContainerResult {
  const [status, setStatus] = useState<BootStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const containerRef = useRef<WebContainer | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function boot() {
      // Check browser support
      if (typeof SharedArrayBuffer === 'undefined') {
        setError(
          'Your browser does not support SharedArrayBuffer. Please use Chrome, Edge, or Firefox.'
        );
        setStatus('error');
        return;
      }

      try {
        setStatus('booting');

        // Use singleton pattern for WebContainer
        if (!bootPromise) {
          bootPromise = WebContainer.boot({
            workdirName: `KNARR-${PLAYGROUND_NAME}`,
          });
        }

        const container = await bootPromise;

        if (cancelled) return;

        containerRef.current = container;
        setStatus('mounting');

        // Fetch latest canary version from npm and build the template
        const KNARRVersion = await fetchLatestKNARRVersion();
        console.log(`[KNARR playground] Using KNARR version: ${KNARRVersion}`);
        const template = createBasicTemplate(KNARRVersion);

        // Mount the template files at the workdir (default mount location)
        // The workdir is /home/KNARR-<name>/ based on workdirName
        await container.mount(template as FileSystemTree);

        if (cancelled) return;

        // Listen for server-ready event
        container.on('server-ready', (_port, url) => {
          setPreviewUrl(url);
        });

        setStatus('installing');

        // Install root devDependencies (includes knarr)
        // This makes KNARR available via npx without download prompts
        // Don't specify cwd - it defaults to the workdir set by workdirName
        const installProcess = await container.spawn('npm', ['install']);

        // Wait for install to complete
        const installExitCode = await installProcess.exit;

        if (cancelled) return;

        if (installExitCode !== 0) {
          console.warn('npm install returned non-zero exit code:', installExitCode);
        }

        // Install dependencies for packages (needed for tsc/build commands)
        // This enables `knarr push --watch` to auto-detect and run build commands
        const packageDirs = ['packages/api-client', 'packages/ui-kit', 'consumer-app'];
        for (const dir of packageDirs) {
          // Use shell to cd and install - more reliable than --prefix
          const pkgInstall = await container.spawn('sh', ['-c', `cd ${dir} && npm install`]);
          const pkgExitCode = await pkgInstall.exit;
          if (pkgExitCode !== 0) {
            console.warn(`npm install in ${dir} returned non-zero:`, pkgExitCode);
          }
          if (cancelled) return;
        }

        // Pre-populate @example packages into consumer-app/node_modules so
        // Vite can resolve static imports immediately — before the tutorial
        // runs `knarr publish` / `knarr add`. The tutorial later overwrites
        // these with proper KNARR-tracked versions.
        const seed = await container.spawn('sh', ['-c',
          'mkdir -p consumer-app/node_modules/@example/api-client && ' +
          'cp packages/api-client/package.json consumer-app/node_modules/@example/api-client/ && ' +
          'cp -r packages/api-client/dist consumer-app/node_modules/@example/api-client/ && ' +
          'mkdir -p consumer-app/node_modules/@example/ui-kit && ' +
          'cp packages/ui-kit/package.json consumer-app/node_modules/@example/ui-kit/ && ' +
          'cp -r packages/ui-kit/dist consumer-app/node_modules/@example/ui-kit/'
        ]);
        await seed.exit;
        if (cancelled) return;

        // Overwrite npm-installed KNARR with the locally-built dist so the
        // playground always runs the latest code (including unreleased fixes).
        const { default: localKNARRTree } = await import('virtual:local-KNARR');
        if (localKNARRTree) {
          await container.mount({
            node_modules: { directory: {
              '@olegkuibar': { directory: {
                knarr: { directory: localKNARRTree },
              } },
            } },
          } as FileSystemTree);
          console.log('[KNARR playground] Mounted local KNARR build');
        }

        setStatus('ready');
      } catch (err) {
        if (cancelled) return;

        const message = err instanceof Error ? err.message : 'Unknown error';
        console.error('WebContainer boot error:', err);
        setError(message);
        setStatus('error');
      }
    }

    boot();

    return () => {
      cancelled = true;
    };
  }, []);

  const spawnShell = useCallback(
    async (
      onData: (data: string) => void,
      onExit?: () => void
    ): Promise<{
      write: (data: string) => void;
      kill: () => void;
    } | null> => {
      const container = containerRef.current;
      if (!container) return null;

      try {
        const workdir = getWorkdir();
        const shellProcess: WebContainerProcess = await container.spawn('jsh', {
          terminal: {
            cols: 80,
            rows: 24,
          },
          env: {
            HOME: workdir,
            PS1: `\x1b[1;33mKNARR-${PLAYGROUND_NAME}\x1b[0m \x1b[1;32m❯\x1b[0m `,
            // Include common npm global bin paths for WebContainer
            PATH: '/usr/local/bin:/usr/bin:/bin:/home/.npm-global/bin:/root/.npm-global/bin:/usr/local/lib/node_modules/.bin',
          },
        });

        // Pipe output to callback
        shellProcess.output.pipeTo(
          new WritableStream({
            write(data) {
              onData(data);
            },
          })
        );

        // Handle process exit
        shellProcess.exit.then(() => {
          onExit?.();
        });

        // Get writable input stream
        const input = shellProcess.input.getWriter();

        return {
          write: (data: string) => {
            input.write(data);
          },
          kill: () => {
            shellProcess.kill();
          },
        };
      } catch (err) {
        console.error('Failed to spawn shell:', err);
        return null;
      }
    },
    []
  );

  // WebContainer fs API operates relative to the workdir, so paths like "/" or "/packages"
  // are already correct - no need to add workdir prefix
  const readFile = useCallback(async (path: string): Promise<string | null> => {
    const container = containerRef.current;
    if (!container) return null;

    try {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      return await container.fs.readFile(normalizedPath, 'utf-8');
    } catch {
      return null;
    }
  }, []);

  const writeFile = useCallback(
    async (path: string, contents: string): Promise<void> => {
      const container = containerRef.current;
      if (!container) return;

      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      await container.fs.writeFile(normalizedPath, contents);
    },
    []
  );

  const readdir = useCallback(async (path: string): Promise<string[]> => {
    const container = containerRef.current;
    if (!container) return [];

    try {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const entries = await container.fs.readdir(normalizedPath, { withFileTypes: true });
      return entries.map((entry) =>
        entry.isDirectory() ? `${entry.name}/` : entry.name
      );
    } catch {
      return [];
    }
  }, []);

  return {
    status,
    error,
    webcontainer: containerRef.current,
    previewUrl,
    spawnShell,
    readFile,
    writeFile,
    readdir,
  };
}
