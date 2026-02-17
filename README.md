<h1 align="center"><strong>reel-deal</strong></h1>

<div align="center">
<p align="center">High-performance WebGL slot reel animation for any HTMLCanvasElement.</p>

[![npm](https://img.shields.io/npm/v/reel-deal.svg?colorB=brightgreen)](https://www.npmjs.com/package/reel-deal)
[![GitHub package version](https://img.shields.io/github/package-json/v/ux-ui-pro/reel-deal.svg)](https://github.com/ux-ui-pro/reel-deal)
[![NPM Downloads](https://img.shields.io/npm/dm/reel-deal.svg?style=flat)](https://www.npmjs.org/package/reel-deal)

<a href="https://codepen.io/ux-ui/pen/azZLXja">Demo</a>
</div>
<br>

# Install
```console
yarn add reel-deal
```
<br>

# Usage (TypeScript)
```ts
import { ReelDeal } from 'reel-deal';

const reel = new ReelDeal({
  canvas: 'canvas',
  container: 'reelWrap',
  button: 'spinBtn',
  sprite: new URL('./assets/reel.png', import.meta.url).href,
  slotCount: 8,
  reels: 3,
  initialSegments: [3, 2, 0],
  queuedSpinStates: [
    { stopAtSegments: [1, 1, 0] },
    { stopAtSegments: [2, 0, 2] },
  ],
});

await reel.init();
```
<br>

# Usage (Vue 3)
```vue
<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue';
import { ReelDeal } from 'reel-deal';

const containerRef = ref<HTMLDivElement | null>(null);
const canvasRef = ref<HTMLCanvasElement | null>(null);
const buttonRef = ref<HTMLButtonElement | null>(null);
const reel = shallowRef<ReelDeal | null>(null);

onMounted(async () => {
  if (!containerRef.value || !canvasRef.value) return;
  reel.value = new ReelDeal({
    container: containerRef.value,
    canvas: canvasRef.value,
    button: buttonRef.value ?? undefined,
    sprite: new URL('./assets/reel.webp', import.meta.url).href,
    slotCount: 8,
    reels: 3,
  });
  await reel.value.init();
});

onBeforeUnmount(() => {
  reel.value?.destroy();
  reel.value = null;
});
</script>

<template>
  <button ref="buttonRef">Spin</button>
  <div ref="containerRef">
    <canvas ref="canvasRef"></canvas>
  </div>
</template>
```
— Initialize in `onMounted`, destroy in `onBeforeUnmount`.

<br>

# Usage (HTML)
```html
<button id="spinBtn">Spin</button>

<div id="reelWrap">
  <canvas id="canvas"></canvas>
</div>
```
— To enable click-to-spin, pass `button` in options.  
— Use `queuedSpinStates` for predefined spin sequences.

<br>

# Sprite format
- Single vertical spritesheet.
- Each slot is a square frame.
- Total height is `slotCount * frameWidth`.
- Recommended: use a POT texture (power-of-two), for example `256x2048` for 8 slots.
- POT textures guarantee `REPEAT + mipmap` in WebGL1. In WebGL2, mipmap also works with NPOT, but POT is still the safest default.

<br>

# Options
| Option             | Type                          | Default | Description                             |
|:-------------------|:------------------------------|:-------:|:----------------------------------------|
| `canvas`           | `HTMLCanvasElement \| string` |    —    | Canvas element or element id.           |
| `container`        | `HTMLElement \| string`       |    —    | Container element or element id.        |
| `sprite`           | `string \| HTMLImageElement`  |    —    | Sprite sheet URL or image element.      |
| `slotCount`        | `number`                      |    —    | Number of frames in the sprite.         |
| `reels`            | `number`                      |   `1`   | Number of reels (1–5).                  |
| `initialSegments`  | `number[]`                    |    —    | Initial stop index per reel.            |
| `button`           | `HTMLButtonElement \| string` |    —    | Optional spin button element or DOM id. |
| `queuedSpinStates` | `ReelDealSpinState[]`         |    —    | Optional queue of predefined spins.     |
<br>

# Queue item type
```ts
type ReelDealSpinState = {
  stopAtSegments: number[];
  callback?: (spinIndex: number, stopAtSegments: number[]) => void;
};
```
<br>

# Methods
```ts
await reel.init();

reel.destroy();
```
<br>

# License
MIT
