import { motion } from 'framer-motion';
import { Loader } from './Loader';
import type { BootStatus } from '../hooks/useWebContainer';

const BOOT_PHASES = ['idle', 'booting', 'mounting', 'installing'] as const;
const STEP_NAMES = ['Init', 'Boot', 'Mount', 'Install'];

const PHASE_LABELS: Record<string, { title: string; detail: string }> = {
  idle: {
    title: 'Initializing...',
    detail: 'Preparing the playground environment',
  },
  booting: {
    title: 'Booting WebContainer...',
    detail: 'Starting a sandboxed Node.js runtime in your browser',
  },
  mounting: {
    title: 'Mounting filesystem...',
    detail: 'Loading project templates with packages and a consumer app',
  },
  installing: {
    title: 'Installing dependencies...',
    detail: 'Running npm install for KNARR CLI and example packages',
  },
};

export function LoadingScreen({ status }: { status: BootStatus }) {
  const rawIdx = BOOT_PHASES.indexOf(status as (typeof BOOT_PHASES)[number]);
  const currentIdx = rawIdx === -1 ? BOOT_PHASES.length - 1 : rawIdx;
  const progress = ((currentIdx + 1) / BOOT_PHASES.length) * 100;

  return (
    <div className="flex flex-col items-center justify-center h-screen bg-bg text-text">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex flex-col items-center gap-8 max-w-sm w-full px-6"
      >
        <Loader size="lg" />

        <div className="text-center space-y-2">
          <h1 className="text-lg font-semibold text-text">KNARR Playground</h1>
          <p className="text-sm text-text-muted">
            {PHASE_LABELS[status]?.title ?? 'Loading...'}
          </p>
          <motion.p
            key={status}
            className="text-xs text-text-subtle"
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.3 }}
          >
            {PHASE_LABELS[status]?.detail ?? ''}
          </motion.p>
        </div>

        {/* Progress steps */}
        <div className="w-full max-w-[320px]">
          <div className="h-1 bg-bg-muted rounded-full overflow-hidden">
            <motion.div
              className="h-full bg-accent rounded-full"
              animate={{ width: `${progress}%` }}
              transition={{ duration: 0.4, ease: 'easeOut' }}
            />
          </div>
          <div className="flex justify-between mt-3">
            {BOOT_PHASES.map((phase, idx) => (
              <div key={phase} className="flex flex-col items-center gap-1">
                <div
                  className={`w-2 h-2 rounded-full transition-colors ${
                    currentIdx > idx
                      ? 'bg-success'
                      : currentIdx === idx
                        ? 'bg-accent'
                        : 'bg-bg-muted'
                  }`}
                />
                <span className={`text-[9px] transition-colors ${
                  currentIdx >= idx ? 'text-text-muted' : 'text-text-subtle'
                }`}>
                  {STEP_NAMES[idx]}
                </span>
              </div>
            ))}
          </div>
        </div>
      </motion.div>
    </div>
  );
}
