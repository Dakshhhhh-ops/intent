import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from 'react';

// Small visual elements ported to plain CSS + React from open-source UI kits:
// Dot Pattern, Border Beam, Marquee, Magic Card, Animated Shiny Text, Shimmer Button and
// Number Ticker follow Magic UI (MIT, https://magicui.design); the spotlight glow follows
// the idea of Aceternity's Spotlight. No runtime dependencies; styles live in oss.css.

/** A dot grid that fades out toward the edges. */
export function DotPattern({ className = '', gap = 22, r = 1 }: { className?: string; gap?: number; r?: number }) {
  const id = useId().replace(/:/g, '');
  return (
    <svg className={`oss-dots ${className}`} aria-hidden="true">
      <defs>
        <pattern id={`dots-${id}`} width={gap} height={gap} patternUnits="userSpaceOnUse">
          <circle cx={gap / 2} cy={gap / 2} r={r} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#dots-${id})`} />
    </svg>
  );
}

/** A soft beam of light from the top of a section. */
export function Spotlight({ className = '' }: { className?: string }) {
  return <div className={`oss-spotlight ${className}`} aria-hidden="true" />;
}

/** A short gradient that travels around the card's border. */
export function BorderBeam({ duration = 9, size = 220 }: { duration?: number; size?: number }) {
  return <div className="oss-beam" aria-hidden="true" style={{ '--beam-duration': `${duration}s`, '--beam-size': `${size}px` } as CSSProperties} />;
}

/** Infinite horizontal scroll with faded edges; pauses on hover. */
export function Marquee({ children, reverse = false, duration = 40 }: { children: ReactNode; reverse?: boolean; duration?: number }) {
  return (
    <div className={`oss-marquee ${reverse ? 'reverse' : ''}`} style={{ '--marquee-duration': `${duration}s` } as CSSProperties}>
      {[0, 1].map((k) => (
        <div key={k} className="oss-marquee-track" aria-hidden={k === 1 ? 'true' : undefined}>
          {children}
        </div>
      ))}
    </div>
  );
}

/** A card with a glow that follows the pointer. */
export function MagicCard({ children, className = '', as: Tag = 'div', ...rest }: { children: ReactNode; className?: string; as?: 'div' | 'button' | 'article' } & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);
  const onMove = (e: React.PointerEvent) => {
    const el = ref.current;
    if (!el) return;
    const r = el.getBoundingClientRect();
    el.style.setProperty('--mx', `${e.clientX - r.left}px`);
    el.style.setProperty('--my', `${e.clientY - r.top}px`);
  };
  const Any = Tag as unknown as React.ElementType;
  return (
    <Any ref={ref} className={`oss-magic ${className}`} onPointerMove={onMove} {...rest}>
      {children}
    </Any>
  );
}

/** Text with a light sweep passing over it. */
export function ShinyText({ children }: { children: ReactNode }) {
  return <span className="oss-shiny">{children}</span>;
}

/** Counts up to `value` once it scrolls into view. */
export function NumberTicker({ value, suffix = '' }: { value: number; suffix?: string }) {
  const ref = useRef<HTMLSpanElement>(null);
  const [n, setN] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches || typeof IntersectionObserver === 'undefined') {
      setN(value);
      return;
    }
    let raf = 0;
    const io = new IntersectionObserver(
      ([e]) => {
        if (!e.isIntersecting) return;
        io.disconnect();
        const t0 = performance.now();
        const tick = (t: number) => {
          const p = Math.min(1, (t - t0) / 1200);
          setN(Math.round(value * (1 - Math.pow(1 - p, 3))));
          if (p < 1) raf = requestAnimationFrame(tick);
        };
        raf = requestAnimationFrame(tick);
      },
      { threshold: 0.4 },
    );
    io.observe(el);
    return () => {
      io.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [value]);
  return (
    <span ref={ref} className="num">
      {n.toLocaleString()}
      {suffix}
    </span>
  );
}
