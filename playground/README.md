# Knarr Playground

Interactive browser-based playground for demonstrating Knarr's package development workflow.

## Features

- **WebContainers**: Full Node.js environment running in the browser
- **Monaco Editor**: VS Code-like editing experience
- **xterm.js Terminal**: Real shell with Knarr CLI
- **Live Preview**: See your changes with HMR

## Development

```bash
# Install dependencies
pnpm install

# Start dev server
pnpm dev

# Build for production
pnpm build
```

## Browser Support

| Browser | Support |
|---------|---------|
| Chrome  | Full    |
| Edge    | Full    |
| Firefox | Full    |
| Safari  | None (SharedArrayBuffer) |

## Deployment

The playground is configured for Vercel deployment with required CORS headers for WebContainers.

```bash
vercel deploy
```

## How It Works

1. **Boot**: WebContainer boots a lightweight Node.js environment (~3s)
2. **Mount**: Template files are mounted to the virtual filesystem
3. **Install**: Knarr CLI is installed globally from npm
4. **Shell**: jsh shell is spawned for terminal interaction
5. **Preview**: Vite dev server URL is captured and displayed in iframe
