// A 3D "tape helix" drawn on a canvas behind the home page: every bar is a step of an agent
// run (read, edit, command, failure...), wound into a slowly turning double helix.
// It follows the pointer, twists with scroll, and pauses when the page is hidden.
// No libraries: a tiny perspective projection is all it needs.

type Kind = 'read' | 'edit' | 'create' | 'verify' | 'fail' | 'prompt';

interface Bar {
  a: number; // angle on the helix
  y: number; // height
  kind: Kind;
  len: number;
}

interface Star {
  x: number;
  y: number;
  z: number;
  tw: number;
}

const KINDS: [Kind, number][] = [
  ['read', 0.34],
  ['edit', 0.2],
  ['verify', 0.2],
  ['fail', 0.09],
  ['create', 0.1],
  ['prompt', 0.07],
];

// Small seeded random so the helix looks the same on every load.
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return seed / 4294967296;
  };
}

function build() {
  const r = rng(7);
  const bars: Bar[] = [];
  const N = 150;
  const turns = 4.2;
  for (let i = 0; i < N; i++) {
    const t = i / (N - 1);
    let p = r();
    let kind: Kind = 'read';
    for (const [k, w] of KINDS) {
      if ((p -= w) <= 0) {
        kind = k;
        break;
      }
    }
    bars.push({ a: t * turns * Math.PI * 2, y: (t - 0.5) * 7.2, kind, len: kind === 'fail' || kind === 'edit' ? 0.42 : 0.26 + r() * 0.12 });
  }
  const stars: Star[] = [];
  for (let i = 0; i < 160; i++) stars.push({ x: (r() - 0.5) * 14, y: (r() - 0.5) * 12, z: (r() - 0.5) * 10, tw: r() * Math.PI * 2 });
  return { bars, stars };
}

export interface Backdrop {
  sync: () => void;
  dispose: () => void;
}

export function startBackdrop(canvas: HTMLCanvasElement, isActive: () => boolean): Backdrop {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { sync: () => {}, dispose: () => {} };
  const { bars, stars } = build();
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  let colors: Record<string, string> = {};
  let dark = true;
  let w = 0;
  let h = 0;
  let dpr = 1;
  let raf = 0;
  let running = false;
  // Pointer and scroll are eased so the scene drifts rather than jumps.
  const target = { mx: 0, my: 0, sy: 0 };
  const cur = { mx: 0, my: 0, sy: 0 };
  let last = performance.now();
  let spin = 0;

  const readColors = () => {
    const cs = getComputedStyle(document.documentElement);
    const get = (n: string) => cs.getPropertyValue(n).trim() || '#888';
    colors = {
      read: get('--read'),
      edit: get('--edit'),
      create: get('--create'),
      verify: get('--verify'),
      fail: get('--fail'),
      prompt: get('--prompt'),
      accent: get('--accent'),
      text: get('--text-3'),
    };
    const theme = document.documentElement.getAttribute('data-theme');
    dark = theme ? theme === 'dark' : !matchMedia('(prefers-color-scheme: light)').matches;
  };

  const resize = () => {
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = window.innerWidth;
    h = window.innerHeight;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  };

  const frame = (now: number) => {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (!reduce.matches) spin += dt * 0.16;
    const k = reduce.matches ? 1 : 1 - Math.pow(0.0015, dt);
    cur.mx += (target.mx - cur.mx) * k;
    cur.my += (target.my - cur.my) * k;
    cur.sy += (target.sy - cur.sy) * k;
    draw();
    if (running && !reduce.matches) raf = requestAnimationFrame(frame);
  };

  const draw = () => {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    const narrow = w < 860;
    // Helix sits behind the right column on desktop, centered and fainter on phones.
    const cx = narrow ? w * 0.5 : w * 0.74;
    const cy = h * 0.5;
    const scale = Math.min(w, h) * (narrow ? 0.16 : 0.2);
    const scroll = cur.sy / Math.max(1, h);
    const ry = spin + cur.mx * 0.45 + scroll * 1.6;
    const rx = 0.32 + cur.my * 0.18;
    const rz = -0.28;
    const camZ = 7.5;
    const lift = scroll * 2.4; // the helix climbs as the page scrolls
    const cosY = Math.cos(ry),
      sinY = Math.sin(ry),
      cosX = Math.cos(rx),
      sinX = Math.sin(rx),
      cosZ = Math.cos(rz),
      sinZ = Math.sin(rz);
    const fade = Math.max(0.3, 1 - scroll * 0.55); // stays faintly visible further down the page
    const base = (dark ? 0.95 : 0.7) * (narrow ? 0.55 : 1) * fade;
    if (base <= 0.01) return;

    const project = (x: number, y: number, z: number) => {
      // rotate Y, then X, then Z, then perspective
      let x1 = x * cosY + z * sinY;
      let z1 = -x * sinY + z * cosY;
      let y1 = y * cosX - z1 * sinX;
      z1 = y * sinX + z1 * cosX;
      const x2 = x1 * cosZ - y1 * sinZ;
      y1 = x1 * sinZ + y1 * cosZ;
      x1 = x2;
      const s = camZ / (camZ + z1);
      return { x: cx + x1 * scale * s, y: cy + y1 * scale * s, s, z: z1 };
    };

    // Distant stars drift with the pointer more slowly than the helix: cheap parallax.
    ctx.globalCompositeOperation = 'source-over';
    for (const st of stars) {
      const px = w * 0.5 + (st.x / 7) * w * 0.55 - cur.mx * (6 + st.z) * 3;
      let py = h * 0.5 + (st.y / 6) * h * 0.55 - cur.my * (6 + st.z) * 2 - scroll * h * (0.15 + (st.z + 5) * 0.02);
      py = ((py % (h + 40)) + h + 40) % (h + 40) - 20;
      const tw = 0.5 + 0.5 * Math.sin(spin * 6 + st.tw);
      ctx.globalAlpha = base * (0.12 + 0.25 * tw) * (dark ? 1 : 0.6);
      ctx.fillStyle = colors.text;
      const r = 0.6 + (st.z + 5) * 0.09;
      ctx.fillRect(px, py, r, r);
    }

    type Seg = { z: number; draw: () => void };
    const segs: Seg[] = [];
    const R = 1.25;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const y = b.y + lift;
      if (y < -6 || y > 6) continue;
      const ca = Math.cos(b.a),
        sa = Math.sin(b.a);
      const p0 = project(ca * R, y, sa * R);
      const p1 = project(ca * (R + b.len), y, sa * (R + b.len));
      // The opposite strand: a dot at a + PI, joined by a faint rung every few steps.
      const q = project(-ca * R, y, -sa * R);
      const z = (p0.z + p1.z) / 2;
      const depth = Math.max(0, Math.min(1, (3 - z) / 6));
      const col = colors[b.kind];
      segs.push({
        z,
        draw: () => {
          ctx.globalAlpha = base * (0.25 + 0.75 * depth);
          ctx.strokeStyle = col;
          ctx.lineWidth = (b.kind === 'fail' ? 3.2 : 2.4) * p0.s;
          ctx.beginPath();
          ctx.moveTo(p0.x, p0.y);
          ctx.lineTo(p1.x, p1.y);
          ctx.stroke();
        },
      });
      segs.push({
        z: q.z,
        draw: () => {
          const d = Math.max(0, Math.min(1, (3 - q.z) / 6));
          ctx.globalAlpha = base * (0.15 + 0.5 * d);
          ctx.fillStyle = colors.accent;
          ctx.beginPath();
          ctx.arc(q.x, q.y, 1.6 * q.s, 0, Math.PI * 2);
          ctx.fill();
        },
      });
      if (i % 5 === 0) {
        segs.push({
          z: (p0.z + q.z) / 2 + 0.01,
          draw: () => {
            ctx.globalAlpha = base * 0.1;
            ctx.strokeStyle = colors.accent;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(p0.x, p0.y);
            ctx.lineTo(q.x, q.y);
            ctx.stroke();
          },
        });
      }
    }
    segs.sort((a, b) => b.z - a.z);
    ctx.lineCap = 'round';
    ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
    for (const s of segs) s.draw();
    ctx.globalAlpha = 1;
    ctx.globalCompositeOperation = 'source-over';
  };

  const start = () => {
    if (running) return;
    running = true;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  const sync = () => {
    if (isActive() && !document.hidden) {
      if (reduce.matches) {
        running = true;
        frame(performance.now());
      } else start();
    } else stop();
  };

  const onMove = (e: PointerEvent) => {
    target.mx = (e.clientX / Math.max(1, w)) * 2 - 1;
    target.my = (e.clientY / Math.max(1, h)) * 2 - 1;
    if (reduce.matches && running) frame(performance.now());
  };
  const onScroll = () => {
    target.sy = window.scrollY;
    if (reduce.matches && running) frame(performance.now());
  };
  const onResize = () => {
    resize();
    if (running) draw();
  };
  const onTheme = () => {
    readColors();
    if (running) draw();
  };

  readColors();
  resize();
  const themeObs = new MutationObserver(onTheme);
  themeObs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  const scheme = matchMedia('(prefers-color-scheme: light)');
  scheme.addEventListener('change', onTheme);
  reduce.addEventListener('change', sync);
  window.addEventListener('pointermove', onMove, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  document.addEventListener('visibilitychange', sync);

  return {
    sync,
    dispose: () => {
      stop();
      themeObs.disconnect();
      scheme.removeEventListener('change', onTheme);
      reduce.removeEventListener('change', sync);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      document.removeEventListener('visibilitychange', sync);
    },
  };
}
