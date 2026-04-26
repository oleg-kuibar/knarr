import { useEffect, useRef, useCallback, useState } from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { useTerminal } from '../hooks/useTerminal';
import { useTerminalContext } from '../contexts/TerminalContext';
import type { BootStatus } from '../hooks/useWebContainer';

interface TerminalProps {
  status: BootStatus;
  spawnShell: (
    onData: (data: string) => void,
    onExit?: () => void
  ) => Promise<{
    write: (data: string) => void;
    kill: () => void;
  } | null>;
}

interface TerminalTab {
  id: number;
  name: string;
}

let terminalIdCounter = 0;

export function Terminal({ status, spawnShell }: TerminalProps) {
  const [tabs, setTabs] = useState<TerminalTab[]>([{ id: 0, name: 'Terminal 1' }]);
  const [activeTabId, setActiveTabId] = useState(0);
  const shellWritersRef = useRef<Map<number, (data: string) => void>>(new Map());
  const { registerShell, registerNewTabHandler } = useTerminalContext();

  // Register shell writer for a tab
  const registerTabShell = useCallback((tabId: number, write: (data: string) => void) => {
    shellWritersRef.current.set(tabId, write);
    // If this is the active tab, register it with context
    if (tabId === activeTabId) {
      registerShell(write);
    }
  }, [activeTabId, registerShell]);

  // Unregister shell writer for a tab
  const unregisterTabShell = useCallback((tabId: number) => {
    shellWritersRef.current.delete(tabId);
  }, []);

  // When active tab changes, update the context with the new shell
  useEffect(() => {
    const writer = shellWritersRef.current.get(activeTabId);
    if (writer) {
      registerShell(writer);
    }
  }, [activeTabId, registerShell]);

  const addTab = useCallback(() => {
    terminalIdCounter++;
    const newTab: TerminalTab = {
      id: terminalIdCounter,
      name: `Terminal ${terminalIdCounter + 1}`,
    };
    setTabs(prev => [...prev, newTab]);
    setActiveTabId(newTab.id);
  }, []);

  // Let TerminalContext trigger new tab creation (used by Tutorial)
  useEffect(() => {
    registerNewTabHandler(addTab);
  }, [addTab, registerNewTabHandler]);

  const closeTab = useCallback((tabId: number, e: React.MouseEvent) => {
    e.stopPropagation();

    setTabs(prev => {
      const newTabs = prev.filter(t => t.id !== tabId);
      if (newTabs.length === 0) {
        // Always keep at least one terminal
        terminalIdCounter++;
        const newTab = { id: terminalIdCounter, name: `Terminal ${terminalIdCounter + 1}` };
        setActiveTabId(newTab.id);
        return [newTab];
      }
      // Switch to another tab if closing active
      if (activeTabId === tabId) {
        setActiveTabId(newTabs[newTabs.length - 1].id);
      }
      return newTabs;
    });

    // Clean up shell writer
    unregisterTabShell(tabId);
  }, [activeTabId, unregisterTabShell]);

  return (
    <div className="h-full flex flex-col">
      {/* Tab bar */}
      <div className="flex items-center bg-bg-elevated border-b border-border text-xs">
        <div className="flex items-center overflow-x-auto flex-1">
          <LayoutGroup>
            {tabs.map((tab) => (
              <motion.button
                key={tab.id}
                layout
                layoutId={`term-tab-${tab.id}`}
                onClick={() => setActiveTabId(tab.id)}
                className={`
                  group flex items-center gap-1.5 px-3 py-2 border-r border-border
                  transition-colors shrink-0
                  ${activeTabId === tab.id
                    ? 'bg-bg text-text border-b-2 border-b-accent -mb-px'
                    : 'text-text-muted hover:text-text hover:bg-bg-subtle'
                  }
                `}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="opacity-60">
                  <polyline points="4 17 10 11 4 5" />
                  <line x1="12" y1="19" x2="20" y2="19" />
                </svg>
                <span>{tab.name}</span>
                {tabs.length > 1 && (
                  <span
                    role="button"
                    tabIndex={0}
                    onClick={(e) => closeTab(tab.id, e)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        closeTab(tab.id, e as unknown as React.MouseEvent);
                      }
                    }}
                    className={`
                      ml-1 w-4 h-4 flex items-center justify-center rounded
                      hover:bg-danger/20 hover:text-danger
                      ${activeTabId === tab.id ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                      transition-opacity
                    `}
                    aria-label={`Close ${tab.name}`}
                  >
                    {'\u00D7'}
                  </span>
                )}
              </motion.button>
            ))}
          </LayoutGroup>
        </div>
        <button
          onClick={addTab}
          className="px-3 py-2 text-text-muted hover:text-text hover:bg-bg-subtle transition-colors"
          title="New Terminal"
          aria-label="New terminal"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
        </button>
      </div>

      {/* Terminal instances */}
      <div className="flex-1 relative">
        {tabs.map((tab) => (
          <TerminalInstance
            key={tab.id}
            tabId={tab.id}
            status={status}
            spawnShell={spawnShell}
            isActive={activeTabId === tab.id}
            isFirst={tab.id === 0}
            onShellReady={registerTabShell}
            onShellExit={unregisterTabShell}
          />
        ))}
      </div>
    </div>
  );
}

interface TerminalInstanceProps {
  tabId: number;
  status: BootStatus;
  spawnShell: (
    onData: (data: string) => void,
    onExit?: () => void
  ) => Promise<{
    write: (data: string) => void;
    kill: () => void;
  } | null>;
  isActive: boolean;
  isFirst: boolean;
  onShellReady: (tabId: number, write: (data: string) => void) => void;
  onShellExit: (tabId: number) => void;
}

function TerminalInstance({ tabId, status, spawnShell, isActive, isFirst, onShellReady, onShellExit }: TerminalInstanceProps) {
  const shellRef = useRef<{ write: (data: string) => void; kill: () => void } | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const hasConnectedRef = useRef(false);
  const { setShellConnected, notifyOutput } = useTerminalContext();

  const handleUserInput = useCallback((data: string) => {
    if (shellRef.current) {
      shellRef.current.write(data);
    }
  }, []);

  const { terminalRef, write, fit } = useTerminal({
    onData: handleUserInput,
  });

  useEffect(() => {
    if (status !== 'ready' || hasConnectedRef.current) return;

    let mounted = true;

    async function connectShell() {
      write('\r\n\x1b[33mConnecting to shell...\x1b[0m\r\n');

      const shell = await spawnShell(
        (data) => {
          if (mounted) {
            write(data);
            notifyOutput(data);
          }
        },
        () => {
          if (mounted) {
            write('\r\n\x1b[31mShell disconnected. Refresh to reconnect.\x1b[0m\r\n');
            setIsConnected(false);
            onShellExit(tabId);
            if (isFirst) {
              setShellConnected(false);
            }
          }
        }
      );

      if (shell && mounted) {
        shellRef.current = shell;
        hasConnectedRef.current = true;
        setIsConnected(true);

        // Register this terminal's shell writer
        onShellReady(tabId, shell.write);

        if (isFirst) {
          setShellConnected(true);
        }

        // Show ASCII welcome banner only on first terminal
        if (isFirst) {
          write('\r\n');
          write('\x1b[1;33m  ██████╗ ██╗     ██╗   ██╗███╗   ██╗██╗  ██╗\x1b[0m\r\n');
          write('\x1b[1;33m  ██╔══██╗██║     ██║   ██║████╗  ██║██║ ██╔╝\x1b[0m\r\n');
          write('\x1b[1;33m  ██████╔╝██║     ██║   ██║██╔██╗ ██║█████╔╝ \x1b[0m\r\n');
          write('\x1b[1;33m  ██╔═══╝ ██║     ██║   ██║██║╚██╗██║██╔═██╗ \x1b[0m\r\n');
          write('\x1b[1;33m  ██║     ███████╗╚██████╔╝██║ ╚████║██║  ██╗\x1b[0m\r\n');
          write('\x1b[1;33m  ╚═╝     ╚══════╝ ╚═════╝ ╚═╝  ╚═══╝╚═╝  ╚═╝\x1b[0m\r\n');
          write('\r\n');
          write('\x1b[36m  📦 Local package development playground\x1b[0m\r\n');
          write('\x1b[90m  Run "npx knarr --help" to get started\x1b[0m\r\n\r\n');
        } else {
          write('\x1b[32m✓ Shell connected\x1b[0m\r\n\r\n');
        }
      }
    }

    connectShell();

    return () => {
      mounted = false;
    };
  }, [status, spawnShell, write, setShellConnected, notifyOutput, isFirst, tabId, onShellReady, onShellExit]);

  // Cleanup shell on unmount
  useEffect(() => {
    return () => {
      if (shellRef.current) {
        shellRef.current.kill();
        shellRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    const container = terminalRef.current;
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      if (isActive) {
        fit();
      }
    });

    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
    };
  }, [fit, terminalRef, isActive]);

  // Fit terminal when becoming active
  useEffect(() => {
    if (isActive) {
      // Small delay to ensure DOM is ready
      const timer = setTimeout(() => fit(), 50);
      return () => clearTimeout(timer);
    }
  }, [isActive, fit]);

  // Show boot status only on first terminal
  useEffect(() => {
    if (!isFirst) return;

    if (status === 'booting') {
      write('\x1b[36mBooting WebContainer...\x1b[0m\r\n');
    } else if (status === 'mounting') {
      write('\x1b[36mMounting file system...\x1b[0m\r\n');
    } else if (status === 'installing') {
      write('\x1b[36mInstalling KNARR CLI...\x1b[0m\r\n');
    } else if (status === 'ready' && !isConnected && !hasConnectedRef.current) {
      write('\x1b[32m\u2713 Environment ready!\x1b[0m\r\n');
    }
  }, [status, isConnected, write, isFirst]);

  return (
    <div
      ref={terminalRef}
      className={`absolute inset-0 bg-bg overflow-hidden ${isActive ? 'visible' : 'invisible'}`}
      role="application"
      aria-label="Terminal"
      aria-hidden={!isActive}
    />
  );
}
