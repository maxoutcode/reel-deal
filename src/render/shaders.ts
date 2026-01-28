export const reelVertexShader = `
  attribute vec2 a_pos;
  attribute vec2 a_uv;
  varying vec2 v_uv;
  void main() {
    v_uv = a_uv;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

export const reelFragmentShader = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  varying vec2 v_uv;
  uniform sampler2D u_tex;
  uniform float u_reelX;
  uniform float u_reelW;
  uniform float u_offsetPx;
  uniform float u_frameHeight;
  uniform float u_spriteHeight;
  uniform float u_visibleSlots;
  uniform float u_heightScale;
  uniform float u_edgePower;
  uniform float u_warpAngle;
  uniform float u_blurPx;

  const float HALF_PI = 1.5707963;

  float saturate(float x) { return clamp(x, 0.0, 1.0); }

  void main() {
    if (v_uv.x < u_reelX || v_uv.x > (u_reelX + u_reelW)) {
      discard;
    }

    float localX = (v_uv.x - u_reelX) / u_reelW;
    float localY = v_uv.y;
    float hs = max(0.0001, u_heightScale);
    float fullY = localY * hs + (1.0 - hs) * 0.5;

    float warp = max(0.0, u_warpAngle);
    float warpStrength = saturate(warp / HALF_PI);
    float distNorm = abs(fullY - 0.5) * 2.0;
    float edgePow = max(0.5, u_edgePower);
    float edgeWeight = pow(saturate(distNorm), edgePow) * warpStrength;

    float stretchMax = 6.0;
    float stretch = mix(1.0, stretchMax, edgeWeight);
    float warpedY = 0.5 + (fullY - 0.5) * stretch;

    float arcY = 0.5 + 0.5 * sin((warpedY - 0.5) * HALF_PI);
    warpedY = mix(warpedY, arcY, 0.2);

    float yPx = u_offsetPx + warpedY * (u_frameHeight * u_visibleSlots);
    float v = fract((u_offsetPx / u_spriteHeight) +
                    warpedY * ((u_frameHeight * u_visibleSlots) / u_spriteHeight));

    vec4 base = texture2D(u_tex, vec2(localX, v));

    if (u_blurPx > 0.0) {
      float maxStepPx = 1.0 + 3.0 * saturate(u_blurPx / 4.0);
      float blurPx = min(u_blurPx, maxStepPx);
      float blurStep = blurPx / max(1.0, u_spriteHeight);
      vec4 sum = base * 0.227027;
      sum += texture2D(u_tex, vec2(localX, fract(v + blurStep))) * 0.1945946;
      sum += texture2D(u_tex, vec2(localX, fract(v - blurStep))) * 0.1945946;
      sum += texture2D(u_tex, vec2(localX, fract(v + 2.0 * blurStep))) * 0.1216216;
      sum += texture2D(u_tex, vec2(localX, fract(v - 2.0 * blurStep))) * 0.1216216;
      sum += texture2D(u_tex, vec2(localX, fract(v + 3.0 * blurStep))) * 0.054054;
      sum += texture2D(u_tex, vec2(localX, fract(v - 3.0 * blurStep))) * 0.054054;
      sum += texture2D(u_tex, vec2(localX, fract(v + 4.0 * blurStep))) * 0.016216;
      sum += texture2D(u_tex, vec2(localX, fract(v - 4.0 * blurStep))) * 0.016216;
      base = sum;
    }

    gl_FragColor = base;
  }
`;

export const lineVertexShader = `
  attribute vec2 a_pos;
  varying vec2 v_pos;
  void main() {
    v_pos = a_pos;
    gl_Position = vec4(a_pos, 0.0, 1.0);
  }
`;

export const lineFragmentShader = `
  #ifdef GL_FRAGMENT_PRECISION_HIGH
  precision highp float;
  #else
  precision mediump float;
  #endif

  varying vec2 v_pos;
  uniform float u_time;
  uniform vec2 u_resolution;
  uniform float u_thickness;
  uniform float u_intensity;

  void main() {
    vec2 uv = v_pos;
    float centerY = 0.0;
    float distY = abs(uv.y - centerY);
    float thicknessPx = u_thickness / u_resolution.y * 2.0;

    float lineMask = 1.0 - smoothstep(0.0, thicknessPx * 2.0, distY);

    if (lineMask <= 0.001) {
      discard;
    }

    vec3 color;
    float alpha = lineMask * u_intensity;

    float warm = 1.0 - exp(-u_time * 2.6);
    float flicker = (sin(u_time * 37.0) * sin(u_time * 13.0)) * 0.28;
    flicker *= exp(-u_time * 2.2);
    warm = clamp(warm + flicker, 0.0, 1.0);
    float warmColor = mix(0.65, 1.0, warm);
    alpha *= warm;

    float pulse = sin(u_time * 4.0) * 0.3 + 0.7;
    float x = (uv.x + 1.0) * 0.5;
    float wave = sin(x * 30.0 - u_time * 8.0) * 0.2;

    color = vec3(1.0, 0.8, 0.2) * (pulse + wave);

    float core = exp(-distY * 120.0 / thicknessPx);
    color = mix(color, vec3(1.0), core * 0.6);

    color *= warmColor;
    gl_FragColor = vec4(color, alpha);
  }
`;
