import type { ReelDealSpriteSource } from '../types';

export type LoadedSprite = {
  image: HTMLImageElement;
  spriteWidth: number;
  spriteHeight: number;
  frameHeight: number;
  slotCount: number;
};

const waitImageLoad = (img: HTMLImageElement): Promise<void> =>
  new Promise<void>((resolve, reject) => {
    const onLoad = (): void => resolve();
    const onError = (): void => reject(new Error('Failed to load sprite image'));

    img.addEventListener('load', onLoad, { once: true });
    img.addEventListener('error', onError, { once: true });
  });

export const loadSprite = async (
  sprite: ReelDealSpriteSource,
  slotCountRaw: number,
): Promise<LoadedSprite> => {
  const img = typeof sprite === 'string' ? new Image() : sprite;

  if (typeof sprite === 'string') {
    img.src = sprite;
  }

  if (!img.complete || img.naturalWidth <= 0) {
    await waitImageLoad(img);
  }

  const slotCount = Math.max(1, Math.floor(slotCountRaw));
  const spriteWidth = img.naturalWidth;
  const frameHeight = spriteWidth;
  const expectedSpriteHeight = frameHeight * slotCount;

  const naturalHeight = img.naturalHeight;
  const diff = Math.abs(naturalHeight - expectedSpriteHeight);

  if (diff > 2) {
    throw new Error(
      `Sprite size mismatch. Expected height ~${Math.round(expectedSpriteHeight)}px (slotCount=${slotCount}, slot aspect 1/1), got ${naturalHeight}px.`,
    );
  }

  return {
    image: img,
    spriteWidth,
    frameHeight: Math.max(1, Math.round(frameHeight)),
    spriteHeight: Math.max(1, Math.round(frameHeight * slotCount)),
    slotCount,
  };
};
