// Adds motion to the existing UI without touching its components: elements that match the
// selectors below get scroll reveals and a 3D pointer tilt as they appear in the DOM.
// Motion stays on the Home page and the Brief hero; the dense run views are left alone.

const REVEAL = [
  '.home-hero > *',
  '.home .section-title',
  '.home .sample',
  '.home .how-card',
  '.home .terminal',
  '.home .compare-card',
  '.home .session-row',
  '.home .footer',
  '.fx-story-step',
  '.brief-hero',
].join(',');

const TILT = ['.home .sample', '.home .how-card', '.home .compare-card', '.home .dropzone', '.fx-tilt-me'].join(',');

export function startEnhancer(onHomeChange: (home: boolean) => void): () => void {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const fine = matchMedia('(hover: hover) and (pointer: fine)');
  const seen = new WeakSet<Element>();
  const tilted = new WeakSet<Element>();

  const io = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (!e.isIntersecting) continue;
        e.target.classList.add('fx-in');
        io.unobserve(e.target);
      }
    },
    { rootMargin: '0px 0px -8% 0px', threshold: 0.08 },
  );

  const reveal = (el: HTMLElement) => {
    if (seen.has(el)) return;
    seen.add(el);
    // Stagger siblings of the same kind: cards in a grid cascade in.
    const sibs = el.parentElement ? Array.from(el.parentElement.children).filter((c) => c.className === el.className) : [];
    const i = Math.max(0, sibs.indexOf(el));
    el.style.setProperty('--fx-delay', `${Math.min(i, 8) * 70}ms`);
    el.classList.add('fx-reveal');
    const r = el.getBoundingClientRect();
    // Already on screen at load: reveal on the next frame so the entrance still plays.
    if (reduce.matches || (r.top < innerHeight && r.bottom > 0)) requestAnimationFrame(() => el.classList.add('fx-in'));
    else io.observe(el);
  };

  const tilt = (el: HTMLElement) => {
    if (tilted.has(el)) return;
    tilted.add(el);
    el.classList.add('fx-tilt');
    let raf = 0;
    const onMove = (e: PointerEvent) => {
      if (reduce.matches || !fine.matches || el.classList.contains('over')) return;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const r = el.getBoundingClientRect();
        const x = (e.clientX - r.left) / r.width;
        const y = (e.clientY - r.top) / r.height;
        // Large surfaces tilt less so text stays readable.
        const max = r.width > 420 ? 3 : 7;
        el.style.setProperty('--fx-rx', `${((0.5 - y) * max).toFixed(2)}deg`);
        el.style.setProperty('--fx-ry', `${((x - 0.5) * max).toFixed(2)}deg`);
        el.style.setProperty('--fx-gx', `${(x * 100).toFixed(1)}%`);
        el.style.setProperty('--fx-gy', `${(y * 100).toFixed(1)}%`);
        el.classList.add('fx-tilting');
      });
    };
    const onLeave = () => {
      cancelAnimationFrame(raf);
      el.classList.remove('fx-tilting');
      el.style.setProperty('--fx-rx', '0deg');
      el.style.setProperty('--fx-ry', '0deg');
    };
    el.addEventListener('pointermove', onMove);
    el.addEventListener('pointerleave', onLeave);
  };

  let home: boolean | null = null;
  const scan = () => {
    document.querySelectorAll<HTMLElement>(REVEAL).forEach(reveal);
    document.querySelectorAll<HTMLElement>(TILT).forEach(tilt);
    const h = !!document.querySelector('.home');
    if (h !== home) {
      home = h;
      document.body.classList.toggle('fx-home', h);
      onHomeChange(h);
    }
  };

  // React renders in bursts; batch rescans to one per frame.
  let pending = 0;
  const mo = new MutationObserver(() => {
    if (pending) return;
    pending = requestAnimationFrame(() => {
      pending = 0;
      scan();
    });
  });
  mo.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });

  // Reading-progress bar along the top edge of Home.
  const bar = document.createElement('div');
  bar.className = 'fx-progress';
  bar.setAttribute('aria-hidden', 'true');
  document.body.appendChild(bar);
  let sraf = 0;
  const onScroll = () => {
    cancelAnimationFrame(sraf);
    sraf = requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? Math.min(1, scrollY / max) : 0;
      bar.style.transform = `scaleX(${p})`;
      document.body.style.setProperty('--fx-scroll', String(scrollY));
    });
  };
  addEventListener('scroll', onScroll, { passive: true });

  scan();
  onScroll();

  return () => {
    mo.disconnect();
    io.disconnect();
    removeEventListener('scroll', onScroll);
    bar.remove();
  };
}
