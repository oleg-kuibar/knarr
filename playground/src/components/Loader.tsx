import { motion } from 'framer-motion';

interface LoaderProps {
  /** Loading message to display */
  message?: string;
  /** Size variant */
  size?: 'sm' | 'md' | 'lg';
}

const PARTICLE_COLORS = [
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-warning)',
  'var(--color-accent)',
  'var(--color-success)',
  'var(--color-warning)',
];

/**
 * KNARR Loader - Ring spinner with orbiting particles and centered logo
 */
export function Loader({ message, size = 'md' }: LoaderProps) {
  const sizes = {
    sm: { logo: 32, ring: 48, orbit: 60, text: 'text-xs' },
    md: { logo: 48, ring: 72, orbit: 88, text: 'text-sm' },
    lg: { logo: 64, ring: 96, orbit: 116, text: 'text-base' },
  };

  const s = sizes[size];

  return (
    <div className="flex flex-col items-center justify-center gap-4">
      <div className="relative" style={{ width: s.orbit, height: s.orbit }}>
        {/* Spinning ring */}
        <svg
          className="absolute"
          width={s.ring}
          height={s.ring}
          viewBox="0 0 100 100"
          style={{
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            className="text-border"
          />
          <motion.circle
            cx="50"
            cy="50"
            r="46"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            className="text-accent"
            strokeLinecap="round"
            strokeDasharray="80 209"
            initial={{ rotate: 0 }}
            animate={{ rotate: 360 }}
            transition={{ duration: 1.5, repeat: Infinity, ease: 'linear' }}
            style={{ transformOrigin: 'center' }}
          />
        </svg>

        {/* Orbiting particles */}
        {PARTICLE_COLORS.map((color, i) => {
          const angle = (i * 360) / PARTICLE_COLORS.length;
          const radius = s.orbit / 2 - 4;
          const dotSize = size === 'lg' ? 5 : size === 'md' ? 4 : 3;
          return (
            <motion.div
              key={i}
              className="absolute rounded-full"
              style={{
                width: dotSize,
                height: dotSize,
                backgroundColor: color,
                left: '50%',
                top: '50%',
                marginLeft: -dotSize / 2,
                marginTop: -dotSize / 2,
              }}
              animate={{
                x: [
                  Math.cos(((angle) * Math.PI) / 180) * radius,
                  Math.cos(((angle + 360) * Math.PI) / 180) * radius,
                ],
                y: [
                  Math.sin(((angle) * Math.PI) / 180) * radius,
                  Math.sin(((angle + 360) * Math.PI) / 180) * radius,
                ],
                opacity: [0.4, 1, 0.4],
                scale: [0.8, 1.2, 0.8],
              }}
              transition={{
                x: { duration: 4, repeat: Infinity, ease: 'linear' },
                y: { duration: 4, repeat: Infinity, ease: 'linear' },
                opacity: { duration: 2, repeat: Infinity, delay: i * 0.3 },
                scale: { duration: 2, repeat: Infinity, delay: i * 0.3 },
              }}
            />
          );
        })}

        {/* Center logo */}
        <div
          className="absolute rounded-full overflow-hidden bg-bg-elevated"
          style={{
            width: s.logo,
            height: s.logo,
            left: '50%',
            top: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          <img
            src="/KNARR_logo.png"
            alt="KNARR"
            className="w-full h-full object-cover"
          />
        </div>
      </div>

      {message && (
        <p className={`text-text-muted ${s.text}`}>{message}</p>
      )}
    </div>
  );
}

/**
 * Simple spinner for inline loading states
 */
export function Spinner({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      className={`text-accent ${className}`}
      animate={{ rotate: 360 }}
      transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
    >
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" strokeOpacity="0.15" />
      <path d="M12 2 A10 10 0 0 1 22 12" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
    </motion.svg>
  );
}

/**
 * Code brackets loader
 */
export function CodeLoader({ size = 'md' }: { size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 32, md: 48, lg: 64 };
  const s = sizes[size];

  return (
    <div className="flex items-center gap-2">
      <motion.span
        className="text-accent font-mono font-bold"
        style={{ fontSize: s * 0.5 }}
        animate={{ x: [-4, 0, -4] }}
        transition={{ duration: 1, repeat: Infinity }}
      >
        {'<'}
      </motion.span>
      <motion.div
        className="flex gap-1"
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 1.5, repeat: Infinity }}
      >
        {[0, 1, 2].map((i) => (
          <motion.div
            key={i}
            className="w-1.5 h-1.5 rounded-full bg-text-subtle"
            animate={{ scale: [0.8, 1.2, 0.8] }}
            transition={{ duration: 0.6, delay: i * 0.15, repeat: Infinity }}
          />
        ))}
      </motion.div>
      <motion.span
        className="text-accent font-mono font-bold"
        style={{ fontSize: s * 0.5 }}
        animate={{ x: [4, 0, 4] }}
        transition={{ duration: 1, repeat: Infinity }}
      >
        {'/>'}
      </motion.span>
    </div>
  );
}

export default Loader;
