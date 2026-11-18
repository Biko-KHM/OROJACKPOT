import React from 'react';

interface CustomLoaderProps {
  message?: string;
  subtitle?: string;
  fullScreen?: boolean;
  size?: 'sm' | 'md' | 'lg';
}

export const CustomLoader: React.FC<CustomLoaderProps> = ({
  message = 'Getting things ready',
  subtitle,
  fullScreen = true,
  size = 'md',
}) => {
  const sizeClasses = {
    sm: {
      container: 'w-16 h-16',
      badge: 'w-11 h-11 rounded-xl',
      text: 'text-xl',
      msgText: 'text-xs',
      rx: 22,
    },
    md: {
      container: 'w-20 h-20',
      badge: 'w-14 h-14 rounded-2xl',
      text: 'text-2xl',
      msgText: 'text-sm',
      rx: 24,
    },
    lg: {
      container: 'w-24 h-24',
      badge: 'w-16 h-16 rounded-3xl',
      text: 'text-3xl',
      msgText: 'text-base',
      rx: 26,
    },
  }[size];

  const content = (
    <div className="flex flex-col items-center justify-center space-y-4 select-none">
      {/* Emblem & Spinner Wrapper */}
      <div className={`relative ${sizeClasses.container} flex items-center justify-center`}>
        {/* Soft Ambient Radial Glow */}
        <div className="absolute inset-0 bg-[#00d26a]/15 rounded-full blur-xl animate-pulse pointer-events-none" />

        {/* Orbiting Squircle Ring (Inspired by FulusApp reference loader) */}
        <svg
          className="w-full h-full animate-spin [animation-duration:1.8s]"
          viewBox="0 0 100 100"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
        >
          <defs>
            <linearGradient id="orbitGlow" x1="0%" y1="0%" x2="100%" y2="100%">
              <stop offset="0%" stopColor="#00d26a" stopOpacity="1" />
              <stop offset="60%" stopColor="#00bf60" stopOpacity="0.8" />
              <stop offset="100%" stopColor="#123c2a" stopOpacity="0.2" />
            </linearGradient>
            <filter id="neonBlur" x="-20%" y="-20%" width="140%" height="140%">
              <feGaussianBlur stdDeviation="2.5" result="blur" />
              <feMerge>
                <feMergeNode in="blur" />
                <feMergeNode in="SourceGraphic" />
              </feMerge>
            </filter>
          </defs>

          {/* Base Dark Track */}
          <rect
            x="10"
            y="10"
            width="80"
            height="80"
            rx={sizeClasses.rx}
            stroke="#123c2a"
            strokeWidth="2.5"
            strokeOpacity="0.5"
          />

          {/* Glowing Neon Arc Runner */}
          <rect
            x="10"
            y="10"
            width="80"
            height="80"
            rx={sizeClasses.rx}
            stroke="url(#orbitGlow)"
            strokeWidth="3"
            strokeLinecap="round"
            strokeDasharray="65 240"
            filter="url(#neonBlur)"
          />
        </svg>

        {/* Static Inner Dark Squircle Badge with Stylized "L" */}
        <div
          className={`absolute ${sizeClasses.badge} bg-[#0c251b] border border-[#123c2a] flex items-center justify-center shadow-lg shadow-black/80`}
        >
          <span
            className={`${sizeClasses.text} font-display font-black text-[#00d26a] tracking-tight leading-none drop-shadow-[0_0_8px_rgba(0,210,106,0.6)]`}
          >
            L
          </span>
        </div>
      </div>

      {/* Label & Status Text */}
      <div className="text-center space-y-1">
        <p
          className={`${sizeClasses.msgText} font-medium text-slate-300 tracking-wide font-sans flex items-center justify-center gap-1.5`}
        >
          <span>{message}</span>
          <span className="inline-flex space-x-0.5">
            <span className="w-1 h-1 bg-[#00d26a] rounded-full animate-bounce [animation-delay:-0.3s]" />
            <span className="w-1 h-1 bg-[#00d26a] rounded-full animate-bounce [animation-delay:-0.15s]" />
            <span className="w-1 h-1 bg-[#00d26a] rounded-full animate-bounce" />
          </span>
        </p>
        {subtitle && (
          <p className="text-[11px] text-fulus-muted font-medium tracking-tight">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );

  if (fullScreen) {
    return (
      <div className="min-h-screen w-full bg-[#080b10] flex items-center justify-center p-4 selection:bg-[#00d26a]/30">
        {content}
      </div>
    );
  }

  return <div className="py-12 px-4 flex items-center justify-center">{content}</div>;
};
