import {
  ACESFilmicToneMapping,
  AdditiveBlending,
  BufferAttribute,
  BufferGeometry,
  CanvasTexture,
  Color,
  CylinderGeometry,
  DirectionalLight,
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

// The hero object: an orange flight recorder ("black box") with the agent run wrapped around it
// as a tape of steps. Each tape segment is coloured by what that step did.

export interface TapeStep {
  color: string;
  bad?: boolean;
}

function labelTexture(steps: TapeStep[]): CanvasTexture {
  const c = document.createElement('canvas');
  c.width = 1024;
  c.height = 560;
  const g = c.getContext('2d')!;
  g.fillStyle = '#0d0e10';
  g.fillRect(0, 0, c.width, c.height);
  // hazard stripes top and bottom
  for (const y of [0, c.height - 46]) {
    for (let x = -60; x < c.width + 60; x += 56) {
      g.fillStyle = '#ff801f';
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x + 28, y);
      g.lineTo(x + 28 + 46, y + 46);
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
  // barcode of the run
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

export function startBlackBox(host: HTMLElement, steps: TapeStep[]): { dispose: () => void } | null {
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
  renderer.domElement.className = 'bb3d-canvas';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  const pmrem = new PMREMGenerator(renderer);
  const env = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = env;

  const camera = new PerspectiveCamera(30, 1, 0.1, 100);
  camera.position.set(0, 0.6, 11);

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
  rig.position.x = 0.35;
  scene.add(rig);

  // --- the recorder
  const box = new Group();
  rig.add(box);
  const shell = new Mesh(
    new RoundedBoxGeometry(3.4, 2.1, 1.7, 6, 0.2),
    new MeshPhysicalMaterial({ color: 0xff6a10, roughness: 0.42, metalness: 0.05, clearcoat: 0.7, clearcoatRoughness: 0.25 }),
  );
  box.add(shell);
  const labelTex = labelTexture(steps);
  const label = new Mesh(new PlaneGeometry(2.9, 1.59), new MeshStandardMaterial({ map: labelTex, roughness: 0.55, metalness: 0.1 }));
  label.position.z = 0.851;
  box.add(label);
  // bolts
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
  // reflective strips on top
  const stripMat = new MeshStandardMaterial({ color: 0xf4ede4, roughness: 0.25, metalness: 0.2 });
  for (const x of [-0.9, 0.9]) {
    const s = new Mesh(new RoundedBoxGeometry(0.5, 0.04, 1.5, 2, 0.02), stripMat);
    s.position.set(x, 1.06, 0);
    box.add(s);
  }
  // handle
  const handle = new Mesh(new RoundedBoxGeometry(1.4, 0.14, 0.18, 3, 0.06), new MeshStandardMaterial({ color: 0x1a1b1e, roughness: 0.4, metalness: 0.7 }));
  handle.position.set(0, 1.25, 0);
  box.add(handle);

  // --- the tape: a helix of segments, one per step (repeated to fill the turns)
  const SEG = Math.max(90, steps.length * Math.ceil(90 / Math.max(1, steps.length)));
  const tapeGeo = new RoundedBoxGeometry(0.34, 0.07, 0.2, 2, 0.03);
  const tapeMat = new MeshPhysicalMaterial({ roughness: 0.3, metalness: 0.1, clearcoat: 1, emissive: new Color(0x000000) });
  const tape = new InstancedMesh(tapeGeo, tapeMat, SEG);
  const tapeGroup = new Group();
  tapeGroup.add(tape);
  tapeGroup.rotation.z = -0.32;
  rig.add(tapeGroup);
  const m = new Matrix4();
  const q = new Quaternion();
  const pos = new Vector3();
  const scl = new Vector3(1, 1, 1);
  const up = new Vector3(0, 1, 0);
  const R = 3.05;
  const turns = 1.75;
  const height = 2.6;
  const col = new Color();
  for (let i = 0; i < SEG; i++) {
    const t = i / SEG;
    const a = t * Math.PI * 2 * turns;
    pos.set(Math.cos(a) * R, -height / 2 + t * height, Math.sin(a) * R);
    // tangent orientation
    const tangent = new Vector3(-Math.sin(a), height / (Math.PI * 2 * turns * R), Math.cos(a)).normalize();
    q.setFromUnitVectors(new Vector3(1, 0, 0), tangent);
    const qUp = new Quaternion().setFromAxisAngle(tangent, 0);
    q.multiply(qUp);
    m.compose(pos, q, scl);
    tape.setMatrixAt(i, m);
    const s = steps[i % steps.length];
    tape.setColorAt(i, col.set(s.color));
  }
  void up;
  if (tape.instanceColor) tape.instanceColor.needsUpdate = true;

  // playhead glow that runs along the tape
  const glow = new Mesh(new PlaneGeometry(0.9, 0.9), new MeshBasicMaterial({ color: 0xff801f, transparent: true, opacity: 0.85, blending: AdditiveBlending, depthWrite: false }));
  const glowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,160,80,1)');
    gr.addColorStop(0.35, 'rgba(255,128,31,0.45)');
    gr.addColorStop(1, 'rgba(255,128,31,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 128, 128);
    return new CanvasTexture(c);
  })();
  (glow.material as MeshBasicMaterial).map = glowTex;
  tapeGroup.add(glow);

  // dust
  const dustGeo = new BufferGeometry();
  const DN = 260;
  const dp = new Float32Array(DN * 3);
  for (let i = 0; i < DN; i++) {
    dp[i * 3] = (Math.random() - 0.5) * 14;
    dp[i * 3 + 1] = (Math.random() - 0.5) * 8;
    dp[i * 3 + 2] = (Math.random() - 0.5) * 8 - 2;
  }
  dustGeo.setAttribute('position', new BufferAttribute(dp, 3));
  const dust = new Points(dustGeo, new PointsMaterial({ color: 0xf4ede4, size: 0.025, transparent: true, opacity: 0.5, depthWrite: false }));
  scene.add(dust);

  // contact shadow
  const shadowTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d')!;
    const gr = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    gr.addColorStop(0, 'rgba(0,0,0,0.55)');
    gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr;
    g.fillRect(0, 0, 256, 256);
    return new CanvasTexture(c);
  })();
  const shadow = new Mesh(new PlaneGeometry(8, 3), new MeshBasicMaterial({ map: shadowTex, transparent: true, depthWrite: false }));
  shadow.rotation.x = -Math.PI / 2;
  shadow.position.y = -2.6;
  scene.add(shadow);

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.position.z = w / h < 1 ? 15.5 : 13;
    camera.updateProjectionMatrix();
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  let tx = 0;
  let ty = 0;
  let rx = 0;
  let ry = 0;
  const onMove = (e: PointerEvent) => {
    tx = (e.clientX / innerWidth - 0.5) * 2;
    ty = (e.clientY / innerHeight - 0.5) * 2;
  };
  window.addEventListener('pointermove', onMove, { passive: true });

  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let raf = 0;
  const t0 = performance.now();
  const frame = (now: number) => {
    raf = requestAnimationFrame(frame);
    const t = (now - t0) / 1000;
    rx += (ty * 0.18 - rx) * 0.05;
    ry += (tx * 0.35 - ry) * 0.05;
    rig.rotation.x = 0.12 + rx;
    rig.rotation.y = -0.38 + ry + Math.sin(t * 0.25) * 0.06;
    box.position.y = Math.sin(t * 0.9) * 0.08;
    tapeGroup.rotation.y = t * 0.22;
    // playhead position along helix
    const p = (t * 0.07) % 1;
    const a = p * Math.PI * 2 * turns;
    glow.position.set(Math.cos(a) * R, -height / 2 + p * height, Math.sin(a) * R);
    glow.quaternion.copy(camera.quaternion);
    dust.rotation.y = t * 0.02;
    renderer.render(scene, camera);
  };
  const renderOnce = () => {
    rig.rotation.set(0.12, -0.38, 0);
    renderer.render(scene, camera);
  };
  if (reduce) renderOnce();
  const io = new IntersectionObserver(([e]) => {
    if (reduce) return;
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
      window.removeEventListener('pointermove', onMove);
      labelTex.dispose();
      env.dispose();
      pmrem.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
