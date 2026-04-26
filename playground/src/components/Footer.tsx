const TECH = [
  { name: 'WebContainer', href: 'https://webcontainers.io' },
  { name: 'Vite', href: 'https://vite.dev' },
  { name: 'React', href: 'https://react.dev' },
  { name: 'Monaco', href: 'https://microsoft.github.io/monaco-editor/' },
  { name: 'xterm.js', href: 'https://xtermjs.org' },
  { name: 'Tailwind CSS', href: 'https://tailwindcss.com' },
] as const;

export function Footer() {
  return (
    <footer className="h-5 bg-bg-elevated border-t border-border flex items-center justify-between px-3 text-[10px] text-text-subtle shrink-0">
      <div className="flex items-center gap-1">
        <span>Built with</span>
        {TECH.map((t, i) => (
          <span key={t.name} className="flex items-center gap-1">
            {i > 0 && <span aria-hidden>·</span>}
            <a
              href={t.href}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-text transition-colors"
            >
              {t.name}
            </a>
          </span>
        ))}
      </div>
      <a
        href="https://github.com/oleg-kuibar/KNARR"
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-text transition-colors"
      >
        KNARR v0.7.3
      </a>
    </footer>
  );
}
