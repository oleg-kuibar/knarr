import { useState, useCallback } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { useTerminalContext } from '../contexts/TerminalContext';

interface ScriptItem {
  id: string;
  name: string;
  command: string;
}

interface ScriptGroup {
  label: string;
  scripts: ScriptItem[];
}

const SCRIPT_GROUPS: ScriptGroup[] = [
  {
    label: 'Setup',
    scripts: [
      { id: 'publish-all', name: 'publish:all', command: 'npm run publish:all' },
      { id: 'link-all', name: 'link:all', command: 'npm run link:all' },
      { id: 'start', name: 'start', command: 'npm run start' },
    ],
  },
  {
    label: 'Development',
    scripts: [
      { id: 'push-api', name: 'push:api', command: 'npm run push:api' },
      { id: 'push-ui', name: 'push:ui', command: 'npm run push:ui' },
      { id: 'watch-api', name: 'watch api-client', command: 'cd packages/api-client && npx -y knarr push --watch --build "npm run build"' },
      { id: 'watch-ui', name: 'watch ui-kit', command: 'cd packages/ui-kit && npx -y knarr push --watch --build "npm run build"' },
    ],
  },
  {
    label: 'KNARR',
    scripts: [
      { id: 'KNARR-list', name: 'list', command: 'npx -y knarr list' },
    ],
  },
];

const TOTAL_COUNT = SCRIPT_GROUPS.reduce((sum, g) => sum + g.scripts.length, 0);

interface ScriptsProps {
  readFile?: (path: string) => Promise<string | null>;
  readdir?: (path: string) => Promise<string[]>;
  isReady?: boolean;
}

export function Scripts(_props: ScriptsProps) {
  const [expanded, setExpanded] = useState(true);
  const [runningScript, setRunningScript] = useState<string | null>(null);
  const { executeCommand, isShellConnected } = useTerminalContext();

  const handleRunScript = useCallback((script: ScriptItem) => {
    if (!isShellConnected) return;

    setRunningScript(script.id);
    executeCommand(script.command);

    setTimeout(() => setRunningScript(null), 1500);
  }, [executeCommand, isShellConnected]);

  return (
    <div className="h-full flex flex-col bg-bg">
      {/* Header */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="flex items-center gap-2 px-3 py-2 border-b border-border text-[11px] font-semibold text-text-muted uppercase tracking-wider hover:bg-bg-subtle transition-colors w-full text-left"
      >
        <span
          className={`text-[10px] transition-transform ${expanded ? 'rotate-90' : ''}`}
        >
          {'\u25B6'}
        </span>
        Scripts
        <span className="ml-auto text-text-subtle font-normal normal-case">
          {TOTAL_COUNT}
        </span>
      </button>

      {/* Scripts list */}
      <AnimatePresence>
        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.15 }}
            className="flex-1 overflow-auto"
          >
            {SCRIPT_GROUPS.map((group, idx) => (
              <div key={group.label} className={`px-2 py-1.5 ${idx > 0 ? 'border-t border-border' : ''}`}>
                <div className="text-[9px] text-text-subtle uppercase tracking-wider px-1 mb-1">
                  {group.label}
                </div>
                {group.scripts.map((script) => (
                  <button
                    key={script.id}
                    onClick={() => handleRunScript(script)}
                    disabled={!isShellConnected}
                    className={`
                      w-full flex items-center gap-2 px-2 py-1.5 rounded text-left text-xs
                      transition-colors group
                      ${isShellConnected ? 'hover:bg-bg-subtle' : 'opacity-50 cursor-not-allowed'}
                      ${runningScript === script.id ? 'bg-success/10' : ''}
                    `}
                    title={script.command}
                  >
                    <span className="shrink-0 text-accent">
                      {runningScript === script.id ? '\u2713' : '\u25B6'}
                    </span>
                    <span className="truncate text-text-muted group-hover:text-text">
                      {script.name}
                    </span>
                  </button>
                ))}
              </div>
            ))}

            {!isShellConnected && (
              <div className="px-3 py-2 text-[10px] text-text-subtle italic">
                Connect to shell to run scripts
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
