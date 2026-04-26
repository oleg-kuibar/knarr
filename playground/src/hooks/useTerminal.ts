import { useEffect, useRef, useCallback } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';

export interface UseTerminalOptions {
  onData?: (data: string) => void;
}

export interface UseTerminalResult {
  terminalRef: React.RefObject<HTMLDivElement>;
  terminal: Terminal | null;
  write: (data: string) => void;
  clear: () => void;
  fit: () => void;
}

// GitHub-inspired terminal theme with amber cursor
const KNARRTerminalTheme = {
  background: '#0d1117',
  foreground: '#e6edf3',
  cursor: '#f59e0b',
  cursorAccent: '#0d1117',
  selectionBackground: '#58a6ff40',
  black: '#484f58',
  red: '#ff7b72',
  green: '#3fb950',
  yellow: '#d29922',
  blue: '#58a6ff',
  magenta: '#bc8cff',
  cyan: '#39c5cf',
  white: '#b1bac4',
  brightBlack: '#6e7681',
  brightRed: '#ffa198',
  brightGreen: '#56d364',
  brightYellow: '#e3b341',
  brightBlue: '#79c0ff',
  brightMagenta: '#d2a8ff',
  brightCyan: '#56d4dd',
  brightWhite: '#f0f6fc',
};

export function useTerminal(options: UseTerminalOptions = {}): UseTerminalResult {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstanceRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);

  useEffect(() => {
    if (!terminalRef.current) return;

    const terminal = new Terminal({
      theme: KNARRTerminalTheme,
      fontFamily: 'var(--font-mono)',
      fontSize: 13,
      lineHeight: 1.4,
      cursorBlink: true,
      cursorStyle: 'bar',
      allowProposedApi: true,
      rightClickSelectsWord: true,
    });

    // Enable copy on selection
    terminal.onSelectionChange(() => {
      const selection = terminal.getSelection();
      if (selection) {
        navigator.clipboard.writeText(selection).catch(() => {
          // Clipboard API may fail in some contexts
        });
      }
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    terminal.open(terminalRef.current);
    fitAddon.fit();

    terminalInstanceRef.current = terminal;
    fitAddonRef.current = fitAddon;

    if (options.onData) {
      terminal.onData(options.onData);
    }

    // Handle paste via Ctrl+V / Cmd+V
    terminal.attachCustomKeyEventHandler((event) => {
      // Allow Ctrl+V / Cmd+V for paste
      if ((event.ctrlKey || event.metaKey) && event.key === 'v' && event.type === 'keydown') {
        navigator.clipboard.readText().then((text) => {
          if (text && options.onData) {
            options.onData(text);
          }
        }).catch(() => {
          // Clipboard API may fail
        });
        return false; // Prevent default handling
      }
      // Allow Ctrl+C / Cmd+C for copy (handled by selection)
      if ((event.ctrlKey || event.metaKey) && event.key === 'c') {
        return false;
      }
      return true;
    });

    // Handle paste via context menu / right-click paste
    const handlePaste = (e: ClipboardEvent) => {
      e.preventDefault();
      const text = e.clipboardData?.getData('text');
      if (text && options.onData) {
        options.onData(text);
      }
    };

    terminalRef.current.addEventListener('paste', handlePaste);

    const handleResize = () => {
      fitAddon.fit();
    };

    window.addEventListener('resize', handleResize);
    const containerEl = terminalRef.current;

    return () => {
      window.removeEventListener('resize', handleResize);
      containerEl?.removeEventListener('paste', handlePaste);
      terminal.dispose();
      terminalInstanceRef.current = null;
      fitAddonRef.current = null;
    };
  }, [options.onData]);

  const write = useCallback((data: string) => {
    terminalInstanceRef.current?.write(data);
  }, []);

  const clear = useCallback(() => {
    terminalInstanceRef.current?.clear();
  }, []);

  const fit = useCallback(() => {
    fitAddonRef.current?.fit();
  }, []);

  return {
    terminalRef,
    terminal: terminalInstanceRef.current,
    write,
    clear,
    fit,
  };
}
