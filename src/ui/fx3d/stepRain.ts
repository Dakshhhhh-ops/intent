import {
  ACESFilmicToneMapping,
  Color,
  DirectionalLight,
  Euler,
  FogExp2,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  MeshPhysicalMaterial,
  PerspectiveCamera,
  PMREMGenerator,
  Plane,
  PointLight,
  Quaternion,
  Raycaster,
  Scene,
  SRGBColorSpace,
  Vector2,
  Vector3,
  WebGLRenderer,
} from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { RoundedBoxGeometry } from 'three/examples/jsm/geometries/RoundedBoxGeometry.js';

// "Step rain": the steps of an agent run as glossy capsules pouring through a dark field.
// Blue reads, amber edits, jade creates, teal commands, slate talk, and a few red failures.
// The pointer pushes capsules away; they drift back into the stream.

const PALETTE: [string, number][] = [
  ['#5a6169', 0.3], // talk
  ['#70b8ff', 0.22], // read
  ['#ffc53d', 0.18], // edit
  ['#0bd8b6', 0.14], // command
  ['#1fd8a4', 0.08], // create
  ['#ec5d5e', 0.05], // failure
  ['#b1a9ff', 0.03], // prompt
];

export interface StepRain {
  dispose: () => void;
}

export function startStepRain(host: HTMLElement, opts: { count?: number; still?: boolean } = {}): StepRain | null {
  let renderer: WebGLRenderer;
  try {
    renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: 'high-performance' });
  } catch {
    return null; // no WebGL: the footer still reads fine without it
  }
  const count = opts.count ?? (matchMedia('(max-width: 700px)').matches ? 140 : 320);
  renderer.setPixelRatio(Math.min(1.75, window.devicePixelRatio || 1));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.domElement.className = 'step-rain-canvas';
  host.appendChild(renderer.domElement);

  const scene = new Scene();
  scene.fog = new FogExp2(0x08090a, 0.06);
  // Soft studio reflections make the bars read as glossy objects.
  const pmrem = new PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  const camera = new PerspectiveCamera(38, 1, 0.1, 80);
  camera.position.set(0, 0, 14);

  scene.add(new HemisphereLight(0xcfd6ff, 0x0b0b0e, 0.55));
  const key = new DirectionalLight(0xffffff, 2.2);
  key.position.set(-6, 8, 10);
  scene.add(key);
  const rim = new PointLight(0x7170ff, 60, 30);
  rim.position.set(6, -3, 4);
  scene.add(rim);
  const warm = new PointLight(0xff9a4a, 40, 26);
  warm.position.set(-7, 4, 2);
  scene.add(warm);

  // Rounded bars: the same shape as segments of the replay tape.
  const geo = new RoundedBoxGeometry(0.78, 0.24, 0.24, 4, 0.1);
  const mat = new MeshPhysicalMaterial({ roughness: 0.36, metalness: 0.0, clearcoat: 1, clearcoatRoughness: 0.2, envMapIntensity: 0.45 });
  const mesh = new InstancedMesh(geo, mat, count);
  scene.add(mesh);

  // Per-capsule state
  const pos = new Float32Array(count * 3);
  const vel = new Float32Array(count * 3);
  const rot = new Float32Array(count * 3);
  const spin = new Float32Array(count * 3);
  const scale = new Float32Array(count);
  const color = new Color();
  let bounds = { w: 20, h: 12 };

  const pickColor = () => {
    let r = Math.random();
    for (const [c, w] of PALETTE) {
      if ((r -= w) <= 0) return c;
    }
    return PALETTE[0][0];
  };

  const spawn = (i: number, anywhere: boolean) => {
    const z = -9 + Math.random() * 11; // depth band
    // Pour from the upper left toward the lower right, like a stream of beans.
    const t = anywhere ? Math.random() : 0;
    // Gaussian-ish spread across the stream so it is dense in the middle and thin at the edges.
    const spread = (Math.random() + Math.random() + Math.random() - 1.5) * bounds.w * 0.22;
    const x0 = -bounds.w * 0.55 + spread;
    const y0 = bounds.h * 0.7 + spread * 0.55 + Math.random() * 1.5;
    pos[i * 3] = x0 + t * bounds.w * 0.95;
    pos[i * 3 + 1] = y0 - t * bounds.h * 1.35;
    pos[i * 3 + 2] = z;
    vel[i * 3] = 0.018 + Math.random() * 0.02;
    vel[i * 3 + 1] = -(0.022 + Math.random() * 0.03);
    vel[i * 3 + 2] = 0;
    rot[i * 3] = Math.random() * Math.PI * 2;
    rot[i * 3 + 1] = Math.random() * Math.PI * 2;
    rot[i * 3 + 2] = Math.random() * Math.PI * 2;
    spin[i * 3] = (Math.random() - 0.5) * 0.03;
    spin[i * 3 + 1] = (Math.random() - 0.5) * 0.03;
    spin[i * 3 + 2] = (Math.random() - 0.5) * 0.03;
    scale[i] = 0.7 + Math.random() * 0.65;
  };

  for (let i = 0; i < count; i++) {
    spawn(i, true);
    mesh.setColorAt(i, color.set(pickColor()));
  }
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;

  const resize = () => {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const vh = 2 * Math.tan((camera.fov * Math.PI) / 360) * camera.position.z;
    bounds = { w: vh * camera.aspect, h: vh };
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);

  // Pointer → world point on the z=0 plane
  const ray = new Raycaster();
  const ndc = new Vector2(9, 9);
  const plane = new Plane(new Vector3(0, 0, 1), 0);
  const hit = new Vector3(999, 999, 0);
  let pointerActive = false;
  const onMove = (e: PointerEvent) => {
    const r = host.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    ray.ray.intersectPlane(plane, hit);
    pointerActive = true;
  };
  const onLeave = () => (pointerActive = false);
  window.addEventListener('pointermove', onMove, { passive: true });
  host.addEventListener('pointerleave', onLeave);

  const m4 = new Matrix4();
  const q = new Quaternion();
  const s = new Vector3();
  const p = new Vector3();
  const euler = new Euler();

  const step = () => {
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      // Pointer repulsion (in the plane, weaker with depth)
      if (pointerActive) {
        const dx = pos[ix] - hit.x;
        const dy = pos[ix + 1] - hit.y;
        const depth = 1 - Math.min(1, Math.abs(pos[ix + 2]) / 9);
        const d2 = dx * dx + dy * dy;
        const R = 2.4;
        if (d2 < R * R && d2 > 0.0001) {
          const d = Math.sqrt(d2);
          const f = ((R - d) / R) * 0.05 * depth;
          vel[ix] += (dx / d) * f;
          vel[ix + 1] += (dy / d) * f;
          spin[ix] += f * 0.4;
          spin[ix + 2] -= f * 0.4;
        }
      }
      // Relax back toward the pour direction
      vel[ix] += (0.026 - vel[ix]) * 0.02;
      vel[ix + 1] += (-0.034 - vel[ix + 1]) * 0.02;
      pos[ix] += vel[ix];
      pos[ix + 1] += vel[ix + 1];
      rot[ix] += spin[ix];
      rot[ix + 1] += spin[ix + 1];
      rot[ix + 2] += spin[ix + 2];
      spin[ix] *= 0.995;
      spin[ix + 2] *= 0.995;
      if (pos[ix + 1] < -bounds.h * 0.7 || pos[ix] > bounds.w * 0.7) spawn(i, false);
    }
  };

  const write = () => {
    for (let i = 0; i < count; i++) {
      const ix = i * 3;
      euler.set(rot[ix], rot[ix + 1], rot[ix + 2]);
      q.setFromEuler(euler);
      p.set(pos[ix], pos[ix + 1], pos[ix + 2]);
      s.setScalar(scale[i]);
      m4.compose(p, q, s);
      mesh.setMatrixAt(i, m4);
    }
    mesh.instanceMatrix.needsUpdate = true;
  };

  let raf = 0;
  let visible = false;
  let last = 0;
  const frame = (t: number) => {
    raf = requestAnimationFrame(frame);
    if (t - last < 1000 / 60 - 2) return;
    last = t;
    step();
    write();
    renderer.render(scene, camera);
  };

  const still = opts.still ?? matchMedia('(prefers-reduced-motion: reduce)').matches;
  // Pre-warm so the first visible frame already looks like a stream.
  for (let k = 0; k < 120; k++) step();
  write();
  renderer.render(scene, camera);

  const io = new IntersectionObserver(
    ([entry]) => {
      visible = entry.isIntersecting;
      if (visible && !still && !raf) raf = requestAnimationFrame(frame);
      if (!visible && raf) {
        cancelAnimationFrame(raf);
        raf = 0;
      }
    },
    { rootMargin: '120px' },
  );
  io.observe(host);

  return {
    dispose() {
      cancelAnimationFrame(raf);
      io.disconnect();
      ro.disconnect();
      window.removeEventListener('pointermove', onMove);
      host.removeEventListener('pointerleave', onLeave);
      geo.dispose();
      envTex.dispose();
      pmrem.dispose();
      mat.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
}
