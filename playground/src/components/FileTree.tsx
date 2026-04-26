import { useState, useEffect, useCallback, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

interface FileTreeProps {
  readdir: (path: string) => Promise<string[]>;
  onFileSelect: (path: string) => void;
  selectedFile: string | null;
  isReady: boolean;
}

interface TreeNode {
  name: string;
  path: string;
  isDirectory: boolean;
  children?: TreeNode[];
  isExpanded?: boolean;
  isLoading?: boolean;
}

// Special folders that should be shown but styled differently
const SYSTEM_FOLDERS = ['node_modules', '.KNARR', '.vite', 'dist'];

// Hidden files/folders to always exclude (not useful for playground)
const HIDDEN_ENTRIES = [
  '.jshrc', '.bashrc', '.profile', '.npm', '.cache',
  '.bin', '.package-lock.json', '.modules.yaml',
  'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock',
  '.DS_Store', 'Thumbs.db',
];

// In node_modules, only show these relevant entries
const NODE_MODULES_ALLOWLIST = ['@example', '.KNARR'];

function FileIcon({ name, isDirectory }: { name: string; isDirectory: boolean }) {
  if (isDirectory) {
    // Special icons for system folders
    if (name === 'node_modules') {
      return <span className="mr-1.5 text-[10px] font-bold text-accent" aria-hidden="true">NM</span>;
    }
    if (name === '.KNARR') {
      return <span className="mr-1.5 text-[10px] font-bold text-success" aria-hidden="true">PK</span>;
    }
    if (name === '.vite') {
      return <span className="mr-1.5 text-[10px] font-bold text-secondary" aria-hidden="true">VT</span>;
    }
    if (name === 'dist') {
      return <span className="mr-1.5 text-[10px] font-bold text-warning" aria-hidden="true">D</span>;
    }
    return <span className="mr-1.5 text-text-muted" aria-hidden="true">{'\uD83D\uDCC1'}</span>;
  }

  if (name.endsWith('.ts') || name.endsWith('.tsx')) {
    return <span className="mr-1.5 text-[10px] font-bold text-[#3178c6]" aria-hidden="true">TS</span>;
  }
  if (name.endsWith('.js') || name.endsWith('.jsx')) {
    return <span className="mr-1.5 text-[10px] font-bold text-[#f7df1e]" aria-hidden="true">JS</span>;
  }
  if (name.endsWith('.json')) {
    return <span className="mr-1.5 text-[10px] font-bold text-warning" aria-hidden="true">{'{}'}</span>;
  }
  if (name.endsWith('.html')) {
    return <span className="mr-1.5 text-[10px] font-bold text-danger" aria-hidden="true">{'<>'}</span>;
  }
  if (name.endsWith('.css')) {
    return <span className="mr-1.5 text-[10px] font-bold text-secondary" aria-hidden="true">#</span>;
  }
  if (name.endsWith('.md')) {
    return <span className="mr-1.5 text-[10px] font-bold text-text-muted" aria-hidden="true">MD</span>;
  }

  return <span className="mr-1.5 text-text-subtle" aria-hidden="true">{'\uD83D\uDCC4'}</span>;
}

function TreeItem({
  node,
  depth,
  onToggle,
  onSelect,
  selectedPath,
  focusedPath,
  onFocus,
}: {
  node: TreeNode;
  depth: number;
  onToggle: (path: string) => void;
  onSelect: (path: string) => void;
  selectedPath: string | null;
  focusedPath: string | null;
  onFocus: (path: string) => void;
}) {
  const isSelected = selectedPath === node.path;
  const isFocused = focusedPath === node.path;
  const paddingLeft = 12 + depth * 14;
  const itemRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (isFocused && itemRef.current) {
      itemRef.current.focus();
    }
  }, [isFocused]);

  const handleClick = () => {
    onFocus(node.path);
    if (node.isDirectory) {
      onToggle(node.path);
    } else {
      onSelect(node.path);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleClick();
    }
  };

  return (
    <>
      <div
        ref={itemRef}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={node.isDirectory ? node.isExpanded : undefined}
        tabIndex={isFocused ? 0 : -1}
        onClick={handleClick}
        onKeyDown={handleKeyDown}
        onFocus={() => onFocus(node.path)}
        className={`
          flex items-center px-2 py-1 cursor-pointer text-[13px] transition-colors outline-none
          ${isSelected
            ? 'bg-secondary-muted text-secondary'
            : isFocused
            ? 'bg-bg-subtle text-text'
            : 'text-text hover:bg-bg-muted'
          }
        `}
        style={{ paddingLeft: `${paddingLeft}px` }}
      >
        {node.isDirectory && (
          <motion.span
            animate={{ rotate: node.isExpanded ? 90 : 0 }}
            transition={{ duration: 0.1 }}
            className="mr-1 text-[10px] text-text-subtle w-3 inline-block"
            aria-hidden="true"
          >
            {node.isLoading ? (
              <span className="animate-spin inline-block">{'\u25D0'}</span>
            ) : (
              '\u25B6'
            )}
          </motion.span>
        )}
        <FileIcon name={node.name} isDirectory={node.isDirectory} />
        <span className="overflow-hidden text-ellipsis whitespace-nowrap">
          {node.name}
        </span>
      </div>
      <AnimatePresence initial={false}>
        {node.isDirectory && node.isExpanded && node.children && (
          <motion.div
            role="group"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="overflow-hidden"
          >
            {node.children.map((child, idx) => (
              <motion.div
                key={child.path}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: idx * 0.03, duration: 0.15 }}
              >
                <TreeItem
                  node={child}
                  depth={depth + 1}
                  onToggle={onToggle}
                  onSelect={onSelect}
                  selectedPath={selectedPath}
                  focusedPath={focusedPath}
                  onFocus={onFocus}
                />
              </motion.div>
            ))}
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

export function FileTree({
  readdir,
  onFileSelect,
  selectedFile,
  isReady,
}: FileTreeProps) {
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [focusedPath, setFocusedPath] = useState<string | null>(null);

  useEffect(() => {
    if (!isReady) return;

    async function loadRoot() {
      setLoading(true);
      try {
        const entries = await readdir('/');
        const nodes: TreeNode[] = entries
          .filter((name) => {
            const cleanName = name.replace(/\/$/, '');
            // Always show system folders like .KNARR
            if (SYSTEM_FOLDERS.includes(cleanName)) return true;
            // Hide specific useless entries
            if (HIDDEN_ENTRIES.includes(cleanName)) return false;
            return true;
          })
          .map((name) => ({
            name: name.replace(/\/$/, ''),
            path: `/${name.replace(/\/$/, '')}`,
            isDirectory: name.endsWith('/'),
            isExpanded: false,
          }));

        // Sort: regular dirs first, then system dirs, then files
        nodes.sort((a, b) => {
          if (a.isDirectory !== b.isDirectory) {
            return a.isDirectory ? -1 : 1;
          }
          // Put system folders at the end of directories
          const aIsSystem = SYSTEM_FOLDERS.includes(a.name) || a.name.startsWith('.');
          const bIsSystem = SYSTEM_FOLDERS.includes(b.name) || b.name.startsWith('.');
          if (aIsSystem !== bIsSystem) {
            return aIsSystem ? 1 : -1;
          }
          return a.name.localeCompare(b.name);
        });

        setTree(nodes);
        // Focus first item
        if (nodes.length > 0) {
          setFocusedPath(nodes[0].path);
        }
      } catch (err) {
        console.error('Failed to load root directory:', err);
      } finally {
        setLoading(false);
      }
    }

    loadRoot();
  }, [isReady, readdir]);

  const toggleDirectory = useCallback(
    async (path: string) => {
      const replaceNode = (
        nodes: TreeNode[],
        targetPath: string,
        newNode: TreeNode
      ): TreeNode[] => {
        return nodes.map((node) => {
          if (node.path === targetPath) {
            return newNode;
          }
          if (node.children) {
            return { ...node, children: replaceNode(node.children, targetPath, newNode) };
          }
          return node;
        });
      };

      const updateNode = async (nodes: TreeNode[]): Promise<TreeNode[]> => {
        return Promise.all(
          nodes.map(async (node) => {
            if (node.path === path) {
              if (!node.isExpanded && !node.children) {
                const newNode = { ...node, isLoading: true };
                setTree((prev) => replaceNode(prev, path, newNode));

                try {
                  const entries = await readdir(path);
                  const isInNodeModules = path.includes('node_modules');
                  const children: TreeNode[] = entries
                    .filter((name) => {
                      const cleanName = name.replace(/\/$/, '');
                      // Inside node_modules, only show allowlisted entries
                      if (isInNodeModules && path.endsWith('node_modules')) {
                        return NODE_MODULES_ALLOWLIST.some(allowed =>
                          cleanName === allowed || cleanName.startsWith(allowed)
                        );
                      }
                      if (SYSTEM_FOLDERS.includes(cleanName)) return true;
                      if (HIDDEN_ENTRIES.includes(cleanName)) return false;
                      return true;
                    })
                    .map((name) => ({
                      name: name.replace(/\/$/, ''),
                      path: `${path}/${name.replace(/\/$/, '')}`,
                      isDirectory: name.endsWith('/'),
                      isExpanded: false,
                    }));

                  // Sort: regular dirs first, then system dirs, then files
                  children.sort((a, b) => {
                    if (a.isDirectory !== b.isDirectory) {
                      return a.isDirectory ? -1 : 1;
                    }
                    const aIsSystem = SYSTEM_FOLDERS.includes(a.name) || a.name.startsWith('.');
                    const bIsSystem = SYSTEM_FOLDERS.includes(b.name) || b.name.startsWith('.');
                    if (aIsSystem !== bIsSystem) {
                      return aIsSystem ? 1 : -1;
                    }
                    return a.name.localeCompare(b.name);
                  });

                  return {
                    ...node,
                    isExpanded: true,
                    isLoading: false,
                    children,
                  };
                } catch {
                  return { ...node, isLoading: false };
                }
              }
              return { ...node, isExpanded: !node.isExpanded };
            }
            if (node.children) {
              return { ...node, children: await updateNode(node.children) };
            }
            return node;
          })
        );
      };

      setTree(await updateNode(tree));
    },
    [tree, readdir]
  );

  const handleSelect = useCallback(
    (path: string) => {
      onFileSelect(path);
    },
    [onFileSelect]
  );

  const handleFocus = useCallback((path: string) => {
    setFocusedPath(path);
  }, []);

  if (!isReady) {
    return (
      <div className="p-4 text-text-muted text-sm text-center" role="status">
        <div className="animate-pulse">Waiting for environment...</div>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="p-4 text-text-muted text-sm text-center" role="status">
        <div className="animate-pulse">Loading files...</div>
      </div>
    );
  }

  if (tree.length === 0) {
    return (
      <div className="p-4 text-text-muted text-sm text-center">
        <p>No files found</p>
      </div>
    );
  }

  return (
    <div className="py-1" role="tree" aria-label="File explorer">
      {tree.map((node) => (
        <TreeItem
          key={node.path}
          node={node}
          depth={0}
          onToggle={toggleDirectory}
          onSelect={handleSelect}
          selectedPath={selectedFile}
          focusedPath={focusedPath}
          onFocus={handleFocus}
        />
      ))}
    </div>
  );
}
