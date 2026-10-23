import { startBackdrop } from './backdrop';
import { startEnhancer } from './enhance';
import './fx.css';

// Mounts the home page effects: the 3D helix backdrop and the scroll/tilt layer.
// Lives outside the React tree so it never fights the app's own rendering.
export function installFx() {
  if (typeof window === 'undefined' || (window as { __IR_FX__?: boolean }).__IR_FX__) return;
  (window as { __IR_FX__?: boolean }).__IR_FX__ = true;

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-backdrop';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  let home = false;
  const backdrop = startBackdrop(canvas, () => home);
  startEnhancer((h) => {
    home = h;
    backdrop.sync();
  });
}
