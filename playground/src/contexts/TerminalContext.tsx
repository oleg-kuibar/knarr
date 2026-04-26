import { createContext, useContext, useCallback, useRef, useState } from 'react';
import type { ReactNode } from 'react';

export type OutputListener = (data: string) => void;

interface TerminalContextValue {
  /** Write a command to the terminal (types it for the user, doesn't execute) */
  typeCommand: (command: string) => void;
  /** Execute a command (types + sends Enter). If sentinel is true, appends a sentinel echo. */
  executeCommand: (command: string, options?: { sentinel?: boolean }) => void;
  /** Open a new terminal tab and execute a command once the shell is ready */
  executeInNewTerminal: (command: string, options?: { sentinel?: boolean }) => void;
  /** Register the shell write function */
  registerShell: (write: (data: string) => void) => void;
  /** Register the handler that creates a new terminal tab */
  registerNewTabHandler: (handler: () => void) => void;
  /** Whether the shell is connected */
  isShellConnected: boolean;
  /** Set shell connection status */
  setShellConnected: (connected: boolean) => void;
  /** Register a listener for terminal output */
  addOutputListener: (id: string, cb: OutputListener) => void;
  /** Remove an output listener */
  removeOutputListener: (id: string) => void;
  /** Notify all listeners of terminal output (called by Terminal) */
  notifyOutput: (data: string) => void;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export const SENTINEL = '__KNARR_DONE__';

export function TerminalProvider({ children }: { children: ReactNode }) {
  const shellWriteRef = useRef<((data: string) => void) | null>(null);
  const [isShellConnected, setIsShellConnected] = useState(false);
  const newTabHandlerRef = useRef<(() => void) | null>(null);
  const shellReadyResolveRef = useRef<(() => void) | null>(null);
  const outputListenersRef = useRef<Map<string, OutputListener>>(new Map());

  const registerShell = useCallback((write: (data: string) => void) => {
    shellWriteRef.current = write;
    // Notify anyone waiting for a new shell to be ready
    if (shellReadyResolveRef.current) {
      shellReadyResolveRef.current();
      shellReadyResolveRef.current = null;
    }
  }, []);

  const typeCommand = useCallback((command: string) => {
    if (shellWriteRef.current) {
      // Type the command character by character for visual effect
      shellWriteRef.current(command);
    }
  }, []);

  const executeCommand = useCallback((command: string, options?: { sentinel?: boolean }) => {
    if (shellWriteRef.current) {
      const cmd = options?.sentinel ? `${command} ; echo ${SENTINEL}` : command;
      shellWriteRef.current(cmd + '\r');
    }
  }, []);

  const registerNewTabHandler = useCallback((handler: () => void) => {
    newTabHandlerRef.current = handler;
  }, []);

  const executeInNewTerminal = useCallback((command: string, options?: { sentinel?: boolean }) => {
    if (!newTabHandlerRef.current) return;

    // Set up a promise that resolves when the new shell registers
    const waitForShell = new Promise<void>((resolve) => {
      shellReadyResolveRef.current = resolve;
    });

    // Create the new tab (triggers shell spawn)
    newTabHandlerRef.current();

    // When the shell is ready, give it a moment to initialize, then execute
    waitForShell.then(() => {
      setTimeout(() => {
        if (shellWriteRef.current) {
          const cmd = options?.sentinel ? `${command} ; echo ${SENTINEL}` : command;
          shellWriteRef.current(cmd + '\r');
        }
      }, 500);
    });
  }, []);

  const setShellConnected = useCallback((connected: boolean) => {
    setIsShellConnected(connected);
  }, []);

  const addOutputListener = useCallback((id: string, cb: OutputListener) => {
    outputListenersRef.current.set(id, cb);
  }, []);

  const removeOutputListener = useCallback((id: string) => {
    outputListenersRef.current.delete(id);
  }, []);

  const notifyOutput = useCallback((data: string) => {
    for (const cb of outputListenersRef.current.values()) {
      cb(data);
    }
  }, []);

  return (
    <TerminalContext.Provider
      value={{
        typeCommand,
        executeCommand,
        executeInNewTerminal,
        registerShell,
        registerNewTabHandler,
        isShellConnected,
        setShellConnected,
        addOutputListener,
        removeOutputListener,
        notifyOutput,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminalContext() {
  const context = useContext(TerminalContext);
  if (!context) {
    throw new Error('useTerminalContext must be used within TerminalProvider');
  }
  return context;
}
