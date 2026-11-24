import * as THREE from 'three';
import { TANK } from '../core/config';
import { getSeabedHeight } from '../core/math';

export interface SharedShaderUniforms {
  uTime: { value: number };
  uFogColor: { value: THREE.Color };
  uFogDensity: { value: number };
  uSunDir: { value: THREE.Vector3 };
  uDaylight: { value: number };
  uVentPos: { value: THREE.Vector3 };
  uVentPulse: { value: number };
}

export function createSharedUniforms(): SharedShaderUniforms {
  return {
    uTime: { value: 0.0 },
    uFogColor: { value: new THREE.Color(0x041e30) },
    uFogDensity: { value: 0.032 },
    uSunDir: { value: new THREE.Vector3(0.28, 0.91, 0.28).normalize() },
    uDaylight: { value: 0.9 },
    uVentPos: {
      value: new THREE.Vector3(
        TANK.ventPos.x,
        getSeabedHeight(TANK.ventPos.x, TANK.ventPos.z),
        TANK.ventPos.z
      ),
    },
    uVentPulse: { value: 0.0 },
  };
}

export interface UnderwaterPBROptions {
  /** Intensity of animated chromatic solar caustics projected onto the surface (default 0.42). */
  causticStrength?: number;
  /** Intensity of organic subsurface backlighting & translucent rim scatter (default 0.24). */
  subsurfaceStrength?: number;
  /** Optional custom tint for subsurface rim scatter (defaults to luminous aqua-cyan). */
  subsurfaceColor?: number;
  /** Intensity of warm hydrothermal vent bounce light near the vent (default 0.32). */
  ventBounceStrength?: number;
  /** Enables multi-scale sand ripple coloration, quartz sparkle, and vent radial ground glow. */
  isSeabed?: boolean;
}

/**
 * Enhances any Three.js MeshStandardMaterial or MeshPhysicalMaterial via `onBeforeCompile`
 * with photorealistic underwater optics:
 * - World-space animated chromatic solar caustics dancing across backs, fins, flora, rocks & sand
 * - Depth-attenuated red-spectrum water absorption & subsurface forward-scatter rim glow
 * - Warm hydrothermal vent proximity bounce light
 * - Full support for real-time Three.js PCFSoftShadowMap shadows, normal maps, IBL & InstancedMesh
 */
export function enhanceMaterialWithUnderwaterCaustics(
  material: THREE.MeshStandardMaterial,
  shared: SharedShaderUniforms,
  options: UnderwaterPBROptions = {}
): void {
  const causticStrength = options.causticStrength ?? 0.42;
  const subsurfaceStrength = options.subsurfaceStrength ?? 0.24;
  const subsurfaceColor = new THREE.Color(options.subsurfaceColor ?? 0x4ee8ff);
  const ventBounceStrength = options.ventBounceStrength ?? 0.32;
  const isSeabed = options.isSeabed ?? false;
  const waterSurfaceY = TANK.waterY;

  const cacheTag = isSeabed ? 'uw_seabed_v1' : 'uw_pbr_v1';
  material.customProgramCacheKey = () => cacheTag;

  material.onBeforeCompile = (shader) => {
    shader.uniforms.uUwTime = shared.uTime;
    shader.uniforms.uUwDaylight = shared.uDaylight;
    shader.uniforms.uUwSunDir = shared.uSunDir;
    shader.uniforms.uUwVentPos = shared.uVentPos;
    shader.uniforms.uUwVentPulse = shared.uVentPulse;
    shader.uniforms.uUwCausticStrength = { value: causticStrength };
    shader.uniforms.uUwSubsurface = { value: subsurfaceStrength };
    shader.uniforms.uUwSubsurfaceColor = { value: subsurfaceColor };
    shader.uniforms.uUwVentBounce = { value: ventBounceStrength };
    shader.uniforms.uUwWaterY = { value: waterSurfaceY };
    shader.uniforms.uUwIsSeabed = { value: isSeabed ? 1.0 : 0.0 };

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        varying vec3 vUwWorldPos;
        varying vec3 vUwWorldNormal;
        `
      )
      .replace(
        '#include <worldpos_vertex>',
        /* glsl */ `
        #include <worldpos_vertex>
        vec4 uwWp = vec4( transformed, 1.0 );
        #ifdef USE_INSTANCING
          uwWp = instanceMatrix * uwWp;
        #endif
        uwWp = modelMatrix * uwWp;
        vUwWorldPos = uwWp.xyz;
        vec3 uwObjN = objectNormal;
        #ifdef USE_INSTANCING
          uwObjN = mat3( instanceMatrix ) * uwObjN;
        #endif
        vUwWorldNormal = normalize( mat3( modelMatrix ) * uwObjN );
        `
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        /* glsl */ `
        #include <common>
        uniform float uUwTime;
        uniform float uUwDaylight;
        uniform vec3 uUwSunDir;
        uniform vec3 uUwVentPos;
        uniform float uUwVentPulse;
        uniform float uUwCausticStrength;
        uniform float uUwSubsurface;
        uniform vec3 uUwSubsurfaceColor;
        uniform float uUwVentBounce;
        uniform float uUwWaterY;
        uniform float uUwIsSeabed;
        varying vec3 vUwWorldPos;
        varying vec3 vUwWorldNormal;

        float uwCausticField(vec2 p, float t) {
          vec2 a = p * 0.72 + vec2(t * 0.26, -t * 0.21);
          vec2 b = p * 1.08 + vec2(-t * 0.19, t * 0.30);
          float w1 = sin(a.x * 2.15 + cos(a.y * 2.45 + t * 0.68));
          float w2 = cos(b.x * 2.55 - sin(b.y * 2.25 - t * 0.56));
          float w3 = sin((a.x + b.y) * 1.88 + t * 0.44);
          float ridge = 1.0 - abs(w1 + w2 * 0.82 + w3 * 0.48) * 0.45;
          return pow(clamp(ridge, 0.0, 1.0), 4.2);
        }
        `
      )
      .replace(
        '#include <opaque_fragment>',
        /* glsl */ `
        vec3 uwN = normalize( vUwWorldNormal );
        if ( !gl_FrontFacing ) uwN = -uwN;
        vec3 uwSun = normalize( uUwSunDir );
        vec3 uwView = normalize( cameraPosition - vUwWorldPos );

        // Refracted chromatic solar caustics projected downward through moving waves
        float uwDepth = max( uUwWaterY - vUwWorldPos.y, 0.2 );
        float uwDepthFade = exp( -uwDepth * 0.038 );
        vec2 uwUv = vUwWorldPos.xz - vUwWorldPos.y * 0.23;
        float uwCR = uwCausticField( uwUv + vec2( 0.055, 0.02 ), uUwTime );
        float uwCG = uwCausticField( uwUv, uUwTime );
        float uwCB = uwCausticField( uwUv - vec2( 0.05, 0.03 ), uUwTime );
        vec3 uwCausticRGB = vec3( uwCR * 0.76, uwCG * 1.0, uwCB * 1.18 );

        float uwUpFacing = smoothstep( -0.14, 0.72, uwN.y );
        float uwSunAlign = 0.35 + 0.65 * max( dot( uwN, uwSun ), 0.0 );
        float uwDayScale = 0.10 + 0.90 * uUwDaylight;
        outgoingLight += uwCausticRGB * uUwCausticStrength * uwDayScale * uwUpFacing * uwSunAlign * uwDepthFade * ( 0.42 + 0.58 * diffuseColor.rgb );

        // Subsurface backlighting & watery grazing Fresnel rim scatter
        float uwRim = pow( 1.0 - clamp( abs( dot( uwN, uwView ) ), 0.0, 1.0 ), 2.6 );
        float uwBackLit = pow( clamp( dot( uwView, -uwSun ), 0.0, 1.0 ), 2.2 ) * 0.55 + 0.45;
        vec3 uwSssTint = mix( diffuseColor.rgb, uUwSubsurfaceColor, 0.42 );
        outgoingLight += uwSssTint * uUwSubsurface * uwRim * uwBackLit * ( 0.24 + 0.76 * uUwDaylight ) * 0.55;

        // Hydrothermal vent radial warm-amber & mineral-cyan bounce illumination
        vec3 uwVentDelta = vUwWorldPos - uUwVentPos;
        float uwVentDistSq = dot( uwVentDelta, uwVentDelta );
        float uwVentFalloff = exp( -uwVentDistSq * ( uUwIsSeabed > 0.5 ? 0.11 : 0.085 ) );
        vec3 uwVentTint = mix( vec3( 0.10, 0.90, 1.0 ), vec3( 1.0, 0.54, 0.16 ), exp( -sqrt( uwVentDistSq ) * 0.52 ) );
        float uwVentEnergy = uUwVentPulse * 1.45 * ( 1.25 - 0.30 * uUwDaylight );
        outgoingLight += uwVentTint * uwVentFalloff * uwVentEnergy * uUwVentBounce * ( 0.45 + 0.55 * diffuseColor.rgb );

        // Fine wet carbonate sand quartz micro-glint when rendered on the seabed
        if ( uUwIsSeabed > 0.5 ) {
          float sparkleSeed = sin( vUwWorldPos.x * 47.3 + vUwWorldPos.z * 53.7 ) * cos( vUwWorldPos.z * 61.1 - vUwWorldPos.x * 41.9 );
          float sparkle = pow( clamp( sparkleSeed, 0.0, 1.0 ), 18.0 ) * uwUpFacing * uwDayScale;
          outgoingLight += vec3( 0.72, 0.96, 1.0 ) * sparkle * 0.65;
        }

        #include <opaque_fragment>
        `
      );
  };
}

export function createCausticTerrainMaterial(
  shared: SharedShaderUniforms,
  colorA: number,
  colorB: number,
  causticStrength: number
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uSunDir: shared.uSunDir,
      uDaylight: shared.uDaylight,
      uVentPos: shared.uVentPos,
      uVentPulse: shared.uVentPulse,
      uColorA: { value: new THREE.Color(colorA) },
      uColorB: { value: new THREE.Color(colorB) },
      uCausticStrength: { value: causticStrength },
    },
    vertexShader: /* glsl */ `
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vViewDepth;

      void main() {
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mvPos = viewMatrix * wp;
        vViewDepth = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uSunDir;
      uniform float uDaylight;
      uniform vec3 uVentPos;
      uniform float uVentPulse;
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uCausticStrength;

      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying float vViewDepth;

      float causticNet(vec2 p, float t) {
        vec2 a = p * 0.72 + vec2(t * 0.26, -t * 0.21);
        vec2 b = p * 1.05 + vec2(-t * 0.19, t * 0.31);
        float w1 = sin(a.x * 2.1 + cos(a.y * 2.4 + t * 0.65));
        float w2 = cos(b.x * 2.5 - sin(b.y * 2.2 - t * 0.55));
        float w3 = sin((a.x + b.y) * 1.85 + t * 0.42);
        float ridge = 1.0 - abs(w1 + w2 * 0.8 + w3 * 0.5) * 0.46;
        return pow(clamp(ridge, 0.0, 1.0), 4.0);
      }

      void main() {
        vec3 N = normalize(vWorldNormal);
        float diff = max(dot(N, normalize(uSunDir)), 0.0);

        // Multi-scale organic seabed sand ripple grain
        float ripple = 0.5 + 0.5 * sin(vWorldPos.x * 3.4 + sin(vWorldPos.z * 2.1) * 1.6);
        float fineGrain = 0.5 + 0.5 * sin(vWorldPos.x * 11.0 + vWorldPos.z * 9.5);
        float microPebble = 0.5 + 0.5 * sin(vWorldPos.x * 29.0 - vWorldPos.z * 24.0);
        vec3 baseCol = mix(uColorB, uColorA, clamp(N.y * 0.62 + ripple * 0.24 + fineGrain * 0.09 + microPebble * 0.05, 0.0, 1.0));

        vec2 cUv = vWorldPos.xz - vWorldPos.y * 0.22;
        float cR = causticNet(cUv + vec2(0.06, 0.02), uTime);
        float cG = causticNet(cUv, uTime);
        float cB = causticNet(cUv - vec2(0.05, 0.03), uTime);
        vec3 causticRGB = vec3(cR * 0.74, cG * 0.98, cB * 1.15);

        float upFacing = smoothstep(0.05, 0.75, N.y);
        float solarScale = 0.14 + 0.86 * uDaylight;
        vec3 lit = baseCol * (0.16 + 0.84 * solarScale * (0.28 + 0.72 * diff))
          + causticRGB * uCausticStrength * (0.12 + 0.88 * uDaylight) * upFacing * (0.45 + 0.55 * diff);

        // Hydrothermal vent radial bioluminescent & mineral glow (stands out dramatically at night)
        float vDist = length(vWorldPos.xz - uVentPos.xz);
        float ventGlow = exp(-vDist * vDist * 0.13) * (uVentPulse * 1.45) * (1.28 - 0.32 * uDaylight);
        vec3 ventTint = mix(vec3(0.08, 0.88, 1.0), vec3(1.0, 0.56, 0.18), clamp(exp(-vDist * 0.58), 0.0, 1.0));
        lit += ventTint * ventGlow * 0.82;

        float fogAmt = 1.0 - exp(-pow(max(vViewDepth, 0.0) * uFogDensity, 2.0));
        gl_FragColor = vec4(mix(lit, uFogColor, clamp(fogAmt, 0.0, 1.0)), 1.0);
      }
    `,
  });
}

export function createWaterSurfaceMaterial(shared: SharedShaderUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uSunDir: shared.uSunDir,
      uDaylight: shared.uDaylight,
    },
    transparent: true,
    side: THREE.DoubleSide,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      varying vec3 vWorldPos;
      varying float vWaveH;
      varying float vViewDepth;

      void main() {
        vec3 p = position;
        float w =
          sin(p.x * 0.55 + uTime * 1.5) * 0.095 +
          cos(p.z * 0.65 - uTime * 1.2) * 0.085 +
          sin((p.x + p.z) * 0.42 + uTime * 1.0) * 0.065 +
          cos((p.x - p.z) * 0.88 + uTime * 1.85) * 0.034 +
          sin(p.x * 1.45 - p.z * 1.25 + uTime * 2.4) * 0.016;
        p.y += w;
        vWaveH = w;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vec4 mvPos = viewMatrix * wp;
        vViewDepth = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uSunDir;
      uniform float uDaylight;

      varying vec3 vWorldPos;
      varying float vWaveH;
      varying float vViewDepth;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        vec3 waveN = normalize(vec3(
          cos(vWorldPos.x * 0.55 + uTime * 1.5) * 0.22 +
            cos((vWorldPos.x + vWorldPos.z) * 0.42 + uTime * 1.0) * 0.12 +
            cos(vWorldPos.x * 2.4 - vWorldPos.z * 1.9 + uTime * 2.8) * 0.075,
          1.0,
          sin(vWorldPos.z * 0.65 - uTime * 1.2) * 0.22 -
            sin((vWorldPos.x - vWorldPos.z) * 0.88 + uTime * 1.85) * 0.11 +
            sin(vWorldPos.z * 2.7 + vWorldPos.x * 1.6 - uTime * 2.4) * 0.07
        ));
        bool fromBelow = !gl_FrontFacing;
        if (fromBelow) waveN = -waveN;

        float ndv = max(dot(waveN, viewDir), 0.0);
        float fresnel = pow(1.0 - ndv, 3.2);
        vec3 sunDir = normalize(uSunDir);
        vec3 reflDir = reflect(-sunDir, waveN);
        float specTight = pow(max(dot(viewDir, reflDir), 0.0), 96.0);
        float specBroad = pow(max(dot(viewDir, reflDir), 0.0), 20.0);
        float shimmer = 0.5 + 0.5 * sin(vWorldPos.x * 1.85 + uTime * 2.3) * cos(vWorldPos.z * 1.95 - uTime * 1.75);

        vec3 dayShallow = vec3(0.42, 0.92, 1.0);
        vec3 nightShallow = vec3(0.07, 0.28, 0.46);
        vec3 surfaceTint = mix(nightShallow, dayShallow, uDaylight);
        vec3 deepWater = mix(vec3(0.015, 0.09, 0.18), vec3(0.03, 0.22, 0.36), uDaylight);

        vec3 col = mix(deepWater, surfaceTint, clamp(fresnel * 0.82 + shimmer * 0.22, 0.0, 1.0));
        if (fromBelow) {
          // Authentic Snell's Window total internal reflection outside ~48.6 deg critical cone
          float snellCone = smoothstep(0.56, 0.78, ndv);
          vec3 skyWindow = mix(vec3(0.14, 0.40, 0.62), vec3(0.76, 0.97, 1.0), uDaylight);
          col = mix(col * 0.95, skyWindow * (0.85 + 0.35 * shimmer), snellCone * 0.86);
        }
        vec3 glintCol = mix(vec3(0.32, 0.62, 0.86), vec3(1.0, 0.98, 0.90), uDaylight);
        col += glintCol * (specTight * 1.65 + specBroad * 0.48 + max(vWaveH, 0.0) * 0.42);

        float fogAmt = 1.0 - exp(-pow(max(vViewDepth, 0.0) * uFogDensity * 0.88, 2.0));
        col = mix(col, uFogColor, clamp(fogAmt, 0.0, 1.0));
        float alpha = fromBelow
          ? clamp(0.42 + fresnel * 0.44 + specTight * 0.32, 0.32, 0.90)
          : clamp(0.24 + fresnel * 0.52 + specTight * 0.36, 0.20, 0.84);
        // Seamless horizon fade far out in the distance haze so the ocean surface has no edge
        float edgeDist = length(vWorldPos.xz);
        float horizonFade = 1.0 - smoothstep(56.0, 92.0, edgeDist);
        alpha *= horizonFade;
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

export function createGodRayMaterial(shared: SharedShaderUniforms, phase: number): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uDaylight: shared.uDaylight,
      uPhase: { value: phase },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vUv = uv;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDaylight;
      uniform float uPhase;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float edge = pow(clamp(abs(dot(normalize(vWorldNormal), viewDir)), 0.0, 1.0), 1.65);
        float vFade = smoothstep(0.0, 0.28, vUv.y) * smoothstep(1.0, 0.12, vUv.y);
        float bands = 0.62 + 0.38 * sin(vUv.x * 18.8495 + uTime * 0.75 + uPhase);
        vec3 col = mix(vec3(0.16, 0.72, 0.94), vec3(0.58, 0.96, 1.0), vUv.y);
        float alpha = edge * vFade * bands * 0.095 * (0.08 + 0.92 * uDaylight);
        gl_FragColor = vec4(col, alpha);
      }
    `,
  });
}

/**
 * High-detail hydrothermal basalt chimney shader with layered mineral sulfide crusts,
 * animated glowing thermal fissures, recessed glowing throat cavity, overhead solar caustics,
 * and abyssal fog. Uses per-vertex `aVentMeta` = (heightNorm, innerThroatMask, rimLedgeMask).
 */
export function createVentBasaltMaterial(shared: SharedShaderUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uFogColor: shared.uFogColor,
      uFogDensity: shared.uFogDensity,
      uSunDir: shared.uSunDir,
      uDaylight: shared.uDaylight,
      uVentPulse: shared.uVentPulse,
    },
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      attribute vec3 aVentMeta;
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vVentMeta;
      varying float vViewDepth;

      void main() {
        vLocalPos = position;
        vVentMeta = aVentMeta;
        vec4 wp = modelMatrix * vec4(position, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        vec4 mvPos = viewMatrix * wp;
        vViewDepth = -mvPos.z;
        gl_Position = projectionMatrix * mvPos;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform vec3 uFogColor;
      uniform float uFogDensity;
      uniform vec3 uSunDir;
      uniform float uDaylight;
      uniform float uVentPulse;

      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;
      varying vec3 vVentMeta;
      varying float vViewDepth;

      float rockNoise(vec3 p) {
        float a = sin(p.x * 3.7 + cos(p.y * 4.3 + p.z * 2.9));
        float b = cos(p.z * 5.1 - sin(p.x * 4.1 - p.y * 3.5));
        float c = sin((p.x + p.y - p.z) * 6.4);
        return (a + b + c * 0.6) * 0.38;
      }

      float ventCaustic(vec2 p, float t) {
        vec2 a = p * 0.78 + vec2(t * 0.24, -t * 0.19);
        vec2 b = p * 1.12 + vec2(-t * 0.18, t * 0.28);
        float w1 = sin(a.x * 2.1 + cos(a.y * 2.4 + t * 0.65));
        float w2 = cos(b.x * 2.5 - sin(b.y * 2.2 - t * 0.55));
        float ridge = 1.0 - abs(w1 + w2 * 0.85) * 0.52;
        return pow(clamp(ridge, 0.0, 1.0), 3.6);
      }

      void main() {
        vec3 N = normalize(vWorldNormal);
        if (!gl_FrontFacing) N = -N;
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        // Fine procedural micro-relief normal perturbation for crisp volcanic basalt rock detail
        float hMicro = rockNoise(vWorldPos * 8.5) * 0.65 + rockNoise(vWorldPos * 19.0) * 0.35;
        vec3 dPdx = dFdx(vWorldPos);
        vec3 dPdy = dFdy(vWorldPos);
        vec3 r1 = cross(dPdy, N);
        vec3 r2 = cross(N, dPdx);
        float det = dot(dPdx, r1);
        vec3 surfGrad = (r1 * dFdx(hMicro) + r2 * dFdy(hMicro)) / (abs(det) + 1e-4);
        N = normalize(N - clamp(surfGrad, vec3(-1.4), vec3(1.4)) * 0.16);
        vec3 sunDir = normalize(uSunDir);

        float heightNorm = clamp(vVentMeta.x, 0.0, 1.0);
        float innerThroat = clamp(vVentMeta.y, 0.0, 1.0);
        float rimLedge = clamp(vVentMeta.z, 0.0, 1.0);

        float n1 = rockNoise(vWorldPos * 1.45);
        float n2 = rockNoise(vWorldPos * 3.8 + vec3(2.1, -1.3, 0.7));
        float strata = 0.5 + 0.5 * sin(vWorldPos.y * 7.8 + n1 * 2.8);

        // Dark abyssal basalt layered with sulfur ochre shelves & copper-teal calcite precipitates
        vec3 obsidian = vec3(0.052, 0.084, 0.114);
        vec3 slate = vec3(0.145, 0.225, 0.278);
        vec3 mineralOchre = vec3(0.32, 0.26, 0.14);
        vec3 calciteRim = vec3(0.26, 0.48, 0.54);

        vec3 rockCol = mix(obsidian, slate, clamp(strata * 0.66 + n2 * 0.34, 0.0, 1.0));
        float ledgeMask = smoothstep(0.32, 0.84, N.y);
        rockCol = mix(rockCol, mineralOchre, clamp(ledgeMask * 0.75 + rimLedge * 0.45, 0.0, 1.0) * smoothstep(0.18, 0.78, n1 + 0.45) * 0.56);
        rockCol = mix(rockCol, calciteRim, smoothstep(0.62, 0.98, heightNorm) * (0.28 + 0.52 * max(ledgeMask, rimLedge)));

        // Wet volcanic specular sheen, overhead solar diffuse, and subtle caustic shimmer
        float diff = max(dot(N, sunDir), 0.0);
        vec3 halfV = normalize(sunDir + viewDir);
        float spec = pow(max(dot(N, halfV), 0.0), 24.0) * (0.30 + 0.42 * uDaylight);
        float rimFres = pow(1.0 - max(dot(N, viewDir), 0.0), 3.0);
        float upCaustic = ventCaustic(vWorldPos.xz - vWorldPos.y * 0.22, uTime) * smoothstep(0.12, 0.78, N.y) * (1.0 - innerThroat);

        float solarScale = 0.16 + 0.84 * uDaylight;
        vec3 lit = rockCol * (0.20 + 0.80 * solarScale * (0.30 + 0.70 * diff))
          + vec3(0.24, 0.70, 0.86) * spec * 0.48
          + vec3(0.22, 0.72, 0.88) * upCaustic * (0.10 + 0.36 * uDaylight)
          + vec3(0.06, 0.44, 0.60) * rimFres * (0.18 + 0.38 * uVentPulse);

        // Glowing volcanic micro-fissures snaking up the basalt walls
        float crackWave = abs(sin(vWorldPos.x * 5.6 + sin(vWorldPos.y * 3.6 + vWorldPos.z * 5.1) * 1.35 + n2 * 1.4));
        float crackWave2 = abs(cos(vWorldPos.z * 6.2 - sin(vWorldPos.y * 4.2 - vWorldPos.x * 4.8) * 1.25));
        float fissure = pow(clamp(1.0 - min(crackWave, crackWave2) * 4.4, 0.0, 1.0), 2.7);
        float fissurePulse = 0.66 + 0.34 * sin(uTime * 2.8 - vWorldPos.y * 3.4 + n1 * 4.0);
        float heightHeat = smoothstep(0.12, 0.96, heightNorm);

        vec3 magmaAmber = vec3(1.0, 0.46, 0.10);
        vec3 bioCyan = vec3(0.18, 0.96, 1.0);
        vec3 fissureCol = mix(magmaAmber, bioCyan, clamp(heightNorm * 0.82 + 0.14, 0.0, 1.0));
        vec3 throatCol = mix(bioCyan, magmaAmber, clamp(innerThroat * 0.85, 0.0, 1.0));

        float nightBoost = 1.35 - 0.35 * uDaylight;
        float energyBoost = uVentPulse * 1.75;
        lit += fissureCol * fissure * (0.26 + 0.82 * heightHeat) * fissurePulse * energyBoost * nightBoost;
        lit += throatCol * pow(innerThroat, 1.35) * (uVentPulse * 2.05) * nightBoost;

        float fogAmt = 1.0 - exp(-pow(max(vViewDepth, 0.0) * uFogDensity, 2.0));
        gl_FragColor = vec4(mix(lit, uFogColor, clamp(fogAmt, 0.0, 1.0)), 1.0);
      }
    `,
  });
}

/**
 * Boiling geothermal plasma-mineral throat pool inside the Genesis Vent craters.
 * Expects a unit-radius sphere geometry scaled to fit each crater throat.
 */
export function createVentCoreMaterial(shared: SharedShaderUniforms): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uVentPulse: shared.uVentPulse,
      uDaylight: shared.uDaylight,
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uVentPulse;
      varying vec2 vUv;
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vUv = uv;
        vec3 p = position;
        float boil = sin(p.x * 6.5 + uTime * 3.8) * cos(p.z * 6.5 - uTime * 3.2) * 0.06 * (0.7 + uVentPulse * 0.6);
        p.y += boil;
        vLocalPos = p;
        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uVentPulse;
      uniform float uDaylight;

      varying vec2 vUv;
      varying vec3 vLocalPos;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(abs(dot(normalize(vWorldNormal), viewDir)), 0.0, 1.0);
        float r = clamp(length(vLocalPos.xz), 0.0, 1.0);

        // Swirling convection eddies across the molten mineral throat
        float ang = atan(vLocalPos.z, vLocalPos.x);
        float swirl1 = 0.5 + 0.5 * sin(r * 9.5 - uTime * 4.2 + sin(ang * 4.0 + uTime * 1.5));
        float swirl2 = 0.5 + 0.5 * cos(vLocalPos.x * 6.0 + vLocalPos.z * 5.5 + uTime * 3.1);
        float plasma = clamp(swirl1 * 0.62 + swirl2 * 0.38, 0.0, 1.0);

        vec3 deepAmber = vec3(1.0, 0.50, 0.12);
        vec3 bioAqua = vec3(0.16, 0.94, 1.0);
        vec3 whiteHot = vec3(0.86, 1.0, 1.0);

        vec3 col = mix(deepAmber, bioAqua, smoothstep(0.16, 0.78, plasma));
        col = mix(col, whiteHot, pow(plasma, 2.6) * (0.55 + 0.45 * uVentPulse));

        float activeMask = clamp(uVentPulse, 0.0, 1.0);
        float radialFade = smoothstep(1.0, 0.12, r);
        float alpha = radialFade * (0.54 + 0.42 * ndv) * activeMask * 1.15 * (1.18 - 0.18 * uDaylight);
        gl_FragColor = vec4(col * (0.45 + 1.45 * activeMask), clamp(alpha, 0.0, 0.96));
      }
    `,
  });
}

/**
 * Soft volumetric rising hydrothermal plume shader with turbulent billowing curls,
 * smooth Fresnel edge dissolution (zero hard cone edges), and current drift sway.
 */
export function createVentPlumeMaterial(
  shared: SharedShaderUniforms,
  phaseOffset = 0.0,
  intensityScale = 1.0
): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uTime: shared.uTime,
      uDaylight: shared.uDaylight,
      uVentPulse: shared.uVentPulse,
      uCurrent: { value: 0.65 },
      uPhase: { value: phaseOffset },
      uIntensity: { value: intensityScale },
    },
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uCurrent;
      uniform float uPhase;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vUv = uv;
        vec3 p = position;
        // Height fraction 0 at vent orifice -> 1 at top of plume
        float h = clamp(uv.y, 0.0, 1.0);
        float sway = h * h;
        p.x += (sin(uTime * 1.45 - h * 4.2 + uPhase) * 0.24 + uCurrent * 0.36) * sway;
        p.z += (cos(uTime * 1.18 - h * 3.6 + uPhase * 1.3) * 0.20 + uCurrent * 0.18) * sway;
        // Gentle convective billowing pulse
        float billow = 1.0 + sin(h * 9.0 - uTime * 3.1 + uPhase) * 0.10 * h;
        p.xz *= billow;

        vec4 wp = modelMatrix * vec4(p, 1.0);
        vWorldPos = wp.xyz;
        vWorldNormal = normalize(mat3(modelMatrix) * normal);
        gl_Position = projectionMatrix * viewMatrix * wp;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uDaylight;
      uniform float uVentPulse;
      uniform float uPhase;
      uniform float uIntensity;

      varying vec2 vUv;
      varying vec3 vWorldPos;
      varying vec3 vWorldNormal;

      void main() {
        vec3 viewDir = normalize(cameraPosition - vWorldPos);
        float ndv = clamp(abs(dot(normalize(vWorldNormal), viewDir)), 0.0, 1.0);
        // Soft volumetric edge falloff so silhouette is wispy, never polygonal
        float edgeSoft = pow(ndv, 1.9);

        float h = clamp(vUv.y, 0.0, 1.0);
        float vFade = smoothstep(0.0, 0.16, h) * pow(smoothstep(1.0, 0.10, h), 1.35);

        // Scrolling multi-octave rising hydrothermal shimmer curls
        float a = vUv.x * 6.283185;
        float w1 = 0.5 + 0.5 * sin(a * 3.0 + h * 10.5 - uTime * 2.6 + uPhase);
        float w2 = 0.5 + 0.5 * cos(a * 5.0 - h * 14.0 + uTime * 3.4 - uPhase * 0.7);
        float w3 = 0.5 + 0.5 * sin((a * 2.0 + h * 7.0) - uTime * 1.8);
        float wisps = clamp(0.28 + 0.72 * (w1 * 0.5 + w2 * 0.3 + w3 * 0.2), 0.0, 1.0);

        // Warm mineral glow at the orifice cooling into luminous cyan-azure hydrothermal haze
        vec3 baseHot = vec3(0.95, 0.62, 0.24);
        vec3 midCyan = vec3(0.18, 0.92, 1.0);
        vec3 highBlue = vec3(0.08, 0.56, 0.88);
        vec3 col = mix(baseHot, midCyan, smoothstep(0.02, 0.28, h));
        col = mix(col, highBlue, smoothstep(0.32, 0.92, h));

        float pulse = clamp(uVentPulse, 0.0, 1.0) * 1.45;
        float nightBoost = 1.32 - 0.32 * uDaylight;
        float alpha = edgeSoft * vFade * wisps * 0.28 * pulse * nightBoost * uIntensity;
        gl_FragColor = vec4(col, clamp(alpha, 0.0, 0.65));
      }
    `,
  });
}
