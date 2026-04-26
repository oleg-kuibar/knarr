import { useState, useCallback, useEffect, useRef } from 'react';
import { useTerminalContext } from '../contexts/TerminalContext';
import { Spinner } from './Loader';

interface PreviewProps {
  url: string | null;
}

const LOAD_TIMEOUT_MS = 30000;

type Viewport = 'responsive' | 'mobile' | 'tablet';

const VIEWPORTS: { id: Viewport; label: string; width: number | null; icon: string }[] = [
  { id: 'responsive', label: 'Responsive', width: null, icon: '\u2922' },
  { id: 'mobile', label: 'Mobile', width: 375, icon: '\u2706' },
  { id: 'tablet', label: 'Tablet', width: 768, icon: '\u2B1C' },
];

function IdleState() {
  const { executeCommand, isShellConnected } = useTerminalContext();
  const [isAutoStarting, setIsAutoStarting] = useState(false);

  const handleAutoStart = useCallback(() => {
    if (!isShellConnected || isAutoStarting) return;
    setIsAutoStarting(true);
    executeCommand('npm run publish:all && npm run link:all && npm run start');
  }, [executeCommand, isShellConnected, isAutoStarting]);

  return (
    <div className="flex flex-col items-center justify-center h-full text-center p-6 bg-bg">
      <div className="max-w-[260px] w-full space-y-4">
        <p className="text-sm text-text-subtle">No preview running</p>

        <button
          onClick={handleAutoStart}
          disabled={!isShellConnected || isAutoStarting}
          className={`
            w-full py-2.5 px-4 rounded-lg text-xs font-medium transition-all
            ${isShellConnected && !isAutoStarting
              ? 'bg-accent text-black hover:bg-accent/90'
              : 'bg-bg-muted text-text-muted cursor-not-allowed'
            }
          `}
        >
          {isAutoStarting ? 'Starting...' : 'Auto-start demo'}
        </button>

        <p className="text-[11px] text-text-subtle">
          Or use the <span className="text-accent">Tutorial</span> panel to go step by step
        </p>
      </div>
    </div>
  );
}

export function Preview({ url }: PreviewProps) {
  const [loadState, setLoadState] = useState<'idle' | 'loading' | 'loaded' | 'error'>('idle');
  const [key, setKey] = useState(0);
  const [viewport, setViewport] = useState<Viewport>('responsive');
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (url) {
      setLoadState('loading');
      timeoutRef.current = setTimeout(() => {
        setLoadState('error');
      }, LOAD_TIMEOUT_MS);

      return () => {
        if (timeoutRef.current) {
          clearTimeout(timeoutRef.current);
        }
      };
    } else {
      setLoadState('idle');
    }
  }, [url, key]);

  const handleLoad = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setLoadState('loaded');
  }, []);

  const handleError = useCallback(() => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setLoadState('error');
  }, []);

  const handleRefresh = useCallback(() => {
    setLoadState('loading');
    setKey((k) => k + 1);
  }, []);

  if (!url) {
    return <IdleState />;
  }

  const activeViewport = VIEWPORTS.find(v => v.id === viewport);
  const iframeMaxWidth = activeViewport?.width ? `${activeViewport.width}px` : undefined;

  return (
    <div className="h-full flex flex-col">
      {/* Preview header */}
      <div className="flex items-center gap-2 px-3 py-2 bg-bg-elevated border-b border-border text-xs">
        <span className="text-text font-medium">Preview</span>

        {/* Viewport toggle */}
        <div className="flex items-center gap-0.5 ml-2 bg-bg rounded px-1 py-0.5">
          {VIEWPORTS.map((vp) => (
            <button
              key={vp.id}
              onClick={() => setViewport(vp.id)}
              className={`
                px-1.5 py-0.5 rounded text-[10px] transition-colors
                ${viewport === vp.id
                  ? 'bg-bg-elevated text-accent font-medium'
                  : 'text-text-subtle hover:text-text-muted'
                }
              `}
              title={vp.label}
            >
              {vp.icon}
            </button>
          ))}
        </div>

        <div
          className="flex-1 mx-2 px-2 py-1 bg-bg border border-border rounded text-[11px] text-text-muted overflow-hidden text-ellipsis whitespace-nowrap"
          title={url}
        >
          {url}
        </div>
        <button
          onClick={handleRefresh}
          className="btn btn-ghost p-1.5"
          aria-label="Refresh preview"
          disabled={loadState === 'loading'}
        >
          <span
            className={loadState === 'loading' ? 'animate-spin inline-block' : ''}
            aria-hidden="true"
          >
            {'\u21BB'}
          </span>
        </button>
        <a
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="btn btn-ghost p-1.5"
          aria-label="Open preview in new tab"
        >
          <span aria-hidden="true">{'\u2197'}</span>
        </a>
      </div>

      {/* Preview iframe */}
      <div className="flex-1 relative bg-white flex justify-center">
        {loadState === 'loading' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg z-10 gap-3">
            <Spinner size={24} />
            <p className="text-text-muted text-sm">Starting dev server...</p>
          </div>
        )}

        {loadState === 'error' && (
          <div className="absolute inset-0 flex flex-col items-center justify-center bg-bg z-10">
            <div className="text-4xl mb-4" role="img" aria-label="Error">{'\u26A0\uFE0F'}</div>
            <p className="text-text-muted text-sm mb-4">Failed to load preview</p>
            <button onClick={handleRefresh} className="btn btn-primary text-sm">
              Retry
            </button>
          </div>
        )}

        <iframe
          key={key}
          src={url}
          onLoad={handleLoad}
          onError={handleError}
          className="h-full border-none transition-[max-width] duration-200"
          style={{
            width: '100%',
            maxWidth: iframeMaxWidth,
          }}
          title="App Preview"
          sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-modals"
        />
      </div>
    </div>
  );
}
