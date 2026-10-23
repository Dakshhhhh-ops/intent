import { useEffect, useRef } from 'react';

// A wordmark that assembles out of drifting dots and squares when it scrolls into view,
// and scatters a little around the pointer.

export function ParticleWordmark({ text = 'INTENT REPLAY' }: { text?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    let dpr = Math.min(2, window.devicePixelRatio || 1);
    let W = 0;
    let H = 0;
    type P = { x: number; y: number; tx: number; ty: number; vx: number; vy: number; s: number; sq: boolean; hot: boolean };
    let ps: P[] = [];
    let progress = reduce ? 1 : 0;
    let raf = 0;
    let mx = -9999;
    let my = -9999;

    const build = () => {
      W = canvas.clientWidth;
      H = canvas.clientHeight;
      if (W < 2 || H < 2) {
        ps = [];
        return; // not laid out yet (hidden or mid-transition)
      }
      canvas.width = W * dpr;
      canvas.height = H * dpr;
      const off = document.createElement('canvas');
      off.width = W;
      off.height = H;
      const o = off.getContext('2d')!;
      let size = H * 0.92;
      o.font = `800 ${size}px "Inter Tight Variable", "Inter Variable", sans-serif`;
      const w = o.measureText(text).width;
      if (w > W * 0.98) size *= (W * 0.98) / w;
      o.font = `800 ${size}px "Inter Tight Variable", "Inter Variable", sans-serif`;
      o.textBaseline = 'middle';
      o.textAlign = 'center';
      o.fillStyle = '#fff';
      o.fillText(text, W / 2, H / 2);
      const data = o.getImageData(0, 0, W, H).data;
      const step = Math.max(5, Math.round(W / 220));
      const next: P[] = [];
      for (let y = 0; y < H; y += step) {
        for (let x = 0; x < W; x += step) {
          if (data[(y * W + x) * 4 + 3] > 128) {
            next.push({
              x: Math.random() * W,
              y: H + Math.random() * H,
              tx: x,
              ty: y,
              vx: 0,
              vy: 0,
              s: step * (0.42 + Math.random() * 0.22),
              sq: Math.random() < 0.18,
              hot: Math.random() < 0.05,
            });
          }
        }
      }
      ps = next;
      if (reduce) ps.forEach((p) => ((p.x = p.tx), (p.y = p.ty)));
    };

    const draw = () => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);
      const cream = getComputedStyle(canvas).color || '#f4ede4';
      for (const p of ps) {
        ctx.fillStyle = p.hot ? '#ff801f' : cream;
        ctx.globalAlpha = p.hot ? 0.95 : 0.78;
        if (p.sq) ctx.fillRect(p.x - p.s / 2, p.y - p.s / 2, p.s, p.s);
        else {
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.s / 2, 0, Math.PI * 2);
          ctx.fill();
        }
      }
      ctx.globalAlpha = 1;
    };

    let lastT = 0;
    const tick = (t: number) => {
      raf = requestAnimationFrame(tick);
      // Time-based so slow machines (few frames per second) still assemble the word quickly.
      const steps = lastT ? Math.min(3, Math.max(1, Math.round((t - lastT) / 16.7))) : 1;
      lastT = t;
      let moving = false;
      for (let k = 0; k < steps; k++) moving = simulate() || moving;
      if (moving || !settled) draw();
      settled = !moving;
    };
    let settled = false;
    const simulate = (): boolean => {
      let moving = progress < 1 || mx > -9000;
      progress = Math.min(1, progress + 0.012);
      const pull = 0.04 + progress * 0.08;
      for (const p of ps) {
        const dx = p.x - mx;
        const dy = p.y - my;
        const d2 = dx * dx + dy * dy;
        if (d2 < 3600) {
          const d = Math.sqrt(d2) || 1;
          p.vx += (dx / d) * 2.2;
          p.vy += (dy / d) * 2.2;
        }
        p.vx += (p.tx - p.x) * pull * 0.2;
        p.vy += (p.ty - p.y) * pull * 0.2;
        p.vx *= 0.82;
        p.vy *= 0.82;
        p.x += p.vx;
        p.y += p.vy;
        if (!moving && (Math.abs(p.vx) > 0.05 || Math.abs(p.vy) > 0.05)) moving = true;
      }
      return moving;
    };

    build();
    draw();
    const ro = new ResizeObserver(() => {
      build();
      draw();
    });
    ro.observe(canvas);
    const move = (e: PointerEvent) => {
      const r = canvas.getBoundingClientRect();
      mx = e.clientX - r.left;
      my = e.clientY - r.top;
    };
    const leave = () => {
      mx = -9999;
      my = -9999;
    };
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerleave', leave);
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !reduce && !raf) raf = requestAnimationFrame(tick);
      if (!e.isIntersecting && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    });
    io.observe(canvas);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      canvas.removeEventListener('pointermove', move);
      canvas.removeEventListener('pointerleave', leave);
      dpr = 1;
    };
  }, [text]);

  return <canvas ref={ref} className="particle-wordmark" aria-label={text} role="img" />;
}
