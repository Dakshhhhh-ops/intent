import { useEffect, useRef, useState } from 'react';

/** A soft ring that trails the pointer and grows over interactive elements (fine pointers only). */
export function CursorFollower() {
  const dot = useRef<HTMLDivElement>(null);
  const ring = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!matchMedia('(pointer: fine)').matches || matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    let x = innerWidth / 2;
    let y = innerHeight / 2;
    let rx = x;
    let ry = y;
    let raf = 0;
    let hot = false;
    const move = (e: PointerEvent) => {
      x = e.clientX;
      y = e.clientY;
      hot = !!(e.target as HTMLElement).closest('a, button, [role="button"], input, .bbd');
    };
    const loop = () => {
      raf = requestAnimationFrame(loop);
      rx += (x - rx) * 0.16;
      ry += (y - ry) * 0.16;
      if (dot.current) dot.current.style.transform = `translate(${x}px, ${y}px)`;
      if (ring.current) {
        ring.current.style.transform = `translate(${rx}px, ${ry}px) scale(${hot ? 1.8 : 1})`;
        ring.current.classList.toggle('hot', hot);
      }
    };
    window.addEventListener('pointermove', move, { passive: true });
    document.documentElement.classList.add('has-cursor');
    raf = requestAnimationFrame(loop);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      document.documentElement.classList.remove('has-cursor');
    };
  }, []);
  return (
    <>
      <div className="cursor-ring" ref={ring} aria-hidden="true" />
      <div className="cursor-dot" ref={dot} aria-hidden="true" />
    </>
  );
}

/** "● REC 00:01:27" — a running timecode, flight-recorder style. */
export function RecTimecode() {
  const [t, setT] = useState(0);
  useEffect(() => {
    const start = performance.now();
    const id = setInterval(() => setT(performance.now() - start), 1000 / 25);
    return () => clearInterval(id);
  }, []);
  const s = Math.floor(t / 1000);
  const f = Math.floor((t % 1000) / 40);
  const pad = (v: number) => String(v).padStart(2, '0');
  return (
    <span className="rec">
      <span className="rec-dot" /> REC {pad(Math.floor(s / 3600))}:{pad(Math.floor((s % 3600) / 60))}:{pad(s % 60)}:{pad(f)}
    </span>
  );
}
