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
  uniform float u_time;
  uniform float u_highlightEnabled;
  uniform float u_highlightIntensity;
  uniform float u_highlightRadiusPx;
  uniform float u_highlightFade;
  uniform float u_spriteWidth;
  uniform float u_repeatWrap;

  const float HALF_PI = 1.5707963;
  const float TAU = 6.2831853;
  const float HIGHLIGHT_ZONE_MIN = 0.375;
  const float HIGHLIGHT_ZONE_MAX = 0.625;
  const int ROTATE_DIRECTIONS = 24;

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
    float vRaw = (u_offsetPx / u_spriteHeight) +
                 warpedY * ((u_frameHeight * u_visibleSlots) / u_spriteHeight);
    float v = u_repeatWrap > 0.5 ? vRaw : fract(vRaw);

    vec4 base = texture2D(u_tex, vec2(localX, v));

    if (u_blurPx > 0.0) {
      float maxStepPx = 1.0 + 3.0 * saturate(u_blurPx / 4.0);
      float blurPx = min(u_blurPx, maxStepPx);
      float blurStep = blurPx / max(1.0, u_spriteHeight);
      vec4 sum = base * 0.227027;
      float v1p = u_repeatWrap > 0.5 ? (v + blurStep) : fract(v + blurStep);
      float v1n = u_repeatWrap > 0.5 ? (v - blurStep) : fract(v - blurStep);
      float v2p = u_repeatWrap > 0.5 ? (v + 2.0 * blurStep) : fract(v + 2.0 * blurStep);
      float v2n = u_repeatWrap > 0.5 ? (v - 2.0 * blurStep) : fract(v - 2.0 * blurStep);
      float v3p = u_repeatWrap > 0.5 ? (v + 3.0 * blurStep) : fract(v + 3.0 * blurStep);
      float v3n = u_repeatWrap > 0.5 ? (v - 3.0 * blurStep) : fract(v - 3.0 * blurStep);
      float v4p = u_repeatWrap > 0.5 ? (v + 4.0 * blurStep) : fract(v + 4.0 * blurStep);
      float v4n = u_repeatWrap > 0.5 ? (v - 4.0 * blurStep) : fract(v - 4.0 * blurStep);
      sum += texture2D(u_tex, vec2(localX, v1p)) * 0.1945946;
      sum += texture2D(u_tex, vec2(localX, v1n)) * 0.1945946;
      sum += texture2D(u_tex, vec2(localX, v2p)) * 0.1216216;
      sum += texture2D(u_tex, vec2(localX, v2n)) * 0.1216216;
      sum += texture2D(u_tex, vec2(localX, v3p)) * 0.054054;
      sum += texture2D(u_tex, vec2(localX, v3n)) * 0.054054;
      sum += texture2D(u_tex, vec2(localX, v4p)) * 0.016216;
      sum += texture2D(u_tex, vec2(localX, v4n)) * 0.016216;
      base = sum;
    }

    if (u_highlightEnabled > 0.5 && u_highlightIntensity > 0.0 && u_highlightRadiusPx > 0.0) {
      float zoneSoft = 0.12;
      float zoneMask = smoothstep(HIGHLIGHT_ZONE_MIN - zoneSoft, HIGHLIGHT_ZONE_MIN + 0.04, fullY) *
        (1.0 - smoothstep(HIGHLIGHT_ZONE_MAX - 0.04, HIGHLIGHT_ZONE_MAX + zoneSoft, fullY));
      if (zoneMask > 0.001) {
        float fade = smoothstep(0.0, 1.0, clamp(u_highlightFade, 0.0, 1.0));
        float outlineRadiusPx = u_highlightRadiusPx * 0.75;
        float stepV = outlineRadiusPx / max(1.0, u_spriteHeight);
        float stepX = outlineRadiusPx / max(1.0, u_spriteWidth);
        float t = u_time;

        float neighborAlphaMax = 0.0;
        float neighborAlphaSum = 0.0;
        for (int i = 0; i < ROTATE_DIRECTIONS; i++) {
          float angle = TAU * float(i) / float(ROTATE_DIRECTIONS);
          float co = cos(angle);
          float si = sin(angle);
          float sx = localX + stepX * co;
          float sv = u_repeatWrap > 0.5 ? (v + stepV * si) : fract(v + stepV * si);
          float ai = texture2D(u_tex, vec2(clamp(sx, 0.0, 1.0), sv)).a;
          neighborAlphaMax = max(neighborAlphaMax, ai);
          neighborAlphaSum += ai;
        }
        float neighborAlphaAvg = neighborAlphaSum / float(ROTATE_DIRECTIONS);
        float neighborAlpha = max(mix(neighborAlphaMax, neighborAlphaAvg, 0.35), 0.0001);

        float edgeBand = smoothstep(0.0, 0.30, 1.0 - base.a);
        float edgeSoft = edgeBand * smoothstep(0.12, 0.68, neighborAlpha);

        float thinEdge = pow(edgeSoft, 2.6);
        float outlineAlpha = thinEdge * zoneMask * u_highlightIntensity * fade;

        float hueT = t * 14.0 + localX * 8.0 + fullY * 4.5;
        vec3 prism = vec3(
          sin(hueT) * 0.5 + 0.5,
          sin(hueT + 2.094) * 0.5 + 0.5,
          sin(hueT + 4.188) * 0.5 + 0.5
        );
        vec3 warm = vec3(0.96, 0.74, 0.30);
        vec3 cool = vec3(0.42, 0.66, 0.96);
        vec3 accent = mix(warm, cool, sin(t * 1.3 + localX * 5.0 - fullY * 2.8) * 0.5 + 0.5);
        vec3 outlineColor = mix(accent, prism, 0.62);
        float lum = dot(outlineColor, vec3(0.299, 0.587, 0.114));
        outlineColor = mix(vec3(lum), outlineColor, 0.88);
        float maxLum = 0.67;
        if (lum > maxLum) outlineColor *= maxLum / lum;

        float coreLift = zoneMask * base.a * 0.11 * fade;
        base.rgb += outlineColor * outlineAlpha;
        base.rgb += base.rgb * coreLift;
        base.a = max(base.a, outlineAlpha + coreLift * 0.3);
      }
    }

    gl_FragColor = base;
  }
`;
