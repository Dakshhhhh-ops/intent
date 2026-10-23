// Page-wide touches on Home: a cursor spotlight, magnetic hero buttons, a back-to-top button
// with a progress ring, and a short "rewind" wipe when moving between Home and a run.
// All of it sits outside the React tree and is purely decorative.

const reduce = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const finePointer = () => matchMedia('(hover: hover) and (pointer: fine)').matches;

export function startExtras(): { homeChanged: (home: boolean, animate: boolean) => void } {
  // Spotlight: a soft glow under the content that follows the pointer.
  const spot = document.createElement('div');
  spot.className = 'fx-spot';
  spot.setAttribute('aria-hidden', 'true');
  document.body.prepend(spot);
  let sraf = 0;
  addEventListener(
    'pointermove',
    (e) => {
      if (!finePointer()) return;
      cancelAnimationFrame(sraf);
      sraf = requestAnimationFrame(() => {
        spot.style.setProperty('--mx', `${e.clientX}px`);
        spot.style.setProperty('--my', `${e.clientY}px`);
      });
    },
    { passive: true },
  );

  // Magnetic buttons: the hero calls to action lean toward the pointer.
  const magnets = new WeakSet<Element>();
  const magnetize = () => {
    document.querySelectorAll<HTMLElement>('.home-hero .btn, .fx-magnet').forEach((el) => {
      if (magnets.has(el)) return;
      magnets.add(el);
      el.classList.add('fx-mag');
      el.addEventListener('pointermove', (e) => {
        if (reduce() || !finePointer()) return;
        const r = el.getBoundingClientRect();
        const x = (e.clientX - (r.left + r.width / 2)) * 0.22;
        const y = (e.clientY - (r.top + r.height / 2)) * 0.3;
        el.style.translate = `${x.toFixed(1)}px ${y.toFixed(1)}px`;
      });
      el.addEventListener('pointerleave', () => {
        el.style.translate = '';
      });
    });
  };

  // Back to top, with a ring that fills as you read down the page.
  const top = document.createElement('button');
  top.type = 'button';
  top.className = 'fx-top';
  top.setAttribute('aria-label', 'Back to top');
  top.innerHTML =
    '<svg viewBox="0 0 44 44" aria-hidden="true"><circle class="trk" cx="22" cy="22" r="19"/><circle class="arc" cx="22" cy="22" r="19"/><path d="M22 28V16m-6 6 6-6 6 6" class="arw"/></svg>';
  document.body.appendChild(top);
  top.addEventListener('click', () => scrollTo({ top: 0, behavior: reduce() ? 'auto' : 'smooth' }));
  const arc = top.querySelector<SVGCircleElement>('.arc')!;
  const C = 2 * Math.PI * 19;
  arc.style.strokeDasharray = `${C}`;
  let traf = 0;
  const onScroll = () => {
    cancelAnimationFrame(traf);
    traf = requestAnimationFrame(() => {
      const max = document.documentElement.scrollHeight - innerHeight;
      const p = max > 0 ? Math.min(1, scrollY / max) : 0;
      arc.style.strokeDashoffset = `${C * (1 - p)}`;
      top.classList.toggle('show', scrollY > innerHeight * 1.2);
    });
  };
  addEventListener('scroll', onScroll, { passive: true });
  onScroll();

  // Rewind wipe: tape lines sweep across for a moment when the view changes.
  let wipe: HTMLDivElement | null = null;
  let wipeTimer = 0;
  const rewind = (dir: 'in' | 'out') => {
    if (reduce()) return;
    wipe?.remove();
    clearTimeout(wipeTimer);
    wipe = document.createElement('div');
    wipe.className = `fx-wipe ${dir}`;
    wipe.setAttribute('aria-hidden', 'true');
    wipe.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><b></b>';
    document.body.appendChild(wipe);
    const w = wipe;
    wipeTimer = window.setTimeout(() => w.remove(), 900);
  };

  // React may re-render the hero; pick up new buttons as they appear.
  const mo = new MutationObserver(() => magnetize());
  mo.observe(document.getElementById('root') ?? document.body, { childList: true, subtree: true });
  magnetize();

  return {
    homeChanged: (home, animate) => {
      if (!home) top.classList.remove('show');
      onScroll();
      if (animate) rewind(home ? 'in' : 'out');
    },
  };
}
