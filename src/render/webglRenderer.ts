import type { ReelDealSpinBlur, ReelDealWebGLShading } from '../types';
import { clamp01, mod } from '../utils/math';
import { reelFragmentShader, reelVertexShader } from './shaders';

export type RendererInit = {
  canvas: HTMLCanvasElement;
  spriteImg: HTMLImageElement;
  spriteWidth: number;
  spriteHeight: number;
  frameHeight: number;
  reels: number;
  visibleSlots: number;
  heightScale: number;
  spinBlur: ReelDealSpinBlur;
  webglShading: ReelDealWebGLShading;
};

export type RenderFrame = {
  offsets: ArrayLike<number>;
  velocities: ArrayLike<number>;
  dpr: number;
  highlightActive?: boolean;
  highlightFade?: number;
};

export interface Renderer {
  init(init: RendererInit): void;
  render(frame: RenderFrame): void;
  onResize(width: number, height: number): void;
  dispose(): void;
  getError(): string | null;
}

type WebGLAttribs = { pos: number; uv: number };
type WebGLUniforms = {
  texture: WebGLUniformLocation | null;
  reelX: WebGLUniformLocation | null;
  reelW: WebGLUniformLocation | null;
  offsetPx: WebGLUniformLocation | null;
  frameHeight: WebGLUniformLocation | null;
  spriteHeight: WebGLUniformLocation | null;
  visibleSlots: WebGLUniformLocation | null;
  heightScale: WebGLUniformLocation | null;
  edgePower: WebGLUniformLocation | null;
  warpAngle: WebGLUniformLocation | null;
  blurPx: WebGLUniformLocation | null;
  time: WebGLUniformLocation | null;
  highlightEnabled: WebGLUniformLocation | null;
  highlightIntensity: WebGLUniformLocation | null;
  highlightRadiusPx: WebGLUniformLocation | null;
  highlightFade: WebGLUniformLocation | null;
  spriteWidth: WebGLUniformLocation | null;
  repeatWrap: WebGLUniformLocation | null;
};

export class WebGLRenderer implements Renderer {
  private gl: WebGLRenderingContext | WebGL2RenderingContext | null = null;
  private glProgram: WebGLProgram | null = null;
  private glBuffer: WebGLBuffer | null = null;
  private glTexture: WebGLTexture | null = null;
  private glAttribs: WebGLAttribs | null = null;
  private glUniforms: WebGLUniforms | null = null;
  private textureRepeatEnabled = false;

  private config: Omit<RendererInit, 'canvas' | 'spriteImg'> | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private spriteImg: HTMLImageElement | null = null;
  private webglInitError: string | null = null;

  init(init: RendererInit): void {
    this.canvas = init.canvas;
    this.spriteImg = init.spriteImg;
    this.config = {
      spriteWidth: init.spriteWidth,
      spriteHeight: init.spriteHeight,
      frameHeight: init.frameHeight,
      reels: init.reels,
      visibleSlots: init.visibleSlots,
      heightScale: init.heightScale,
      spinBlur: init.spinBlur,
      webglShading: init.webglShading,
    };

    this.tryInitWebGL();

    if (!this.gl) {
      throw new Error(
        `WebGL is not supported or failed to initialize. ${this.webglInitError ?? ''}`.trim(),
      );
    }
  }

  getError(): string | null {
    return this.webglInitError;
  }

  render(frame: RenderFrame): void {
    if (!this.gl || !this.config || !this.spriteImg) return;
    if (!this.glProgram || !this.glAttribs || !this.glUniforms || !this.glBuffer) return;

    this.renderWebGL(frame);
  }

  onResize(width: number, height: number): void {
    if (!this.gl || !this.canvas) return;

    this.gl.viewport(0, 0, width, height);
  }

  dispose(): void {
    if (!this.gl) return;
    if (this.glTexture) this.gl.deleteTexture(this.glTexture);
    if (this.glBuffer) this.gl.deleteBuffer(this.glBuffer);
    if (this.glProgram) this.gl.deleteProgram(this.glProgram);

    this.glTexture = null;
    this.glBuffer = null;
    this.glProgram = null;
    this.glAttribs = null;
    this.glUniforms = null;
    this.gl = null;
    this.webglInitError = null;
  }

  private tryInitWebGL(): void {
    if (!this.canvas || !this.spriteImg || !this.config) return;

    this.dispose();
    this.webglInitError = null;

    const gl =
      (this.canvas.getContext('webgl2', {
        antialias: true,
        alpha: true,
      }) as WebGL2RenderingContext | null) ??
      (this.canvas.getContext('webgl', {
        antialias: true,
        alpha: true,
      }) as WebGLRenderingContext | null) ??
      (this.canvas.getContext('experimental-webgl', {
        antialias: true,
        alpha: true,
      }) as WebGLRenderingContext | null);

    if (!gl) {
      const fallback = document.createElement('canvas');
      const canWebGL = typeof WebGLRenderingContext !== 'undefined';
      const fallbackGl =
        (fallback.getContext('webgl2') as WebGL2RenderingContext | null) ??
        (fallback.getContext('webgl') as WebGLRenderingContext | null);

      this.webglInitError = `context is null (browser WebGL=${canWebGL ? 'yes' : 'no'}, fallback canvas=${fallbackGl ? 'yes' : 'no'})`;

      console.warn('ReelDeal WebGL:', this.webglInitError);

      return;
    }

    const program = this.createWebGLProgram(gl, reelVertexShader, reelFragmentShader);

    if (!program) {
      this.webglInitError = 'shader program failed to compile/link (see console)';

      console.warn('ReelDeal WebGL:', this.webglInitError);

      return;
    }

    const buffer = gl.createBuffer();

    if (!buffer) {
      this.webglInitError = 'failed to create vertex buffer';

      console.warn('ReelDeal WebGL:', this.webglInitError);

      gl.deleteProgram(program);

      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    const quad = new Float32Array([-1, -1, 0, 1, 1, -1, 1, 1, -1, 1, 0, 0, 1, 1, 1, 0]);

    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    const texture = gl.createTexture();

    if (!texture) {
      this.webglInitError = 'failed to create texture';

      console.warn('ReelDeal WebGL:', this.webglInitError);

      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);

      return;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 1);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, this.spriteImg);
    gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, 0);

    const isPowerOfTwo = (n: number): boolean => n > 0 && (n & (n - 1)) === 0;
    const isWebGL2 =
      typeof WebGL2RenderingContext !== 'undefined' && gl instanceof WebGL2RenderingContext;
    const pot = isPowerOfTwo(this.config.spriteWidth) && isPowerOfTwo(this.config.spriteHeight);

    if (pot || isWebGL2) {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      this.textureRepeatEnabled = true;
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      this.textureRepeatEnabled = false;
    }

    gl.useProgram(program);
    gl.clearColor(0, 0, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    this.gl = gl;
    this.glProgram = program;
    this.glBuffer = buffer;
    this.glTexture = texture;
    this.glAttribs = {
      pos: gl.getAttribLocation(program, 'a_pos'),
      uv: gl.getAttribLocation(program, 'a_uv'),
    };
    this.glUniforms = {
      texture: gl.getUniformLocation(program, 'u_tex'),
      reelX: gl.getUniformLocation(program, 'u_reelX'),
      reelW: gl.getUniformLocation(program, 'u_reelW'),
      offsetPx: gl.getUniformLocation(program, 'u_offsetPx'),
      frameHeight: gl.getUniformLocation(program, 'u_frameHeight'),
      spriteHeight: gl.getUniformLocation(program, 'u_spriteHeight'),
      visibleSlots: gl.getUniformLocation(program, 'u_visibleSlots'),
      heightScale: gl.getUniformLocation(program, 'u_heightScale'),
      edgePower: gl.getUniformLocation(program, 'u_edgePower'),
      warpAngle: gl.getUniformLocation(program, 'u_warpAngle'),
      blurPx: gl.getUniformLocation(program, 'u_blurPx'),
      time: gl.getUniformLocation(program, 'u_time'),
      highlightEnabled: gl.getUniformLocation(program, 'u_highlightEnabled'),
      highlightIntensity: gl.getUniformLocation(program, 'u_highlightIntensity'),
      highlightRadiusPx: gl.getUniformLocation(program, 'u_highlightRadiusPx'),
      highlightFade: gl.getUniformLocation(program, 'u_highlightFade'),
      spriteWidth: gl.getUniformLocation(program, 'u_spriteWidth'),
      repeatWrap: gl.getUniformLocation(program, 'u_repeatWrap'),
    };
  }

  private createWebGLProgram(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    vsSource: string,
    fsSource: string,
  ): WebGLProgram | null {
    const vs = this.createWebGLShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.createWebGLShader(gl, gl.FRAGMENT_SHADER, fsSource);

    if (!vs || !fs) {
      if (vs) gl.deleteShader(vs);
      if (fs) gl.deleteShader(fs);

      return null;
    }

    const program = gl.createProgram();

    if (!program) return null;

    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.linkProgram(program);

    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const info = gl.getProgramInfoLog(program) ?? 'unknown link error';

      this.webglInitError = `program link failed: ${info}`;

      console.warn('ReelDeal WebGL: program link failed', info);

      gl.deleteProgram(program);
      gl.deleteShader(vs);
      gl.deleteShader(fs);

      return null;
    }

    gl.detachShader(program, vs);
    gl.detachShader(program, fs);
    gl.deleteShader(vs);
    gl.deleteShader(fs);

    return program;
  }

  private createWebGLShader(
    gl: WebGLRenderingContext | WebGL2RenderingContext,
    type: number,
    source: string,
  ): WebGLShader | null {
    const shader = gl.createShader(type);

    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      const info = gl.getShaderInfoLog(shader) ?? 'unknown compile error';

      this.webglInitError = `shader compile failed: ${info}`;

      console.warn('ReelDeal WebGL: shader compile failed', info);

      gl.deleteShader(shader);

      return null;
    }

    return shader;
  }

  private getSpinBlurPxForReel(reel: number, velocities: ArrayLike<number>): number {
    if (!this.config) return 0;

    const speed = Math.abs(velocities[reel] ?? 0);
    const speedAtMax = Math.max(1, this.config.spinBlur.speedAtMax);
    const t = clamp01(speed / speedAtMax);

    return t * Math.max(0, this.config.spinBlur.maxPx);
  }

  private renderWebGL(frame: RenderFrame): void {
    if (
      !this.gl ||
      !this.glProgram ||
      !this.glAttribs ||
      !this.glUniforms ||
      !this.glTexture ||
      !this.glBuffer ||
      !this.config
    ) {
      return;
    }

    if (!this.spriteImg || !this.canvas) return;

    const gl = this.gl;

    gl.useProgram(this.glProgram);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.glBuffer);

    gl.enableVertexAttribArray(this.glAttribs.pos);
    gl.vertexAttribPointer(this.glAttribs.pos, 2, gl.FLOAT, false, 16, 0);
    gl.enableVertexAttribArray(this.glAttribs.uv);
    gl.vertexAttribPointer(this.glAttribs.uv, 2, gl.FLOAT, false, 16, 8);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.glTexture);
    gl.uniform1i(this.glUniforms.texture, 0);

    gl.uniform1f(this.glUniforms.frameHeight, this.config.frameHeight);
    gl.uniform1f(this.glUniforms.spriteHeight, this.config.spriteHeight);
    gl.uniform1f(this.glUniforms.visibleSlots, this.config.visibleSlots);
    gl.uniform1f(this.glUniforms.heightScale, this.config.heightScale);
    gl.uniform1f(this.glUniforms.edgePower, Math.max(0.5, this.config.webglShading.edgePower));

    const shading = this.config.webglShading;
    const warpAngle = (Math.max(0, shading.warpAngleDeg) * Math.PI) / 180;

    gl.uniform1f(this.glUniforms.warpAngle, warpAngle);
    gl.uniform1f(this.glUniforms.time, performance.now() / 1000);

    const highlightOn =
      shading.highlightEnabled !== false &&
      (frame.highlightActive === undefined || frame.highlightActive === true);

    gl.uniform1f(this.glUniforms.highlightEnabled, highlightOn ? 1 : 0);
    gl.uniform1f(
      this.glUniforms.highlightIntensity,
      Math.max(0, Math.min(1, shading.highlightIntensity ?? 0.92)),
    );
    gl.uniform1f(this.glUniforms.highlightRadiusPx, Math.max(0, shading.highlightRadiusPx ?? 14));
    gl.uniform1f(this.glUniforms.highlightFade, Math.max(0, Math.min(1, frame.highlightFade ?? 1)));
    gl.uniform1f(this.glUniforms.spriteWidth, Math.max(1, this.config.spriteWidth));
    gl.uniform1f(this.glUniforms.repeatWrap, this.textureRepeatEnabled ? 1 : 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    const reelW = 1 / this.config.reels;

    for (let r = 0; r < this.config.reels; r += 1) {
      gl.uniform1f(this.glUniforms.reelX, r * reelW);
      gl.uniform1f(this.glUniforms.reelW, reelW);

      const offsetPx = mod(frame.offsets[r], this.config.spriteHeight);

      gl.uniform1f(this.glUniforms.offsetPx, offsetPx);
      gl.uniform1f(this.glUniforms.blurPx, this.getSpinBlurPxForReel(r, frame.velocities));
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }
}
