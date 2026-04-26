import { useState, useRef, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import type { BootStatus } from '../hooks/useWebContainer';

interface HeaderProps {
  saveStatus: 'idle' | 'saving' | 'saved';
  hasAnyDirty: boolean;
  status: BootStatus;
  onToggleSidebar?: () => void;
  onTogglePreview?: () => void;
  isSidebarCollapsed?: boolean;
  isPreviewCollapsed?: boolean;
}

function ConnectionDot({ status }: { status: BootStatus }) {
  const color = status === 'ready'
    ? 'bg-success'
    : status === 'error'
      ? 'bg-danger'
      : 'bg-accent';
  const label = status === 'ready'
    ? 'Connected'
    : status === 'error'
      ? 'Disconnected'
      : 'Connecting...';

  return (
    <span className="relative flex items-center" title={label}>
      <span className={`w-2 h-2 rounded-full ${color}`} />
      {status !== 'ready' && status !== 'error' && (
        <motion.span
          className={`absolute inset-0 w-2 h-2 rounded-full ${color}`}
          animate={{ scale: [1, 1.8, 1], opacity: [1, 0, 1] }}
          transition={{ duration: 1.5, repeat: Infinity }}
        />
      )}
    </span>
  );
}

function AboutPopover() {
  const [isOpen, setIsOpen] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isOpen) return;
    function handleClickOutside(e: MouseEvent) {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  return (
    <div className="relative" ref={popoverRef}>
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="btn btn-ghost p-1.5"
        aria-label="About KNARR"
        aria-expanded={isOpen}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <circle cx="8" cy="8" r="6.5" />
          <path d="M8 7v4" />
          <circle cx="8" cy="5" r="0.5" fill="currentColor" stroke="none" />
        </svg>
      </button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            initial={{ opacity: 0, y: -4, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.95 }}
            transition={{ duration: 0.15 }}
            className="absolute right-0 top-full mt-2 w-72 bg-bg-elevated border border-border rounded-lg shadow-2xl z-50 overflow-hidden"
          >
            <div className="p-4 border-b border-border">
              <div className="flex items-center gap-2 mb-2">
                <img src="/KNARR_logo.png" alt="" className="w-6 h-6 rounded-full object-cover" />
                <span className="font-semibold text-text text-sm">KNARR</span>
              </div>
              <p className="text-xs text-text-muted leading-relaxed">
                Local npm package development without symlinks. Copies built files into consumer <code className="text-accent">node_modules/</code> with incremental sync and watch mode.
              </p>
            </div>

            <div className="p-4 space-y-2">
              <p className="text-[10px] text-text-subtle uppercase tracking-wider font-semibold mb-2">Key concepts</p>
              {[
                { name: 'Store', desc: 'Mutable package cache at ~/.KNARR/store/' },
                { name: 'Publish', desc: 'Copy built files to the store' },
                { name: 'Inject', desc: 'Copy from store to node_modules/' },
                { name: 'Push', desc: 'Publish + inject to all consumers' },
              ].map((item) => (
                <div key={item.name} className="flex gap-2 text-xs">
                  <code className="text-accent font-medium shrink-0">{item.name}</code>
                  <span className="text-text-muted">{item.desc}</span>
                </div>
              ))}
            </div>

            <div className="px-4 py-3 border-t border-border flex gap-3">
              <a
                href="https://github.com/oleg-kuibar/KNARR#readme"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-secondary hover:underline"
              >
                Docs
              </a>
              <a
                href="https://github.com/oleg-kuibar/KNARR"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-secondary hover:underline"
              >
                GitHub
              </a>
              <a
                href="https://www.npmjs.com/package/knarr"
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-secondary hover:underline"
              >
                npm
              </a>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export function Header({
  saveStatus,
  hasAnyDirty,
  status,
  onToggleSidebar,
  onTogglePreview,
  isSidebarCollapsed = false,
  isPreviewCollapsed = false,
}: HeaderProps) {
  return (
    <header className="h-10 bg-bg-elevated border-b border-border flex items-center px-3 gap-2.5 shrink-0">
      {/* Panel toggle - sidebar */}
      <button
        onClick={onToggleSidebar}
        className="btn btn-ghost p-1.5"
        aria-label={isSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
        title={isSidebarCollapsed ? 'Show sidebar' : 'Hide sidebar'}
      >
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <rect x="1" y="2" width="14" height="12" rx="1.5" />
          <line x1="5.5" y1="2" x2="5.5" y2="14" />
        </svg>
      </button>

      <a
        href="https://github.com/oleg-kuibar/KNARR"
        target="_blank"
        rel="noopener noreferrer"
        className="flex items-center gap-2 hover:opacity-80 transition-opacity"
        aria-label="KNARR - View on GitHub"
      >
        <img
          src="/KNARR_logo.png"
          alt=""
          className="w-6 h-6 rounded-full object-cover"
        />
        <span className="font-semibold text-sm text-text">KNARR Playground</span>
      </a>

      {/* Connection dot */}
      <ConnectionDot status={status} />

      <div className="ml-auto flex items-center gap-3">
        {/* Save status badges with AnimatePresence */}
        <AnimatePresence mode="wait">
          {saveStatus === 'saving' && (
            <motion.span
              key="saving"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="badge badge-muted"
            >
              Saving...
            </motion.span>
          )}
          {saveStatus === 'saved' && (
            <motion.span
              key="saved"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="badge badge-success"
            >
              Saved
            </motion.span>
          )}
          {hasAnyDirty && saveStatus === 'idle' && (
            <motion.span
              key="unsaved"
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 8 }}
              transition={{ duration: 0.15 }}
              className="badge badge-warning"
            >
              Unsaved
            </motion.span>
          )}
        </AnimatePresence>

        <AboutPopover />

        {/* Panel toggle - preview */}
        <button
          onClick={onTogglePreview}
          className="btn btn-ghost p-1.5"
          aria-label={isPreviewCollapsed ? 'Show preview' : 'Hide preview'}
          title={isPreviewCollapsed ? 'Show preview' : 'Hide preview'}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <rect x="1" y="2" width="14" height="12" rx="1.5" />
            <line x1="10.5" y1="2" x2="10.5" y2="14" />
          </svg>
        </button>
      </div>
    </header>
  );
}
