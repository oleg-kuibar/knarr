import type { FileSystemTree } from '@webcontainer/api';

// Fun adjective-noun combinations for terminal prompt
const ADJECTIVES = [
  'happy', 'swift', 'cosmic', 'fuzzy', 'mighty', 'turbo', 'ultra', 'mega',
  'hyper', 'super', 'epic', 'dapper', 'snappy', 'zippy', 'groovy', 'funky',
  'clever', 'blazing', 'stellar', 'nimble', 'witty', 'zesty', 'plucky', 'jolly',
];

const NOUNS = [
  'panda', 'rocket', 'phoenix', 'koala', 'dragon', 'falcon', 'tiger', 'penguin',
  'otter', 'fox', 'owl', 'badger', 'dolphin', 'hawk', 'wolf', 'lynx',
  'raven', 'falcon', 'bear', 'moose', 'rabbit', 'heron', 'crane', 'finch',
];

function generateFunnyName(): string {
  const adj = ADJECTIVES[Math.floor(Math.random() * ADJECTIVES.length)];
  const noun = NOUNS[Math.floor(Math.random() * NOUNS.length)];
  return `${adj}-${noun}`;
}

// Store the name in sessionStorage to keep it consistent across HMR reloads
function getOrCreatePlaygroundName(): string {
  if (typeof window !== 'undefined' && window.sessionStorage) {
    const stored = sessionStorage.getItem('KNARR-playground-name');
    if (stored) return stored;
    const name = generateFunnyName();
    sessionStorage.setItem('KNARR-playground-name', name);
    return name;
  }
  return generateFunnyName();
}

// Generate a consistent name for this session (stable across HMR)
export const PLAYGROUND_NAME = getOrCreatePlaygroundName();

export function createBasicTemplate(KNARRVersion: string): FileSystemTree {
  return {
  'package.json': {
    file: {
      contents: JSON.stringify(
        {
          name: 'KNARR-playground-workspace',
          private: true,
          scripts: {
            'publish:all': 'cd packages/api-client && npx -y knarr publish && cd ../ui-kit && npx -y knarr publish',
            'link:all': 'cd consumer-app && npx -y knarr add @example/api-client && npx -y knarr add @example/ui-kit',
            'start': 'cd consumer-app && npm run dev',
            'build:api': 'cd packages/api-client && npm run build',
            'build:ui': 'cd packages/ui-kit && npm run build',
            'push:api': 'cd packages/api-client && npm run build && npx -y knarr push',
            'push:ui': 'cd packages/ui-kit && npm run build && npx -y knarr push',
          },
          devDependencies: {
            'knarr': KNARRVersion,
          },
        },
        null,
        2
      ),
    },
  },
  packages: {
    directory: {
      'api-client': {
        directory: {
          'package.json': {
            file: {
              contents: JSON.stringify(
                {
                  name: '@example/api-client',
                  version: '1.0.0',
                  type: 'module',
                  main: './dist/index.js',
                  types: './dist/index.d.ts',
                  exports: {
                    '.': {
                      import: './dist/index.js',
                      types: './dist/index.d.ts',
                    },
                  },
                  files: ['dist'],
                  scripts: {
                    build: 'tsc',
                    dev: 'tsc --watch',
                  },
                  devDependencies: {
                    typescript: '^5.7.0',
                  },
                },
                null,
                2
              ),
            },
          },
          'tsconfig.json': {
            file: {
              contents: JSON.stringify(
                {
                  compilerOptions: {
                    target: 'ES2020',
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    declaration: true,
                    outDir: './dist',
                    strict: true,
                    skipLibCheck: true,
                  },
                  include: ['src'],
                },
                null,
                2
              ),
            },
          },
          src: {
            directory: {
              'index.ts': {
                file: {
                  contents: `// @example/api-client - A simple API client package

export interface User {
  id: number;
  name: string;
  email: string;
}

export interface ApiResponse<T> {
  data: T;
  status: 'success' | 'error';
  timestamp: string;
}

// Simulated API delay
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Mock user database
export const users: User[] = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@example.com' },
];

/**
 * Fetch a user by ID
 * Try changing the greeting message and run .knarr push\` to see HMR!
 */
export async function getUser(id: number): Promise<ApiResponse<User | null>> {
  await delay(100);
  const user = users.find(u => u.id === id) || null;
  return {
    data: user,
    status: user ? 'success' : 'error',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Fetch all users
 */
export async function getUsers(): Promise<ApiResponse<User[]>> {
  await delay(150);
  return {
    data: users,
    status: 'success',
    timestamp: new Date().toISOString(),
  };
}

/**
 * Get a greeting message for a user
 * ✨ Edit this function and run .knarr push\` to see live updates!
 */
export function getGreeting(user: User): string {
  return \`Hello, \${user.name}! Welcome to the KNARR Playground.\`;
}

export const VERSION = '1.0.0';
`,
                },
              },
            },
          },
          dist: {
            directory: {
              'index.js': {
                file: {
                  contents: `// @example/api-client - A simple API client package
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export const users = [
  { id: 1, name: 'Alice Johnson', email: 'alice@example.com' },
  { id: 2, name: 'Bob Smith', email: 'bob@example.com' },
  { id: 3, name: 'Charlie Brown', email: 'charlie@example.com' },
];

export async function getUser(id) {
  await delay(100);
  const user = users.find(u => u.id === id) || null;
  return {
    data: user,
    status: user ? 'success' : 'error',
    timestamp: new Date().toISOString(),
  };
}

export async function getUsers() {
  await delay(150);
  return {
    data: users,
    status: 'success',
    timestamp: new Date().toISOString(),
  };
}

export function getGreeting(user) {
  return \`Hello, \${user.name}! Welcome to the KNARR Playground.\`;
}

export const VERSION = '1.0.0';
`,
                },
              },
              'index.d.ts': {
                file: {
                  contents: `export interface User {
  id: number;
  name: string;
  email: string;
}

export interface ApiResponse<T> {
  data: T;
  status: 'success' | 'error';
  timestamp: string;
}

export declare const users: User[];
export declare function getUser(id: number): Promise<ApiResponse<User | null>>;
export declare function getUsers(): Promise<ApiResponse<User[]>>;
export declare function getGreeting(user: User): string;
export declare const VERSION: string;
`,
                },
              },
            },
          },
        },
      },
      'ui-kit': {
        directory: {
          'package.json': {
            file: {
              contents: JSON.stringify(
                {
                  name: '@example/ui-kit',
                  version: '1.0.0',
                  type: 'module',
                  main: './dist/index.js',
                  types: './dist/index.d.ts',
                  exports: {
                    '.': {
                      import: './dist/index.js',
                      types: './dist/index.d.ts',
                    },
                  },
                  files: ['dist'],
                  scripts: {
                    build: 'tsc',
                    dev: 'tsc --watch',
                  },
                  peerDependencies: {
                    react: '^18.0.0',
                  },
                  devDependencies: {
                    '@types/react': '^18.3.0',
                    typescript: '^5.7.0',
                  },
                },
                null,
                2
              ),
            },
          },
          'tsconfig.json': {
            file: {
              contents: JSON.stringify(
                {
                  compilerOptions: {
                    target: 'ES2020',
                    module: 'ESNext',
                    moduleResolution: 'bundler',
                    declaration: true,
                    outDir: './dist',
                    strict: true,
                    skipLibCheck: true,
                    jsx: 'react',
                  },
                  include: ['src'],
                },
                null,
                2
              ),
            },
          },
          src: {
            directory: {
              'index.tsx': {
                file: {
                  contents: `// @example/ui-kit - React component library

import React from 'react';

export interface CardProps {
  title?: string;
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning';
}

/**
 * Card with left-border accent.
 * Try changing the borderColor and run .knarr push\`!
 */
export function Card({ title, children, variant = 'default' }: CardProps) {
  const variantStyles = {
    default: { borderColor: '#30363d', background: '#161b22' },
    success: { borderColor: '#3fb950', background: '#0d1117' },
    warning: { borderColor: '#d29922', background: '#0d1117' },
  };

  const styles = variantStyles[variant];

  return (
    <div
      style={{
        border: \`1px solid \${styles.borderColor}\`,
        borderRadius: '8px',
        padding: '16px',
        backgroundColor: styles.background,
        marginBottom: '12px',
      }}
    >
      {title && (
        <h3 style={{
          margin: '0 0 12px 0',
          color: '#c9d1d9',
          fontSize: '16px',
        }}>
          {title}
        </h3>
      )}
      <div style={{ color: '#8b949e' }}>{children}</div>
    </div>
  );
}

export interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
}: ButtonProps) {
  const base: React.CSSProperties = {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'all 0.2s',
    opacity: disabled ? 0.5 : 1,
  };

  const variants: Record<string, React.CSSProperties> = {
    primary: {
      backgroundColor: '#238636',
      color: '#ffffff',
    },
    secondary: {
      backgroundColor: '#21262d',
      color: '#c9d1d9',
      border: '1px solid #30363d',
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      style={{ ...base, ...variants[variant] }}
    >
      {children}
    </button>
  );
}

export interface BadgeProps {
  children: React.ReactNode;
  color?: 'blue' | 'green' | 'yellow' | 'red';
}

export function Badge({ children, color = 'blue' }: BadgeProps) {
  const palettes = {
    blue: { bg: '#388bfd26', text: '#58a6ff' },
    green: { bg: '#2ea04326', text: '#3fb950' },
    yellow: { bg: '#bb800926', text: '#d29922' },
    red: { bg: '#f8514926', text: '#f85149' },
  };

  const { bg, text } = palettes[color];

  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '12px',
        backgroundColor: bg,
        color: text,
        fontSize: '12px',
        fontWeight: 500,
      }}
    >
      {children}
    </span>
  );
}

export const UI_VERSION = '1.0.0';
`,
                },
              },
            },
          },
          dist: {
            directory: {
              'index.js': {
                file: {
                  contents: `// @example/ui-kit - React component library
import React from 'react';

export function Card({ title, children, variant = 'default' }) {
  const variantStyles = {
    default: { borderColor: '#30363d', background: '#161b22' },
    success: { borderColor: '#3fb950', background: '#0d1117' },
    warning: { borderColor: '#d29922', background: '#0d1117' },
  };

  const styles = variantStyles[variant];

  return React.createElement(
    'div',
    {
      style: {
        border: \`1px solid \${styles.borderColor}\`,
        borderRadius: '8px',
        padding: '16px',
        backgroundColor: styles.background,
        marginBottom: '12px',
      },
    },
    title && React.createElement(
      'h3',
      { style: { margin: '0 0 12px 0', color: '#c9d1d9', fontSize: '16px' } },
      title
    ),
    React.createElement('div', { style: { color: '#8b949e' } }, children)
  );
}

export function Button({
  children,
  onClick,
  variant = 'primary',
  disabled = false,
}) {
  const base = {
    padding: '8px 16px',
    borderRadius: '6px',
    border: 'none',
    cursor: disabled ? 'not-allowed' : 'pointer',
    fontSize: '14px',
    fontWeight: 500,
    transition: 'all 0.2s',
    opacity: disabled ? 0.5 : 1,
  };

  const variants = {
    primary: {
      backgroundColor: '#238636',
      color: '#ffffff',
    },
    secondary: {
      backgroundColor: '#21262d',
      color: '#c9d1d9',
      border: '1px solid #30363d',
    },
  };

  return React.createElement(
    'button',
    {
      onClick,
      disabled,
      style: { ...base, ...variants[variant] },
    },
    children
  );
}

export function Badge({ children, color = 'blue' }) {
  const palettes = {
    blue: { bg: '#388bfd26', text: '#58a6ff' },
    green: { bg: '#2ea04326', text: '#3fb950' },
    yellow: { bg: '#bb800926', text: '#d29922' },
    red: { bg: '#f8514926', text: '#f85149' },
  };

  const { bg, text } = palettes[color];

  return React.createElement(
    'span',
    {
      style: {
        display: 'inline-block',
        padding: '2px 8px',
        borderRadius: '12px',
        backgroundColor: bg,
        color: text,
        fontSize: '12px',
        fontWeight: 500,
      },
    },
    children
  );
}

export const UI_VERSION = '1.0.0';
`,
                },
              },
              'index.d.ts': {
                file: {
                  contents: `import React from 'react';

export interface CardProps {
  title?: string;
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning';
}

export declare function Card(props: CardProps): React.ReactElement;

export interface ButtonProps {
  children: React.ReactNode;
  onClick?: () => void;
  variant?: 'primary' | 'secondary';
  disabled?: boolean;
}

export declare function Button(props: ButtonProps): React.ReactElement;

export interface BadgeProps {
  children: React.ReactNode;
  color?: 'blue' | 'green' | 'yellow' | 'red';
}

export declare function Badge(props: BadgeProps): React.ReactElement;

export declare const UI_VERSION: string;
`,
                },
              },
            },
          },
        },
      },
    },
  },
  'consumer-app': {
    directory: {
      'package.json': {
        file: {
          contents: JSON.stringify(
            {
              name: 'consumer-app',
              private: true,
              version: '0.0.0',
              type: 'module',
              scripts: {
                dev: 'vite',
                build: 'vite build',
                preview: 'vite preview',
              },
              dependencies: {
                react: '^18.3.1',
                'react-dom': '^18.3.1',
              },
              // @example packages are linked via KNARR, not installed from npm
              optionalDependencies: {
                '@example/api-client': '*',
                '@example/ui-kit': '*',
              },
              devDependencies: {
                'knarr': '*',
                '@types/react': '^18.3.0',
                '@types/react-dom': '^18.3.0',
                '@vitejs/plugin-react': '^4.3.0',
                vite: '^6.0.0',
              },
            },
            null,
            2
          ),
        },
      },
      'vite.config.js': {
        file: {
          contents: `import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import KNARRPlugin from 'knarr/vite';

export default defineConfig({
  plugins: [react(), KNARRPlugin()],
  server: {
    port: 3000,
    host: true,
  },
  resolve: {
    preserveSymlinks: true,
  },
});
`,
        },
      },
      'index.html': {
        file: {
          contents: `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Consumer App</title>
    <style>
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
      body {
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        background: #0d1117;
        color: #c9d1d9;
        min-height: 100vh;
        -webkit-font-smoothing: antialiased;
      }
      #root { padding: 28px 24px; max-width: 600px; }
      code, .mono { font-family: 'SF Mono', 'Cascadia Code', 'Fira Mono', 'Consolas', monospace; }
    </style>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="/src/main.jsx"></script>
  </body>
</html>
`,
        },
      },
      src: {
        directory: {
          'main.jsx': {
            file: {
              contents: `import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
`,
            },
          },
          'App.jsx': {
            file: {
              contents: `import React from 'react';
import { users, getGreeting, VERSION } from '@example/api-client';
import { Card, Button, Badge, UI_VERSION } from '@example/ui-kit';

function App() {
  const greeting = users.length > 0 ? getGreeting(users[0]) : '';

  return (
    <div>
      <h1 style={{ marginBottom: '8px', color: '#58a6ff' }}>
        KNARR Demo App
      </h1>
      <p style={{ color: '#8b949e', marginBottom: '24px' }}>
        Using @example/api-client v{VERSION} and @example/ui-kit v{UI_VERSION}
      </p>

      {greeting && (
        <Card title="Welcome Message" variant="success">
          <p style={{ fontSize: '16px' }}>{greeting}</p>
          <p style={{ marginTop: '8px', fontSize: '12px', color: '#8b949e' }}>
            Edit packages/api-client/src/index.ts and run <code>knarr push</code> to update this!
          </p>
        </Card>
      )}

      <Card title="Users from API">
        {users.map(user => (
          <div key={user.id} style={{
            display: 'flex',
            alignItems: 'center',
            gap: '12px',
            padding: '8px 0',
            borderBottom: '1px solid #21262d',
          }}>
            <Badge color={user.id === 1 ? 'green' : user.id === 2 ? 'blue' : 'yellow'}>
              #{user.id}
            </Badge>
            <div>
              <div style={{ fontWeight: 500, color: '#c9d1d9' }}>{user.name}</div>
              <div style={{ fontSize: '12px', color: '#8b949e' }}>{user.email}</div>
            </div>
          </div>
        ))}
      </Card>

      <div style={{ display: 'flex', gap: '12px', marginTop: '20px' }}>
        <Button onClick={() => window.location.reload()}>
          Refresh App
        </Button>
        <Button variant="secondary" onClick={() => alert('UI Kit button works!')}>
          Test Button
        </Button>
      </div>
    </div>
  );
}

export default App;
`,
            },
          },
        },
      },
    },
  },
};
}
