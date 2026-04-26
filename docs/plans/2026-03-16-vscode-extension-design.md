# VSCode Extension Design: Knarr Status & Visualization

## Overview

Read-only VSCode extension that shows linked package status in the sidebar and a dependency graph in a WebView panel. Lives in `packages/vscode-extension/` within the Knarr monorepo.

## Architecture

### Extension Structure

```
packages/vscode-extension/
├── package.json          # Extension manifest
├── tsconfig.json
├── esbuild.config.mjs
├── src/
│   ├── extension.ts      # activate() / deactivate()
│   ├── state-watcher.ts  # FileSystemWatcher + EventEmitter
│   ├── tree/
│   │   ├── provider.ts   # TreeDataProvider for sidebar
│   │   └── items.ts      # TreeItem classes
│   ├── graph/
│   │   ├── panel.ts      # WebView panel lifecycle
│   │   └── webview/
│   │       ├── index.html
│   │       ├── graph.ts  # ELK.js layout
│   │       └── styles.css
│   └── types.ts          # ConsumerState, KnarrMeta type declarations
└── resources/
    └── icons/
```

### Activation

`workspaceContains:.knarr/state.json` -- only activates in Knarr consumer projects.

## Sidebar Tree View

Hierarchy rooted at "Knarr Packages":

```
Knarr PACKAGES
├── @my-org/ui-kit @ 1.2.3
│   ├── Source: ~/monorepo/packages/ui-kit
│   ├── Linked: 2 min ago
│   ├── Build: abc12345
│   └── Backup: ✓
├── api-client @ 2.0.0
│   ├── Source: ~/monorepo/packages/api-client
│   ├── Linked: 5 min ago
│   ├── Build: def67890
│   └── Backup: ✗
```

- Data source: `.knarr/state.json` from workspace root
- Each key in `links` becomes a top-level node; metadata fields become children
- Refresh: `FileSystemWatcher` on `.knarr/state.json` triggers `TreeDataProvider.refresh()`
- Relative timestamps ("2 min ago") updated on refresh
- Backup status indicator (checkmark / x)

## Dependency Graph WebView

Opened via command palette: `knarr: Show Dependency Graph`.

- **Node types**: Library nodes (circles) and consumer nodes (rectangles)
- **Edges**: Library -> consumer, based on `~/.knarr/consumers.json`
- **Layout**: ELK.js (layered/hierarchical)
- **Interactions**: Hover for tooltip, click to highlight connections, zoom/pan
- **Data**: consumers.json for edges, each consumer's state.json for metadata
- **Styling**: Respects active VSCode theme via CSS variables
- **Refresh**: Toolbar button + auto-refresh on consumers.json change

## State Watcher

Shared data layer for tree and graph:

```typescript
class KnarrStateWatcher extends EventEmitter {
  // Watches:
  // 1. <workspace>/.knarr/state.json
  // 2. ~/.knarr/consumers.json
  // 3. ~/.knarr/store/*/.knarr-meta.json

  // Events:
  //   'state-changed'     -> tree refresh
  //   'consumers-changed' -> graph refresh
  //   'store-changed'     -> both
}
```

- Async file reads via `vscode.workspace.fs.readFile`
- Malformed JSON silently ignored (stale data persists until next valid write)
- 200ms debounce on file change events
- KNARR_HOME: reads from workspace env settings or falls back to `~/.knarr/`

## Build & Packaging

- Bundler: esbuild
- Output: `dist/extension.js` (CJS) + `dist/webview/` (graph panel assets)
- Runtime deps: ELK.js only (bundled)
- Standalone package.json, not coupled to Knarr's build
- `.vscodeignore`: excludes src/, node_modules/, keeps dist/ and resources/

## Data Sources

| File | Path | Purpose |
|---|---|---|
| Consumer State | `<workspace>/.knarr/state.json` | Linked packages, versions, timestamps |
| Global Registry | `~/.knarr/consumers.json` | Package -> consumer edges for graph |
| Store Metadata | `~/.knarr/store/<pkg>@<v>/.knarr-meta.json` | Build info, content hashes |

## Decisions

- Read-only (no command execution)
- Native TreeView for sidebar (fast, familiar)
- WebView with ELK.js for graph (proper visualization)
- Event-driven refresh (no polling)
- Monorepo location: `packages/vscode-extension/`
