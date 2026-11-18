import React, { useEffect, useRef } from 'react';

interface ConfettiPiece {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  vx: number;
  vy: number;
  rotation: number;
  rotationSpeed: number;
  flutterSpeed: number;
  flutterPhase: number;
  opacity: number;
}

interface ConfettiCanvasProps {
  active?: boolean;
  durationMs?: number;
  particleCount?: number;
  className?: string;
}

const PALETTE = [
  '#f59e0b', // Gold
  '#fbbf24', // Amber
  '#00d26a', // Emerald
  '#10b981', // Mint
  '#38bdf8', // Cyan
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#ffffff', // Sparkle white
];

export const ConfettiCanvas: React.FC<ConfettiCanvasProps> = ({
  active = true,
  durationMs = 4500,
  particleCount = 55,
  className = 'absolute inset-0 pointer-events-none z-10 w-full h-full',
}) => {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    if (!active) return;

    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    // Size canvas to element bounds
    const rect = canvas.getBoundingClientRect();
    const width = (canvas.width = rect.width || 320);
    const height = (canvas.height = rect.height || 260);

    // Spawn burst of particles from bottom and center
    const pieces: ConfettiPiece[] = [];
    for (let i = 0; i < particleCount; i++) {
      const startX = width * (0.2 + Math.random() * 0.6);
      const startY = height * (0.4 + Math.random() * 0.5);
      const angle = -Math.PI / 2 + (Math.random() - 0.5) * 1.5;
      const speed = 4 + Math.random() * 8;

      pieces.push({
        x: startX,
        y: startY,
        w: 6 + Math.random() * 6,
        h: 4 + Math.random() * 8,
        color: PALETTE[Math.floor(Math.random() * PALETTE.length)],
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        rotation: Math.random() * 360,
        rotationSpeed: (Math.random() - 0.5) * 12,
        flutterSpeed: 0.05 + Math.random() * 0.08,
        flutterPhase: Math.random() * Math.PI * 2,
        opacity: 1,
      });
    }

    let animationFrameId: number;
    const startTime = performance.now();

    const render = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(1, elapsed / durationMs);

      ctx.clearRect(0, 0, width, height);

      // Fade out towards end
      const globalAlpha = progress > 0.75 ? (1 - progress) / 0.25 : 1;

      for (const p of pieces) {
        // Physics update
        p.x += p.vx;
        p.y += p.vy;
        p.vy += 0.18; // gravity
        p.vx *= 0.98; // horizontal drag
        p.rotation += p.rotationSpeed;
        p.flutterPhase += p.flutterSpeed;

        // Gentle horizontal oscillation
        p.x += Math.sin(p.flutterPhase) * 0.8;

        // Render particle with 3D flutter illusion
        ctx.save();
        ctx.translate(p.x, p.y);
        ctx.rotate((p.rotation * Math.PI) / 180);
        ctx.scale(Math.cos(p.flutterPhase), 1);
        ctx.fillStyle = p.color;
        ctx.globalAlpha = Math.max(0, p.opacity * globalAlpha);
        ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
        ctx.restore();
      }

      if (progress < 1) {
        animationFrameId = requestAnimationFrame(render);
      } else {
        ctx.clearRect(0, 0, width, height);
      }
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [active, durationMs, particleCount]);

  return <canvas ref={canvasRef} className={className} />;
};
