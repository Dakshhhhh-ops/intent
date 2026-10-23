import { CanvasTexture, LinearFilter, Mesh, OrthographicCamera, PlaneGeometry, Scene, ShaderMaterial, SRGBColorSpace, Vector2, WebGLRenderer } from 'three';

// A phosphor CRT that types out an agent run. The text is drawn on a 2D canvas, then a
// fragment shader adds the tube: barrel curvature, scanlines, an aperture grille, glow,
// vignette and a little flicker. Written for Intent Replay (inspired by CRT terminal shaders).

export interface CrtLine {
  text: string;
  status?: string;
  tone?: 'ok' | 'warn' | 'bad' | 'dim' | 'head' | 'claim';
}

const COLORS = {
  text: '#8dffb0',
  dim: '#3f8f5c',
  ok: '#8dffb0',
  warn: '#ffc53d',
  bad: '#ff6166',
  head: '#d6ffe2',
};

const VERT = `
varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0.0, 1.0); }
`;

const FRAG = `
precision highp float;
uniform sampler2D uText;
uniform float uTime;
uniform vec2 uRes;
varying vec2 vUv;

vec2 curve(vec2 uv) {
  uv = uv * 2.0 - 1.0;
  vec2 o = abs(uv.yx) / vec2(5.5, 4.2);
  uv = uv + uv * o * o;
  return uv * 0.5 + 0.5;
}

vec3 sampleGlow(vec2 uv) {
  vec3 c = texture2D(uText, uv).rgb;
  vec2 px = 1.6 / uRes;
  vec3 g = vec3(0.0);
  g += texture2D(uText, uv + vec2(px.x, 0.0)).rgb;
  g += texture2D(uText, uv - vec2(px.x, 0.0)).rgb;
  g += texture2D(uText, uv + vec2(0.0, px.y)).rgb;
  g += texture2D(uText, uv - vec2(0.0, px.y)).rgb;
  g += texture2D(uText, uv + px * 2.5).rgb;
  g += texture2D(uText, uv - px * 2.5).rgb;
  return c + g * 0.16;
}

void main() {
  vec2 uv = curve(vUv);
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) { gl_FragColor = vec4(0.0, 0.0, 0.0, 1.0); return; }

  // slight chromatic split
  float ca = 0.0012;
  vec3 col;
  col.r = sampleGlow(uv + vec2(ca, 0.0)).r;
  col.g = sampleGlow(uv).g;
  col.b = sampleGlow(uv - vec2(ca, 0.0)).b;

  // phosphor background tint
  col += vec3(0.012, 0.045, 0.024);

  // scanlines + aperture grille
  float scan = 0.78 + 0.22 * sin(uv.y * uRes.y * 1.05);
  float grille = 0.9 + 0.1 * sin(uv.x * uRes.x * 2.1);
  col *= scan * grille;

  // rolling refresh band and flicker
  float band = smoothstep(0.0, 0.08, abs(fract(uv.y * 0.6 - uTime * 0.08) - 0.5));
  col *= 0.92 + 0.08 * band;
  col *= 0.97 + 0.03 * sin(uTime * 53.0);

  // vignette
  vec2 v = uv * (1.0 - uv.yx);
  col *= pow(v.x * v.y * 18.0, 0.28);

  gl_FragColor = vec4(col, 1.0);
}
`;

export function startCrt(host: HTMLElement, lines: CrtLine[]): { dispose: () => void } | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: false, alpha: false });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.domElement.className = 'crt-canvas';
  host.appendChild(renderer.domElement);

  const W = 1280;
  const H = 800;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const tex = new CanvasTexture(canvas);
  tex.colorSpace = SRGBColorSpace;
  tex.minFilter = LinearFilter;
  tex.magFilter = LinearFilter;

  const mat = new ShaderMaterial({
    vertexShader: VERT,
    fragmentShader: FRAG,
    uniforms: { uText: { value: tex }, uTime: { value: 0 }, uRes: { value: new Vector2(W, H) } },
  });
  const scene = new Scene();
  scene.add(new Mesh(new PlaneGeometry(2, 2), mat));
  const cam = new OrthographicCamera(-1, 1, 1, -1, 0, 1);

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  const FONT = '600 25px "JetBrains Mono", ui-monospace, monospace';
  const LH = 34;
  const COLS = 70;
  const left = 70;
  const top = 74;

  // Typewriter state: characters revealed so far across all lines.
  const total = lines.reduce((n, l) => n + l.text.length + (l.status ? COLS - l.text.length : 0) + 1, 0);
  let typed = 0;
  let holdUntil = 0;

  const draw = (t: number) => {
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    ctx.font = FONT;
    ctx.textBaseline = 'top';
    ctx.shadowBlur = 0;
    let budget = typed;
    const maxRows = Math.floor((H - top - 40) / LH);
    // Scroll like a real terminal once the screen is full.
    let shownRows = 0;
    const visible: { line: CrtLine; chars: number }[] = [];
    for (const line of lines) {
      if (budget <= 0) break;
      const len = line.text.length + (line.status ? COLS - line.text.length : 0) + 1;
      visible.push({ line, chars: Math.min(len, budget) });
      budget -= len;
    }
    const start = Math.max(0, visible.length - maxRows);
    visible.slice(start).forEach(({ line, chars }, row) => {
      shownRows++;
      const y = top + row * LH;
      const tone = line.tone ?? 'ok';
      const base = tone === 'dim' ? COLORS.dim : tone === 'head' ? COLORS.head : COLORS.text;
      const body = line.text.slice(0, chars);
      ctx.fillStyle = base;
      ctx.fillText(body, left, y);
      if (line.status && chars > line.text.length) {
        const charW = ctx.measureText('M').width;
        const dotsEnd = COLS - line.status.length - 1;
        const dots = Math.min(chars - line.text.length, dotsEnd - line.text.length);
        ctx.fillStyle = COLORS.dim;
        ctx.fillText(' ' + '.'.repeat(Math.max(0, dots - 1)), left + line.text.length * charW, y);
        if (chars >= dotsEnd) {
          const blinkOff = tone === 'claim' && Math.floor(t / 420) % 2 === 1;
          const c = tone === 'bad' || tone === 'claim' ? COLORS.bad : tone === 'warn' ? COLORS.warn : COLORS.ok;
          if (!blinkOff) {
            ctx.fillStyle = c;
            ctx.fillText(line.status, left + (dotsEnd + 1) * charW, y);
          }
        }
      }
    });
    // cursor
    if (Math.floor(t / 500) % 2 === 0) {
      ctx.fillStyle = COLORS.text;
      ctx.fillRect(left, top + shownRows * LH + 4, 14, 24);
    }
    tex.needsUpdate = true;
  };

  let raf = 0;
  let visibleNow = false;
  let last = 0;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (reduce) typed = total;

  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    if (t - last < 1000 / 40) return;
    last = t;
    if (!reduce) {
      if (typed < total) typed += 9;
      else if (!holdUntil) holdUntil = t + 6000;
      else if (t > holdUntil) {
        typed = 0;
        holdUntil = 0;
      }
    }
    draw(t);
    mat.uniforms.uTime.value = t / 1000;
    renderer.render(scene, cam);
  };

  draw(0);
  renderer.render(scene, cam);
  const io = new IntersectionObserver(
    ([e]) => {
      visibleNow = e.isIntersecting;
      if (visibleNow && !raf) raf = requestAnimationFrame(frame);
      if (!visibleNow && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { threshold: 0.15 },
  );
  io.observe(host);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      tex.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
