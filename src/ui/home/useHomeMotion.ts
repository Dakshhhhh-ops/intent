import gsap from 'gsap';
import { ScrollTrigger } from 'gsap/ScrollTrigger';
import { SplitText } from 'gsap/SplitText';
import Lenis from 'lenis';
import { useEffect, type RefObject } from 'react';

gsap.registerPlugin(ScrollTrigger, SplitText);

// Home-page motion: Lenis smooth scrolling wired into GSAP's ticker, line-by-line text reveals
// for anything marked [data-reveal], and fade-up for [data-rise]. Everything is torn down when
// the home page unmounts, so the analysis views keep plain native scrolling.
export function useHomeMotion(root: RefObject<HTMLElement | null>) {
  useEffect(() => {
    const el = root.current;
    if (!el) return;
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

    let lenis: Lenis | null = null;
    const tick = (t: number) => lenis?.raf(t * 1000);
    if (!reduce) {
      lenis = new Lenis({ lerp: 0.1, smoothWheel: true, anchors: { offset: -60 } });
      lenis.on('scroll', ScrollTrigger.update);
      gsap.ticker.add(tick);
      gsap.ticker.lagSmoothing(0);
    }

    const ctx = gsap.context(() => {
      if (reduce) return;
      // Headlines: split into lines and slide each one up from behind a mask.
      el.querySelectorAll<HTMLElement>('[data-reveal]').forEach((node) => {
        const split = SplitText.create(node, { type: 'lines', mask: 'lines', linesClass: 'reveal-line' });
        gsap.from(split.lines, {
          yPercent: 110,
          duration: 1.1,
          ease: 'expo.out',
          stagger: 0.08,
          delay: node.dataset.revealDelay ? Number(node.dataset.revealDelay) : 0,
          scrollTrigger: node.hasAttribute('data-reveal-now') ? undefined : { trigger: node, start: 'top 88%' },
        });
      });
      // Blocks: rise and fade in.
      el.querySelectorAll<HTMLElement>('[data-rise]').forEach((node) => {
        gsap.from(node, {
          y: 40,
          opacity: 0,
          duration: 1,
          ease: 'power3.out',
          delay: node.dataset.riseDelay ? Number(node.dataset.riseDelay) : 0,
          scrollTrigger: node.hasAttribute('data-rise-now') ? undefined : { trigger: node, start: 'top 90%' },
        });
      });
      // Lists: stagger children in.
      el.querySelectorAll<HTMLElement>('[data-stagger]').forEach((node) => {
        gsap.from(node.children, {
          y: 30,
          opacity: 0,
          duration: 0.9,
          ease: 'power3.out',
          stagger: 0.07,
          scrollTrigger: { trigger: node, start: 'top 88%' },
        });
      });
    }, el);

    return () => {
      ctx.revert();
      gsap.ticker.remove(tick);
      lenis?.destroy();
      ScrollTrigger.getAll().forEach((t) => t.kill());
    };
  }, [root]);
}

export { gsap, ScrollTrigger };
