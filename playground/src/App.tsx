import { useState, useCallback, useRef } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { ImperativePanelHandle } from 'react-resizable-panels';
import { motion, AnimatePresence, LayoutGroup } from 'framer-motion';
import { useWebContainer } from './hooks/useWebContainer';
import { FileTree, Editor, Terminal, Preview, Tutorial, Scripts, LoadingScreen, Header, Footer } from './components';

const BROWSER_OPTIONS = [
  { icon: '\uD83C\uDF10', name: 'Chrome' },
  { icon: '\uD83E\uDD8A', name: 'Firefox' },
  { icon: '\uD83D\uDCD8', name: 'Edge' },
] as const;

function BrowserWarning() {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg text-text p-6 text-center">
      <motion.img
        src="/KNARR_logo.png"
        alt="KNARR mascot"
        className="w-24 h-24 rounded-full mb-6 object-cover"
        initial={{ scale: 0.8, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
      />
      <h1 className="text-xl font-semibold mb-4 text-danger">
        Browser Not Supported
      </h1>
      <p className="max-w-md text-text-muted leading-relaxed mb-6">
        The KNARR Playground requires SharedArrayBuffer, which is not available in
        your browser. Please use one of the following browsers:
      </p>
      <div className="flex gap-4">
        {BROWSER_OPTIONS.map((browser) => (
          <div
            key={browser.name}
            className="p-6 bg-bg-elevated border border-border rounded-lg"
          >
            <div className="text-3xl mb-2" role="img" aria-label={browser.name}>
              {browser.icon}
            </div>
            <div className="font-medium">{browser.name}</div>
          </div>
        ))}
      </div>
      <p className="mt-6 text-xs text-text-subtle">
        Safari is not supported due to SharedArrayBuffer restrictions.
      </p>
    </div>
  );
}

function ErrorScreen({ error }: { error: string }) {
  return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg text-text p-6">
      <div className="bg-bg-elevated border border-danger/30 rounded-xl p-10 max-w-md text-center">
        <motion.img
          src="/KNARR_logo.png"
          alt="KNARR"
          className="w-20 h-20 rounded-full mx-auto mb-4 grayscale opacity-60 object-cover"
          initial={{ scale: 0.9 }}
          animate={{ scale: 1 }}
        />
        <h1 className="text-xl font-semibold text-danger mb-4">
          Failed to Start Playground
        </h1>
        <p className="text-text-muted leading-relaxed mb-6">{error}</p>
        <button
          onClick={() => window.location.reload()}
          className="btn btn-primary"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}

interface OpenFile {
  path: string;
  content: string;
  isDirty: boolean;
}

export default function App() {
  const { status, error, previewUrl, spawnShell, readFile, writeFile, readdir } =
    useWebContainer();

  const [openFiles, setOpenFiles] = useState<OpenFile[]>([]);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [tutorialCollapsed, setTutorialCollapsed] = useState(() => {
    return localStorage.getItem('KNARR-tutorial-collapsed') === 'true';
  });
  const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState(false);
  const [isPreviewCollapsed, setIsPreviewCollapsed] = useState(false);

  const sidebarRef = useRef<ImperativePanelHandle>(null);
  const previewRef = useRef<ImperativePanelHandle>(null);

  const isSupported = typeof SharedArrayBuffer !== 'undefined';

  const currentFile = openFiles.find(f => f.path === activeFile);
  const hasAnyDirty = openFiles.some(f => f.isDirty);

  const handleFileSelect = useCallback(async (path: string) => {
    const existing = openFiles.find(f => f.path === path);
    if (existing) {
      setActiveFile(path);
      return;
    }

    const content = await readFile(path);
    if (content !== null) {
      setOpenFiles(prev => [...prev, { path, content, isDirty: false }]);
      setActiveFile(path);
    }
  }, [openFiles, readFile]);

  const handleTabSelect = useCallback((path: string) => {
    setActiveFile(path);
  }, []);

  const handleTabClose = useCallback((path: string, e?: React.MouseEvent) => {
    e?.stopPropagation();

    const file = openFiles.find(f => f.path === path);
    if (file?.isDirty) {
      if (!window.confirm(`"${path.split('/').pop()}" has unsaved changes. Close anyway?`)) {
        return;
      }
    }

    setOpenFiles(prev => prev.filter(f => f.path !== path));

    if (activeFile === path) {
      const remaining = openFiles.filter(f => f.path !== path);
      setActiveFile(remaining.length > 0 ? remaining[remaining.length - 1].path : null);
    }
  }, [openFiles, activeFile]);

  const handleContentChange = useCallback((content: string) => {
    if (!activeFile) return;

    setOpenFiles(prev => prev.map(f =>
      f.path === activeFile ? { ...f, content, isDirty: true } : f
    ));
    setSaveStatus('idle');
  }, [activeFile]);

  const handleSave = useCallback(async () => {
    if (!activeFile || !currentFile?.isDirty) return;

    setSaveStatus('saving');
    try {
      await writeFile(activeFile, currentFile.content);
      setOpenFiles(prev => prev.map(f =>
        f.path === activeFile ? { ...f, isDirty: false } : f
      ));
      setSaveStatus('saved');
      setTimeout(() => setSaveStatus('idle'), 2000);
    } catch (err) {
      console.error('Failed to save file:', err);
      setSaveStatus('idle');
    }
  }, [activeFile, currentFile, writeFile]);

  const handleTutorialToggle = useCallback(() => {
    setTutorialCollapsed(prev => {
      const next = !prev;
      localStorage.setItem('KNARR-tutorial-collapsed', String(next));
      return next;
    });
  }, []);

  // Opens a file in the editor, always re-reading from FS (used by Tutorial file edits)
  const handleTutorialOpenFile = useCallback(async (path: string) => {
    const content = await readFile(path);
    if (content === null) return;

    setOpenFiles(prev => {
      const existing = prev.find(f => f.path === path);
      if (existing) {
        return prev.map(f => f.path === path ? { ...f, content, isDirty: false } : f);
      }
      return [...prev, { path, content, isDirty: false }];
    });
    setActiveFile(path);
  }, [readFile]);

  const handleToggleSidebar = useCallback(() => {
    const panel = sidebarRef.current;
    if (!panel) return;
    if (isSidebarCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
    setIsSidebarCollapsed(!isSidebarCollapsed);
  }, [isSidebarCollapsed]);

  const handleTogglePreview = useCallback(() => {
    const panel = previewRef.current;
    if (!panel) return;
    if (isPreviewCollapsed) {
      panel.expand();
    } else {
      panel.collapse();
    }
    setIsPreviewCollapsed(!isPreviewCollapsed);
  }, [isPreviewCollapsed]);

  if (!isSupported) {
    return <BrowserWarning />;
  }

  if (status !== 'ready' && status !== 'error') {
    return <LoadingScreen status={status} />;
  }

  if (status === 'error' && error) {
    return <ErrorScreen error={error} />;
  }

  return (
    <div className="h-screen flex flex-col bg-bg">
      {/* Header */}
      <Header
        saveStatus={saveStatus}
        hasAnyDirty={hasAnyDirty}
        status={status}
        onToggleSidebar={handleToggleSidebar}
        onTogglePreview={handleTogglePreview}
        isSidebarCollapsed={isSidebarCollapsed}
        isPreviewCollapsed={isPreviewCollapsed}
      />

      {/* Main content */}
      <div className="flex-1 overflow-hidden">
        <PanelGroup direction="horizontal" autoSaveId="KNARR-playground-main">
          {/* Left sidebar - File tree & Scripts */}
          <Panel
            ref={sidebarRef}
            defaultSize={13}
            minSize={10}
            maxSize={22}
            collapsible
            collapsedSize={0}
            onCollapse={() => setIsSidebarCollapsed(true)}
            onExpand={() => setIsSidebarCollapsed(false)}
          >
            <AnimatePresence>
              {!isSidebarCollapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full bg-bg border-r border-border flex flex-col"
                >
                  <PanelGroup direction="vertical">
                    {/* File Explorer */}
                    <Panel defaultSize={65} minSize={30}>
                      <div className="h-full overflow-auto">
                        <div className="px-3 py-2.5 border-b border-border text-[11px] font-semibold text-text-muted uppercase tracking-wider">
                          Explorer
                        </div>
                        <FileTree
                          readdir={readdir}
                          onFileSelect={handleFileSelect}
                          selectedFile={activeFile}
                          isReady={status === 'ready'}
                        />
                      </div>
                    </Panel>

                    <PanelResizeHandle />

                    {/* Scripts */}
                    <Panel defaultSize={35} minSize={20}>
                      <Scripts
                        readFile={readFile}
                        readdir={readdir}
                        isReady={status === 'ready'}
                      />
                    </Panel>
                  </PanelGroup>
                </motion.div>
              )}
            </AnimatePresence>
          </Panel>

          <PanelResizeHandle />

          {/* Center - Editor and Terminal */}
          <Panel defaultSize={47} minSize={30}>
            <PanelGroup direction="vertical">
              <Panel defaultSize={50} minSize={20}>
                <div className="h-full bg-bg flex flex-col">
                  {/* File tabs with layout animations */}
                  {openFiles.length > 0 && (
                    <div className="flex items-center bg-bg-elevated border-b border-border overflow-x-auto shrink-0">
                      <LayoutGroup>
                        {openFiles.map((file) => {
                          const fileName = file.path.split('/').pop() || file.path;
                          const isActive = file.path === activeFile;
                          return (
                            <motion.button
                              key={file.path}
                              layout
                              layoutId={`tab-${file.path}`}
                              onClick={() => handleTabSelect(file.path)}
                              className={`
                                group flex items-center gap-1.5 px-3 py-2 text-xs border-r border-border
                                transition-colors shrink-0
                                ${isActive
                                  ? 'bg-bg text-text border-b-2 border-b-accent -mb-px'
                                  : 'text-text-muted hover:text-text hover:bg-bg-subtle'
                                }
                              `}
                              title={file.path}
                            >
                              <span className="max-w-[120px] truncate">{fileName}</span>
                              {file.isDirty && (
                                <motion.span
                                  className="w-2 h-2 rounded-full bg-warning shrink-0"
                                  title="Unsaved changes"
                                  animate={{ scale: [1, 1.3, 1] }}
                                  transition={{ duration: 0.6, repeat: 2 }}
                                />
                              )}
                              <span
                                role="button"
                                tabIndex={0}
                                onClick={(e) => handleTabClose(file.path, e)}
                                onKeyDown={(e) => {
                                  if (e.key === 'Enter' || e.key === ' ') {
                                    e.preventDefault();
                                    handleTabClose(file.path);
                                  }
                                }}
                                className={`
                                  ml-1 w-4 h-4 flex items-center justify-center rounded
                                  hover:bg-danger/20 hover:text-danger
                                  ${isActive ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}
                                  transition-opacity
                                `}
                                aria-label={`Close ${fileName}`}
                              >
                                {'\u00D7'}
                              </span>
                            </motion.button>
                          );
                        })}
                      </LayoutGroup>
                    </div>
                  )}

                  {/* Editor */}
                  <div className="flex-1 min-h-0">
                    <Editor
                      path={activeFile}
                      content={currentFile?.content ?? ''}
                      onChange={handleContentChange}
                      onSave={handleSave}
                      isDirty={currentFile?.isDirty ?? false}
                    />
                  </div>
                </div>
              </Panel>

              <PanelResizeHandle />

              <Panel defaultSize={50} minSize={15}>
                <div className="h-full bg-bg border-t border-border">
                  <Terminal status={status} spawnShell={spawnShell} />
                </div>
              </Panel>
            </PanelGroup>
          </Panel>

          <PanelResizeHandle />

          {/* Right - Preview */}
          <Panel
            ref={previewRef}
            defaultSize={40}
            minSize={20}
            collapsible
            collapsedSize={0}
            onCollapse={() => setIsPreviewCollapsed(true)}
            onExpand={() => setIsPreviewCollapsed(false)}
          >
            <AnimatePresence>
              {!isPreviewCollapsed && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: 0.15 }}
                  className="h-full bg-bg border-l border-border"
                >
                  <Preview url={previewUrl} />
                </motion.div>
              )}
            </AnimatePresence>
          </Panel>
        </PanelGroup>
      </div>

      {/* Footer */}
      <Footer />

      {/* Tutorial overlay */}
      <Tutorial
        isCollapsed={tutorialCollapsed}
        onToggle={handleTutorialToggle}
        readFile={readFile}
        writeFile={writeFile}
        onOpenFile={handleTutorialOpenFile}
        previewUrl={previewUrl}
      />
    </div>
  );
}
