import * as THREE from 'three';
import { TANK } from '../core/config';
import type { SharedShaderUniforms } from './Shaders';

/**
 * Photorealistic GPU underwater distance-blur (depth-of-field) & optical scatter pass.
 * Renders the main scene to an offscreen HDR WebGLRenderTarget with a DepthTexture, then
 * applies a 16-tap depth-aware Vogel-disk underwater blur with foreground-bleed protection
 * and analytical overhead water-surface depth so overhead waves stay crisp while the distant
 * reef, seabed, and far water horizon dissolve smoothly into open-ocean haze.
 */
export class UnderwaterPostFX {
  readonly enabled: boolean;

  private readonly renderer: THREE.WebGLRenderer;
  private readonly target: THREE.WebGLRenderTarget | null;
  private readonly postScene: THREE.Scene;
  private readonly postCamera: THREE.OrthographicCamera;
  private readonly postMat: THREE.ShaderMaterial;
  private readonly postMesh: THREE.Mesh;

  private readonly _fwd = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _resolution = new THREE.Vector2(1, 1);

  constructor(
    renderer: THREE.WebGLRenderer,
    sharedUniforms: SharedShaderUniforms,
    width: number,
    height: number
  ) {
    this.renderer = renderer;
    const isWebGL2 = renderer.capabilities.isWebGL2;
    const canHalfFloat =
      isWebGL2 &&
      (renderer.extensions.has('EXT_color_buffer_float') ||
        renderer.extensions.has('EXT_color_buffer_half_float'));
    this.enabled = isWebGL2;

    const pixelRatio = renderer.getPixelRatio();
    const rtW = Math.max(2, Math.floor(width * pixelRatio));
    const rtH = Math.max(2, Math.floor(height * pixelRatio));
    this._resolution.set(rtW, rtH);

    if (this.enabled) {
      const depthTex = new THREE.DepthTexture(rtW, rtH);
      depthTex.type = THREE.UnsignedIntType;
      depthTex.minFilter = THREE.NearestFilter;
      depthTex.magFilter = THREE.NearestFilter;

      this.target = new THREE.WebGLRenderTarget(rtW, rtH, {
        type: canHalfFloat ? THREE.HalfFloatType : THREE.UnsignedByteType,
        minFilter: THREE.LinearFilter,
        magFilter: THREE.LinearFilter,
        depthBuffer: true,
        stencilBuffer: false,
        depthTexture: depthTex,
      });
    } else {
      this.target = null;
    }

    this.postScene = new THREE.Scene();
    this.postCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);

    this.postMat = new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: this.target ? this.target.texture : null },
        tDepth: { value: this.target ? this.target.depthTexture : null },
        uResolution: { value: this._resolution },
        uNear: { value: 0.12 },
        uFar: { value: 160.0 },
        uFocusDist: { value: 11.5 },
        uMaxBlurPx: { value: 6.2 * pixelRatio },
        uWaterY: { value: TANK.waterY },
        uCamPos: { value: new THREE.Vector3() },
        uCamForward: { value: new THREE.Vector3(0, 0, -1) },
        uCamRight: { value: new THREE.Vector3(1, 0, 0) },
        uCamUp: { value: new THREE.Vector3(0, 1, 0) },
        uTanHalfFov: { value: Math.tan(THREE.MathUtils.degToRad(28)) },
        uAspect: { value: width / Math.max(1, height) },
        uFogColor: sharedUniforms.uFogColor,
        uDaylight: sharedUniforms.uDaylight,
      },
      depthTest: false,
      depthWrite: false,
      vertexShader: /* glsl */ `
        varying vec2 vUv;
        void main() {
          vUv = uv;
          gl_Position = vec4(position.xy, 0.0, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform sampler2D tDiffuse;
        uniform sampler2D tDepth;
        uniform vec2 uResolution;
        uniform float uNear;
        uniform float uFar;
        uniform float uFocusDist;
        uniform float uMaxBlurPx;
        uniform float uWaterY;
        uniform vec3 uCamPos;
        uniform vec3 uCamForward;
        uniform vec3 uCamRight;
        uniform vec3 uCamUp;
        uniform float uTanHalfFov;
        uniform float uAspect;
        uniform vec3 uFogColor;
        uniform float uDaylight;

        varying vec2 vUv;

        float linearizeDepth(float rawDepth) {
          float zNdc = rawDepth * 2.0 - 1.0;
          return (2.0 * uNear * uFar) / max(0.0001, (uFar + uNear - zNdc * (uFar - uNear)));
        }

        float getEffectiveDepth(vec2 uv) {
          float raw = texture2D(tDepth, uv).r;
          float d = linearizeDepth(raw);
          // For pixels showing the transparent overhead water surface or open water backdrop,
          // analytically intersect the water plane so overhead waves stay crisp while the
          // distant water horizon blurs smoothly into underwater mist.
          if (raw > 0.9997 && uCamPos.y < uWaterY - 0.05) {
            vec2 ndc = uv * 2.0 - 1.0;
            vec3 rayDir = normalize(
              uCamForward +
              uCamRight * (ndc.x * uTanHalfFov * uAspect) +
              uCamUp * (ndc.y * uTanHalfFov)
            );
            if (rayDir.y > 0.002) {
              float tWater = (uWaterY - uCamPos.y) / rayDir.y;
              float waterZ = tWater * max(dot(rayDir, uCamForward), 0.15);
              d = min(d, waterZ);
            }
          }
          return d;
        }

        float computeCoC(float depth) {
          // Distance-only optical underwater blur: everything closer than farStart stays
          // completely crisp, smoothly blurring only across the distant reef & horizon.
          float farStart = max(uFocusDist + 5.0, 12.5);
          float farEnd = farStart + 24.0;
          return clamp(smoothstep(farStart, farEnd, depth), 0.0, 1.0);
        }

        void main() {
          vec4 centerSample = texture2D(tDiffuse, vUv);
          float centerDepth = getEffectiveDepth(vUv);
          float centerCoC = computeCoC(centerDepth);

          vec3 col = centerSample.rgb;

          if (centerCoC > 0.015) {
            vec2 texel = 1.0 / uResolution;
            float radiusPx = centerCoC * uMaxBlurPx;
            // Subtle deterministic per-pixel rotation to eliminate concentric ring banding
            float hash = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
            float baseAngle = hash * 6.2831853;

            vec3 acc = centerSample.rgb * 1.15;
            float wSum = 1.15;

            const int TAPS = 16;
            const float GOLDEN_ANGLE = 2.39996323;
            for (int i = 0; i < TAPS; i++) {
              float fi = float(i);
              float r = sqrt((fi + 0.5) / float(TAPS)) * radiusPx;
              float ang = fi * GOLDEN_ANGLE + baseAngle;
              vec2 offset = vec2(cos(ang), sin(ang)) * r * texel;
              vec2 tapUv = clamp(vUv + offset, vec2(0.001), vec2(0.999));

              float tapDepth = getEffectiveDepth(tapUv);
              float tapCoC = computeCoC(tapDepth);

              // Foreground-bleed protection: never let sharp close-up silhouettes smear
              // into the blurred distant reef, while allowing blurred background to blend cleanly.
              float bleedWeight = tapDepth >= centerDepth - 0.45
                ? 1.0
                : smoothstep(0.12, 0.45, tapCoC);

              vec3 tapCol = texture2D(tDiffuse, tapUv).rgb;
              float w = bleedWeight * (0.65 + 0.35 * tapCoC);
              acc += tapCol * w;
              wSum += w;
            }

            col = acc / max(wSum, 0.0001);
          }

          // Subtle long-range underwater turbidity / optical scatter veil toward the infinite horizon
          float hazeT = smoothstep(19.0, 56.0, centerDepth);
          vec3 scatterCol = mix(uFogColor, uFogColor * vec3(0.92, 1.08, 1.14), 0.35 + 0.35 * uDaylight);
          col = mix(col, scatterCol, hazeT * 0.42);

          // Delicate ultra-wide dive dome-port vignette
          vec2 vigUv = vUv * 2.0 - 1.0;
          float vig = 1.0 - dot(vigUv * vec2(0.42, 0.52), vigUv * vec2(0.42, 0.52)) * 0.24;
          col *= clamp(vig, 0.78, 1.0);

          gl_FragColor = vec4(col, 1.0);
          #include <tonemapping_fragment>
          #include <colorspace_fragment>
        }
      `,
    });

    const quadGeo = new THREE.PlaneGeometry(2, 2);
    this.postMesh = new THREE.Mesh(quadGeo, this.postMat);
    this.postMesh.frustumCulled = false;
    this.postScene.add(this.postMesh);
  }

  resize(width: number, height: number): void {
    const pixelRatio = this.renderer.getPixelRatio();
    const rtW = Math.max(2, Math.floor(width * pixelRatio));
    const rtH = Math.max(2, Math.floor(height * pixelRatio));
    this._resolution.set(rtW, rtH);
    this.postMat.uniforms.uAspect.value = width / Math.max(1, height);
    this.postMat.uniforms.uMaxBlurPx.value = 6.2 * pixelRatio;
    if (this.target) {
      this.target.setSize(rtW, rtH);
    }
  }

  render(scene: THREE.Scene, camera: THREE.PerspectiveCamera, focusDistance: number): void {
    if (!this.enabled || !this.target) {
      this.renderer.render(scene, camera);
      return;
    }

    // 1. Render 3D scene into offscreen HDR + DepthTexture target
    this.renderer.setRenderTarget(this.target);
    this.renderer.clear();
    this.renderer.render(scene, camera);

    // 2. Sync camera optics uniforms for analytical water-surface depth & DoF blur
    camera.updateMatrixWorld();
    camera.getWorldDirection(this._fwd);
    this._right.setFromMatrixColumn(camera.matrixWorld, 0).normalize();
    this._up.setFromMatrixColumn(camera.matrixWorld, 1).normalize();

    const u = this.postMat.uniforms;
    u.uNear.value = camera.near;
    u.uFar.value = camera.far;
    u.uFocusDist.value = Math.max(3.5, focusDistance);
    u.uCamPos.value.copy(camera.position);
    u.uCamForward.value.copy(this._fwd);
    u.uCamRight.value.copy(this._right);
    u.uCamUp.value.copy(this._up);
    u.uTanHalfFov.value = Math.tan(THREE.MathUtils.degToRad(camera.fov * 0.5));
    u.uAspect.value = camera.aspect;

    // 3. Composite depth-blurred underwater image onto screen with ACES tone mapping & sRGB
    this.renderer.setRenderTarget(null);
    this.renderer.render(this.postScene, this.postCamera);
  }

  dispose(): void {
    if (this.target) {
      this.target.depthTexture?.dispose();
      this.target.dispose();
    }
    this.postMesh.geometry.dispose();
    this.postMat.dispose();
  }
}
