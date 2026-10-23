import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Euler,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshBasicMaterial,
  MeshPhysicalMaterial,
  MeshStandardMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  PMREMGenerator,
  PointLight,
  Points,
  PointsMaterial,
  Quaternion,
  Scene,
  SRGBColorSpace,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// The cinematic hero. An orange flight recorder with the agent run coiled around it as tape.
// Drag spins it. Scroll (progress 0..1) unspools the coil into a straight timeline below the box,
// one coloured block per step, so HTML labels can be pinned onto individual steps.

export interface TapeStep {
  color: string;
  bad?: boolean;
}

export interface CineState {
  progress: number; // scroll, 0..1
  intro: number; // entrance, 0..1
}

export interface Anchor {
  step: number;
  el: HTMLElement;
}

const smooth = (a: number, b: number, x: number) => {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};
const lerp = (a: number, b: number, t: number) => a + (b - a) * t;

function labelTexture(steps: TapeStep[]): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 560;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0e10';
  g.fillRect(0, 0, c.width, c.height);
  for (const y of [0, c.height - 46]) {
    for (let x = -60; x < c.width + 60; x += 56) {
      g.fillStyle = '#ff801f';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 28, y);
      g.lineTo(x + 74, y + 46);
      g.lineTo(x + 46, y + 46);
      g.closePath();
      g.fill();
    }
  }
  g.fillStyle = '#f4ede4';
  g.font = '800 88px "Inter Tight Variable", Arial, sans-serif';
  g.textBaseline = 'top';
  g.fillText('INTENT REPLAY', 56, 92);
  g.font = '600 30px "JetBrains Mono", monospace';
  g.fillStyle = '#ff9a4a';
  g.fillText('AGENT FLIGHT RECORDER · DO NOT OPEN', 58, 198);
  g.fillStyle = '#8a8f98';
  g.font = '500 24px "JetBrains Mono", monospace';
  g.fillText('S/N IR-0001   ·   CLAUDE CODE / CODEX CLI', 58, 246);
  const n = steps.length;
  const bw = (c.width - 116) / n;
  steps.forEach((s, i) => {
    g.fillStyle = s.color;
    g.fillRect(58 + i * bw, 318, Math.max(2, bw - 3), s.bad ? 120 : 96);
  });
  g.fillStyle = '#5a6169';
  g.font = '500 22px "JetBrains Mono", monospace';
  g.fillText(`${n} STEPS RECORDED`, 58, 452);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 8;
  return t;
}

function radialTexture(stops: [number, string][], size = 128): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [o, col] of stops) gr.addColorStop(o, col);
  g.fillStyle = gr;
  g.fillRect(0, 0, size, size);
  return new CanvasTexture(c);
}

export function startCine(host: HTMLElement, steps: TapeStep[], state: CineState, anchors: () => Anchor[]): { dispose: () => void } | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null;
  }
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.domElement.className = 'cine-canvas';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;
  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.3, 13);

  const key = new DirectionalLight(0xffffff, 2.4);
  key.position.set(-5, 6, 7);
  scene.add(key);
  const rim = new PointLight(0x7170ff, 90, 30);
  rim.position.set(5, 2, -3);
  scene.add(rim);
  const warm = new PointLight(0xff801f, 70, 24);
  warm.position.set(-4, -3, 4);
  scene.add(warm);

  const rig = new Group();
  scene.add(rig);

  // ---------------------------------------------------------------- recorder
  const box = new Group();
  rig.add(box);
  box.add(
    new Mesh(
      new RoundedBoxGeometry(3.4, 2.1, 1.7, 6, 0.2),
      new MeshPhysicalMaterial({ color: 0xff6a10, roughness: 0.42, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
    ),
  );
  const labelTex = labelTexture(steps);
  const label = new Mesh(new PlaneGeometry(2.9, 1.59), new MeshStandardMaterial({ map: labelTex, roughness: 0.55, metalness: 0.1 }));
  label.position.z = 0.851;
  box.add(label);
  const boltGeo = new CylinderGeometry(0.07, 0.07, 0.06, 20);
  const boltMat = new MeshStandardMaterial({ color: 0x2a2b2f, roughness: 0.3, metalness: 0.9 });
  for (const [x, y] of [
    [-1.53, 0.86],
    [1.53, 0.86],
    [-1.53, -0.86],
    [1.53, -0.86],
  ]) {
    const b = new Mesh(boltGeo, boltMat);
    b.rotation.x = Math.PI / 2;
    b.position.set(x, y, 0.85);
    box.add(b);
  }
  const stripMat = new MeshStandardMaterial({ color: 0xf4ede4, roughness: 0.25, metalness: 0.2 });
  for (const x of [-0.9, 0.9]) {
    const s = new Mesh(new RoundedBoxGeometry(0.5, 0.04, 1.5, 2, 0.02), stripMat);
    s.position.set(x, 1.06, 0);
    box.add(s);
  }
  const handle = new Mesh(new RoundedBoxGeometry(1.4, 0.14, 0.18, 3, 0.06), new MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.4, metalness: 0.7 }));
  handle.position.set(0, 1.25, 0);
  box.add(handle);

  // ---------------------------------------------------------------- tape
  const N = Math.max(1, steps.length);
  const K = Math.max(3, Math.round(96 / N));
  const SEG = N * K;
  const SEG_LEN = 0.34;
  const tapeGeo = new RoundedBoxGeometry(SEG_LEN, 0.07, 0.2, 2, 0.03);
  const tapeMat = new MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.1, clearcoat: 1 });
  const tape = new InstancedMesh(tapeGeo, tapeMat, SEG);
  rig.add(tape);
  const col = new Color();
  for (let i = 0; i < SEG; i++) tape.setColorAt(i, col.set(steps[Math.floor(i / K)].color));
  if (tape.instanceColor) tape.instanceColor.needsUpdate = true;

  const R = 3.05;
  const TURNS = 1.75;
  const HEIGHT = 2.6;
  const TILT = new Quaternion().setFromEuler(new Euler(0, 0, -0.32));
  const X_AXIS = new Vector3(1, 0, 0);
  const helixPos = new Vector3();
  const helixQ = new Quaternion();
  const linePos = new Vector3();
  const pos = new Vector3();
  const q = new Quaternion();
  const scl = new Vector3();
  const m = new Matrix4();
  const tangent = new Vector3();
  const spinQ = new Quaternion();
  const Y_AXIS = new Vector3(0, 1, 0);

  // Line layout: blocks per step with small gaps between steps.
  let lineL = 13;
  const LINE_Y = -1.05;
  const gapFrac = 0.18; // of one step width
  const stepW = () => lineL / N;
  const segSpacing = () => (stepW() * (1 - gapFrac)) / K;
  const lineX = (i: number) => {
    const s = Math.floor(i / K);
    const k = i % K;
    return -lineL / 2 + s * stepW() + stepW() * gapFrac * 0.5 + (k + 0.5) * segSpacing();
  };
  const stepCenterX = (s: number) => -lineL / 2 + (s + 0.5) * stepW();

  // playhead glow
  const glowTex = radialTexture([
    [0, 'rgba(255,170,90,1)'],
    [0.35, 'rgba(255,128,31,0.45)'],
    [1, 'rgba(255,128,31,0)'],
  ]);
  const glow = new Mesh(new PlaneGeometry(1, 1), new MeshBasicMaterial({ map: glowTex, transparent: true, blending: AdditiveBlending, depthWrite: false }));
  rig.add(glow);

  // dust
  const dustGeo = new BufferGeometry();
  const DN = 300;
  const dp = new Float32Array(DN * 3);
  for (let i = 0; i < DN; i++) {
    dp[i * 3] = (Math.random() - 0.5) * 20;
    dp[i * 3 + 1] = (Math.random() - 0.5) * 10;
    dp[i * 3 + 2] = (Math.random() - 0.5) * 10 - 2;
  }
  dustGeo.setAttribute('position', new BufferAttribute(dp, 3));
  const dust = new Points(dustGeo, new PointsMaterial({ color: 0xf4ede4, size: 0.025, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(dust);

  // contact shadow
  const shadowTex = radialTexture(
    [
      [0, 'rgba(0,0,0,0.55)'],
      [1, 'rgba(0,0,0,0)'],
    ],
    256,
  );
  const shadow = new Mesh(new PlaneGeometry(8, 3), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -2.7;
  scene.add(shadow);

  // ---------------------------------------------------------------- sizing
  let W = 1;
  let H = 1;
  const resize = () => {
    W = host.clientWidth || 1;
    H = host.clientHeight || 1;
    renderer.setSize(W, H, false);
    camera.aspect = W / H;
    camera.position.z = W / H < 1 ? 17 : 13;
    camera.updateProjectionMatrix();
    const visW = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z * camera.aspect;
    lineL = Math.min(visW * 0.84, 16);
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // ---------------------------------------------------------------- drag
  let yaw = -0.38;
  let pitch = 0.12;
  let vYaw = 0;
  let vPitch = 0;
  let dragging = false;
  let lx = 0;
  let ly = 0;
  let lastInput = 0;
  const down = (e: PointerEvent) => {
    dragging = true;
    lx = e.clientX;
    ly = e.clientY;
    host.setPointerCapture?.(e.pointerId);
    host.classList.add('grabbing');
  };
  const move = (e: PointerEvent) => {
    if (!dragging) return;
    const dx = e.clientX - lx;
    const dy = e.clientY - ly;
    lx = e.clientX;
    ly = e.clientY;
    vYaw = dx * 0.006;
    vPitch = dy * 0.004;
    yaw += vYaw;
    pitch = Math.max(-0.6, Math.min(0.7, pitch + vPitch));
    lastInput = performance.now();
  };
  const up = () => {
    dragging = false;
    host.classList.remove('grabbing');
  };
  host.addEventListener('pointerdown', down);
  window.addEventListener('pointermove', move, { passive: true });
  window.addEventListener('pointerup', up);

  // ---------------------------------------------------------------- frame
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const proj = new Vector3();
  let raf = 0;
  const t0 = performance.now();

  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    const p = state.progress;
    const intro = reduce ? 1 : state.intro;
    const unspool = smooth(0.12, 0.62, p);

    // drag inertia + idle drift
    if (!dragging) {
      yaw += vYaw;
      pitch += vPitch;
      vYaw *= 0.94;
      vPitch *= 0.9;
      if (now - lastInput > 2500) {
        yaw += 0.0016 * (1 - unspool);
        pitch += (0.12 - pitch) * 0.01;
      }
    }
    // As the tape straightens, ease the view back to front-on so the timeline reads.
    const settle = smooth(0.2, 0.7, p);
    rig.rotation.y = lerp(yaw, Math.round(yaw / (Math.PI * 2)) * Math.PI * 2, settle);
    rig.rotation.x = lerp(pitch, 0.05, settle);

    // box: drops in, then rises and shrinks to make room for the timeline
    const drop = 1 - Math.pow(1 - intro, 3);
    box.position.y = lerp(6, 0, drop) + Math.sin(t * 0.9) * 0.06 * (1 - settle) + lerp(0, 1.7, settle);
    box.rotation.z = lerp(0.9, 0, drop);
    box.rotation.y = lerp(-2.4, 0, drop);
    const bs = lerp(1, 0.55, settle);
    box.scale.setScalar(bs);

    const coilR = R * smooth(0.35, 1, intro);
    const spin = t * 0.22;
    for (let i = 0; i < SEG; i++) {
      const u = i / SEG;
      // helix (coil) pose
      const a = u * Math.PI * 2 * TURNS + spin;
      helixPos.set(Math.cos(a) * coilR, -HEIGHT / 2 + u * HEIGHT, Math.sin(a) * coilR).applyQuaternion(TILT);
      tangent.set(-Math.sin(a), HEIGHT / (Math.PI * 2 * TURNS * R), Math.cos(a)).applyQuaternion(TILT).normalize();
      helixQ.setFromUnitVectors(X_AXIS, tangent);
      // staggered unspool: the end of the tape leaves the coil first
      const local = smooth(0, 1, unspool * 1.55 - (1 - u) * 0.55);
      linePos.set(lineX(i), LINE_Y, 0);
      pos.lerpVectors(helixPos, linePos, local);
      pos.y += Math.sin(local * Math.PI) * 0.9;
      pos.z += Math.sin(local * Math.PI) * 1.2;
      q.slerpQuaternions(helixQ, spinQ.identity(), local);
      const sx = lerp(1, (segSpacing() * 1.06) / SEG_LEN, local);
      const sy = lerp(1, 3.2, local);
      scl.set(sx * intro, sy * intro, lerp(1, 1.4, local) * intro);
      m.compose(pos, q, scl);
      tape.setMatrixAt(i, m);
    }
    tape.instanceMatrix.needsUpdate = true;

    // playhead: rides the coil, then sweeps the timeline
    const ph = (t * 0.07) % 1;
    if (unspool < 0.98) {
      const a = ph * Math.PI * 2 * TURNS + spin;
      glow.position.set(Math.cos(a) * coilR, -HEIGHT / 2 + ph * HEIGHT, Math.sin(a) * coilR).applyQuaternion(TILT);
    } else {
      const sweep = smooth(0.62, 0.92, p);
      glow.position.set(-lineL / 2 + sweep * lineL, LINE_Y, 0.3);
    }
    glow.quaternion.copy(camera.quaternion);
    glow.scale.setScalar(intro * (unspool > 0.98 ? 1.6 : 1));
    void Y_AXIS;
    dust.rotation.y = t * 0.02;
    shadow.position.y = -2.7;
    (shadow.material as MeshBasicMaterial).opacity = intro * (1 - settle * 0.6);

    rig.updateMatrixWorld();
    renderer.render(scene, camera);

    // pin HTML labels to step blocks on the timeline
    for (const a of anchors()) {
      proj.set(stepCenterX(a.step), LINE_Y + 0.26, 0);
      rig.localToWorld(proj);
      proj.project(camera);
      const x = (proj.x * 0.5 + 0.5) * W;
      const y = (-proj.y * 0.5 + 0.5) * H;
      a.el.style.transform = `translate(${x}px, ${y}px)`;
    }
  };
  raf = requestAnimationFrame(frame);

  const io = new IntersectionObserver(([e]) => {
    if (e.isIntersecting && !raf) raf = requestAnimationFrame(frame);
    if (!e.isIntersecting && raf) {
      cancelAnimationFrame(raf);
      raf = 0;
    }
  });
  io.observe(host);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      host.removeEventListener('pointerdown', down);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      labelTex.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
