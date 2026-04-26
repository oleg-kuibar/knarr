/// <reference types="vite/client" />

declare module 'virtual:local-KNARR' {
  import type { FileSystemTree } from '@webcontainer/api';
  const tree: FileSystemTree | null;
  export default tree;
}
