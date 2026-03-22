# reel-deal

High-performance WebGL slot reel animation for any `HTMLCanvasElement`.

[![npm](https://img.shields.io/npm/v/reel-deal.svg?colorB=brightgreen)](https://www.npmjs.com/package/reel-deal)
[![GitHub package version](https://img.shields.io/github/package-json/v/ux-ui-pro/reel-deal.svg)](https://github.com/ux-ui-pro/reel-deal)
[![NPM Downloads](https://img.shields.io/npm/dm/reel-deal.svg?style=flat)](https://www.npmjs.org/package/reel-deal)

[Demo](https://codepen.io/ux-ui/pen/azZLXja)

## Install

```console
yarn add reel-deal
```

## Quick Start

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
  spinConfig: {
    minSpins: 2,
    durationMs: 1200,
    extraSpinsPerReel: 1,
  },
  spinBlur: {
    maxPx: 4,
    speedAtMax: 2200,
  },
  webglShading: {
    highlightEnabled: true,
    highlightIntensity: 0.92,
  },
});

await reel.init();
```

## Programmatic Control

You can spin from a predefined queue or trigger spins directly in code.

```ts
import { ReelDeal } from 'reel-deal';

const reel = new ReelDeal({
  canvas,
  container,
  sprite: spriteUrl,
  slotCount: 8,
  reels: 3,
  adaptiveDpr: true,
});

await reel.init();

reel.enqueueSpin([
  { stopAtSegments: [0, 3, 2] },
  { stopAtSegments: [4, 1, 6] },
]);

if (reel.hasPendingSpins()) {
  await reel.spin();
}

await reel.spin({
  stopAtSegments: [2, 2, 5],
  callback: (spinIndex, stops) => {
    console.log('Spin finished', spinIndex, stops);
  },
});
```

## Vue 3

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

## HTML Markup

```html
<button id="spinBtn">Spin</button>

<div id="reelWrap">
  <canvas id="canvas"></canvas>
</div>
```

Pass `button` in options to enable click-to-spin. Use `queuedSpinStates` or `enqueueSpin()` for predefined spin sequences.

## Sprite Format

- Use a single vertical spritesheet.
- Each slot should be a square frame.
- Total image height should equal `slotCount * frameWidth`.
- Transparent `PNG` and `WebP` work well.
- A power-of-two texture is recommended, for example `256x2048` for 8 slots.
- POT textures are the safest choice for `REPEAT + mipmap`, especially in WebGL1.

## Options

| Option | Type | Default | Description |
|:--|:--|:--|:--|
| `canvas` | `HTMLCanvasElement \| string` | — | Canvas element or element id. |
| `container` | `HTMLElement \| string` | — | Container element or element id. |
| `sprite` | `string \| HTMLImageElement` | — | Sprite sheet URL or image element. |
| `slotCount` | `number` | — | Number of symbol frames in the sprite. |
| `reels` | `number` | `1` | Number of reels from `1` to `5`. |
| `initialSegments` | `number[]` | `[]` | Initial visible stop index per reel. |
| `button` | `HTMLButtonElement \| string` | — | Optional button used for click-to-spin. |
| `queuedSpinStates` | `ReelDealSpinState[]` | `[]` | Initial queue of scripted spins. |
| `spinConfig` | `Partial<ReelDealSpinConfig>` | internal defaults | Spin distance and duration tuning. |
| `spinBlur` | `Partial<ReelDealSpinBlur>` | internal defaults | Motion blur strength and speed mapping. |
| `idleBob` | `Partial<ReelDealIdleBob> \| false` | internal defaults | Idle movement tuning, or disable it with `false`. |
| `webglShading` | `Partial<ReelDealWebGLShading>` | internal defaults | Warp and highlight shading controls. |
| `maxDpr` | `number` | `2` | Maximum device-pixel-ratio used by the renderer. |
| `adaptiveDpr` | `boolean` | `true` | Dynamically lowers DPR on coarse-pointer devices when frame time degrades. |

## Public Types

```ts
type ReelDealSpinState = {
  stopAtSegments: number[];
  callback?: (spinIndex: number, stopAtSegments: number[]) => void;
};

type ReelDealSpinConfig = {
  minSpins: number;
  durationMs?: number;
  speedPxS?: number;
  speedSymbolsS?: number;
  extraSpinsPerReel?: number;
};

type ReelDealSpinBlur = {
  maxPx: number;
  speedAtMax: number;
};

type ReelDealIdleBob = {
  amplitudePx: number;
  speedHz: number;
  phaseOffsetRad: number;
  rampMs: number;
  idleDelayMs: number;
};

type ReelDealWebGLShading = {
  warpAngleDeg: number;
  edgePower: number;
  highlightEnabled?: boolean;
  highlightIntensity?: number;
  highlightRadiusPx?: number;
};

type ReelDealPhase = 'idle' | 'spinning' | 'settling' | 'highlight';
```

## Methods

```ts
await reel.init();
await reel.spin();
await reel.spin({ stopAtSegments: [1, 4, 2] });

reel.enqueueSpin({ stopAtSegments: [0, 3, 5] });
reel.clearQueuedSpins();

const hasPending = reel.hasPendingSpins();

reel.destroy();
```

## Notes

- The animation runtime uses a fixed-step simulation loop with interpolation for more stable motion across varying frame rates.
- Highlight shading is animated in the shader and fades in automatically when the queue becomes empty.
- `destroy()` should be called when the instance is no longer needed.

## License

MIT
