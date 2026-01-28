import type { ReelDealFinalSpinLine } from '../types';
import { lineFragmentShader, lineVertexShader } from './shaders';

type Gl = WebGLRenderingContext | WebGL2RenderingContext;

type Uniforms = {
  time: WebGLUniformLocation | null;
  resolution: WebGLUniformLocation | null;
  thickness: WebGLUniformLocation | null;
  intensity: WebGLUniformLocation | null;
};

type Attribs = { pos: number };

export class LineRenderer {
  private program: WebGLProgram | null = null;
  private buffer: WebGLBuffer | null = null;
  private attribs: Attribs | null = null;
  private uniforms: Uniforms | null = null;
  private startTime: number | null = null;
  private show = false;

  init(gl: Gl, _finalSpinLine: ReelDealFinalSpinLine): void {
    const program = this.createProgram(gl, lineVertexShader, lineFragmentShader);

    if (!program) return;

    const buffer = gl.createBuffer();

    if (!buffer) {
      gl.deleteProgram(program);

      return;
    }

    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);

    const quad = new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]);

    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.STATIC_DRAW);

    this.program = program;
    this.buffer = buffer;
    this.attribs = { pos: gl.getAttribLocation(program, 'a_pos') };
    this.uniforms = {
      time: gl.getUniformLocation(program, 'u_time'),
      resolution: gl.getUniformLocation(program, 'u_resolution'),
      thickness: gl.getUniformLocation(program, 'u_thickness'),
      intensity: gl.getUniformLocation(program, 'u_intensity'),
    };
    this.startTime = null;
    this.show = false;
  }

  showLine(): void {
    this.show = true;
    this.startTime = null;
  }

  hideLine(): void {
    this.show = false;
    this.startTime = null;
  }

  dispose(gl: Gl): void {
    if (this.program) gl.deleteProgram(this.program);
    if (this.buffer) gl.deleteBuffer(this.buffer);

    this.program = null;
    this.buffer = null;
    this.attribs = null;
    this.uniforms = null;
    this.startTime = null;
    this.show = false;
  }

  render(
    gl: Gl,
    canvas: HTMLCanvasElement,
    finalSpinLine: ReelDealFinalSpinLine,
    dpr: number,
  ): void {
    if (!this.show || !this.program || !this.buffer || !this.attribs || !this.uniforms) return;

    const now = performance.now();

    if (this.startTime === null) this.startTime = now;

    const elapsed = (now - this.startTime) / 1000;

    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

    gl.enableVertexAttribArray(this.attribs.pos);
    gl.vertexAttribPointer(this.attribs.pos, 2, gl.FLOAT, false, 0, 0);

    gl.uniform1f(this.uniforms.time, elapsed);
    gl.uniform2f(this.uniforms.resolution, canvas.width, canvas.height);
    gl.uniform1f(this.uniforms.thickness, finalSpinLine.thickness * dpr);
    gl.uniform1f(this.uniforms.intensity, finalSpinLine.intensity);

    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  private createProgram(gl: Gl, vsSource: string, fsSource: string): WebGLProgram | null {
    const vs = this.createShader(gl, gl.VERTEX_SHADER, vsSource);
    const fs = this.createShader(gl, gl.FRAGMENT_SHADER, fsSource);

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

  private createShader(gl: Gl, type: number, source: string): WebGLShader | null {
    const shader = gl.createShader(type);

    if (!shader) return null;

    gl.shaderSource(shader, source);
    gl.compileShader(shader);

    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      gl.deleteShader(shader);

      return null;
    }

    return shader;
  }
}
