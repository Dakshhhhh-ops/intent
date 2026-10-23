import { startBackdrop } from './backdrop';
import { startEnhancer } from './enhance';
import { startExtras } from './extras';
import './fx.css';
import './sections.css';

// Mounts the home page effects: the 3D helix backdrop, the scroll/tilt layer and the
// page-wide extras. Lives outside the React tree so it never fights the app's own rendering.
export function installFx() {
  if (typeof window === 'undefined' || (window as { __IR_FX__?: boolean }).__IR_FX__) return;
  (window as { __IR_FX__?: boolean }).__IR_FX__ = true;

  const canvas = document.createElement('canvas');
  canvas.className = 'fx-backdrop';
  canvas.setAttribute('aria-hidden', 'true');
  document.body.prepend(canvas);

  let home = false;
  // Only play the rewind wipe for real navigation, not the first render after load.
  let primed = false;
  const backdrop = startBackdrop(canvas, () => home);
  const extras = startExtras();
  startEnhancer((h) => {
    home = h;
    backdrop.sync();
    extras.homeChanged(h, primed);
    primed ||= !!document.querySelector('#root > *');
  });
}
