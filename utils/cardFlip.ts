import React, { useEffect, useRef, useCallback } from 'react';
import { animate, useMotionValue, useTransform, MotionValue } from 'framer-motion';

export interface CardFlip3DControls {
  flipRotateY: MotionValue<number>;
  frontVisibility: MotionValue<'visible' | 'hidden'>;
  frontOpacity: MotionValue<number>;
  backVisibility: MotionValue<'visible' | 'hidden'>;
  backOpacity: MotionValue<number>;
  flipContainerStyle: React.CSSProperties;
  frontPlaneStyle: React.CSSProperties;
  backPlaneStyle: React.CSSProperties;
  resetFlipInstant: (flipped?: boolean) => void;
}

/**
 * Provides an iOS WebKit-safe 3D card flip controller.
 *
 * On iOS Safari / WKWebView, descendants inside a `backface-visibility: hidden`
 * face that get promoted to their own composited `CALayer` (such as `z-index`,
 * `<motion.div>` overlays, `opacity < 1`, or scroll containers) can ignore the
 * parent's backface culling and bleed onto the opposite face in a mirrored
 * (`rotateY(180deg)`) orientation.
 *
 * Combining explicit 3D plane separation (`rotateY(0deg) translateZ(1px)` vs
 * `rotateY(180deg) translateZ(1px)`) with exact 90-degree midpoint `opacity` and
 * `visibility` culling guarantees zero bleed-through on all browsers and devices
 * while preserving the smooth spring 3D rotation.
 */
export function useCardFlip3D(isFlipped: boolean): CardFlip3DControls {
  const flipRotateY = useMotionValue(isFlipped ? 180 : 0);
  const isFirstRender = useRef(true);

  useEffect(() => {
    const targetDeg = isFlipped ? 180 : 0;
    if (isFirstRender.current) {
      isFirstRender.current = false;
      flipRotateY.set(targetDeg);
      return;
    }

    const controls = animate(flipRotateY, targetDeg, {
      type: 'spring',
      stiffness: 260,
      damping: 20,
    });
    return () => controls.stop();
  }, [isFlipped, flipRotateY]);

  const resetFlipInstant = useCallback(
    (flipped = false) => {
      flipRotateY.stop();
      flipRotateY.set(flipped ? 180 : 0);
    },
    [flipRotateY]
  );

  // Swap face visibility & opacity at the exact 90° edge-on frame (handles slight spring overshoot < 270°)
  const isBackFacingCamera = (deg: number) => {
    const norm = ((deg % 360) + 360) % 360;
    return norm > 90 && norm < 270;
  };

  const frontVisibility = useTransform(flipRotateY, (deg) =>
    isBackFacingCamera(deg) ? 'hidden' : 'visible'
  );
  const frontOpacity = useTransform(flipRotateY, (deg) =>
    isBackFacingCamera(deg) ? 0 : 1
  );
  const backVisibility = useTransform(flipRotateY, (deg) =>
    isBackFacingCamera(deg) ? 'visible' : 'hidden'
  );
  const backOpacity = useTransform(flipRotateY, (deg) =>
    isBackFacingCamera(deg) ? 1 : 0
  );

  const flipContainerStyle: React.CSSProperties = {
    transformStyle: 'preserve-3d',
    WebkitTransformStyle: 'preserve-3d',
  };

  const frontPlaneStyle: React.CSSProperties = {
    transform: 'rotateY(0deg) translateZ(1px)',
    WebkitTransform: 'rotateY(0deg) translateZ(1px)',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    pointerEvents: isFlipped ? 'none' : 'auto',
  };

  const backPlaneStyle: React.CSSProperties = {
    transform: 'rotateY(180deg) translateZ(1px)',
    WebkitTransform: 'rotateY(180deg) translateZ(1px)',
    backfaceVisibility: 'hidden',
    WebkitBackfaceVisibility: 'hidden',
    pointerEvents: isFlipped ? 'auto' : 'none',
  };

  return {
    flipRotateY,
    frontVisibility,
    frontOpacity,
    backVisibility,
    backOpacity,
    flipContainerStyle,
    frontPlaneStyle,
    backPlaneStyle,
    resetFlipInstant,
  };
}
