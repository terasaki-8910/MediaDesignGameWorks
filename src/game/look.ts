// The look of the game, per docs/art-brief.md: a dusk HDRI sky, a low warm sun whose shadow map follows the camera,
// haze that thickens below the walkways, and the tone mapping. Numbers that were measured or compared are noted.
import * as THREE from 'three';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { ToneMappingMode } from 'postprocessing';

const sunAzimuth = (120 * Math.PI) / 180; // atan2(z, x) of the direction towards the sun: from the south-west
const sunElevation = (12 * Math.PI) / 180;

export const LOOK = {
  /**
   * Poly Haven syferfontein_0d_clear_puresky (CC0), 1K: a clear evening, deep blue above, no cloud bank. Its sun sits at
   * u = 0.596, 3.5 degrees up (measured from the pixels). It is a dim file: `hdriGain` brings it to the scene's scale.
   */
  hdri: './assets/sky/syferfontein_0d_clear_puresky_1k.hdr',
  hdriSunU: 0.596,
  hdriGain: 1.5,
  /** Radiance above this is cut before filtering: the DirectionalLight is the sun, the HDRI only the sky. */
  skyClamp: 3,
  /** The sky can be darkened towards the zenith by this factor (1 = as photographed). */
  zenithGain: 1,
  /** One exposure for the sky as background and as ambient light (the tone mapping pass has no exposure of its own). */
  skyIntensity: 0.55,
  ambientIntensity: 1.2,
  /**
   * The light from the upper sky (over about 9 degrees) is cut to this fraction: the paving is lit by that half of the
   * sky almost alone, the shaded uprights mostly by the bright horizon band and the bounce. Raised from 0.17 (lit to shade
   * on the paving 4.6:1 in linear luminance) to 0.5 (about 2.8:1; at least 2:1 is required): the neutral fill now has to
   * thin the sun's orange on the lit paving, and it lifts the paving more than the uprights.
   */
  skyFill: 0.5,
  /**
   * The light from the sky is this much greyer than the sky itself (1 = grey), and tinted by `fillTint`. The fill is neutral:
   * the shade of references A1 and A3 is neutral (C* about 2), and only the sun is warm, where it hits.
   */
  fillGrey: 1,
  fillTint: new THREE.Color(1, 1, 1),
  /** What the sky's lower half shows to the lighting: the bounce that fills the shaded faces, neutral like the fill (same luminance as the old warm one). */
  bounceColor: new THREE.Color(0.49, 0.49, 0.49),
  /**
   * How strongly the gilt takes the light of the sky (1 = like any other material). The gilt is the brightest thing in the
   * brief, but the brightest pixels of the first area sat on sunlit stone (L* 88-90) above the finials (L* 82): at 2.4 the
   * finials reach L* 87.
   */
  giltEnv: 2.4,
  sunColor: '#ffd2a0', // about 3700 K
  sunIntensity: 13.5,
  /** Towards the sun. The play axis runs +X, so the light crosses it from the right and a little from behind. */
  sunDir: new THREE.Vector3(Math.cos(sunAzimuth) * Math.cos(sunElevation), Math.sin(sunElevation), Math.sin(sunAzimuth) * Math.cos(sunElevation)),
  /** Half the side of the square the shadow map covers around the view's focus, in metres. */
  shadowHalf: 34,
  /** Haze: colour of the horizon away from the sun and towards it (linear, scene units), and its density. */
  hazeColor: new THREE.Color(0.49, 0.405, 0.35),
  hazeSunColor: new THREE.Color(1.15, 0.66, 0.42),
  /** Looking down into the city the haze turns to this: the low sun does not reach there (brief: the darkest values). */
  hazeDeepColor: new THREE.Color(0.31, 0.255, 0.22),
  /** Whatever the view, things sink into the haze between these depths below the walkways (the piers fade out). */
  hazeSink: [10, 120] as [number, number],
  hazeDistance: 0.0017, // exp2 density with distance: nothing within the play space, the far city fades
  /** Rays that climb (the hanging city) cross thinner air: their exp2 density is this fraction of `hazeDistance` (from about 6 degrees up). */
  hazeUpFactor: 0.36,
  hazeFloor: 0.0007, // extinction per metre at the walkway level ...
  hazeLevel: 12, // ... (y of the walkways) ...
  hazeHeight: 18, // ... growing e-fold for each this many metres below it
  /**
   * What the haze turns into on a rising ray: the sky itself, so the hanging city dissolves into the blue behind it instead of
   * standing beige in front of it. Measured from the sky map (linear, scene units) at 14 degrees up, away from the sun, to the
   * side, and in the sun's direction; the sky blends in from the horizon band to 9 degrees up exactly as `loadSky` does.
   */
  skyAnti: new THREE.Color(0.16, 0.265, 0.585),
  skySide: new THREE.Color(0.33, 0.51, 1.0),
  skySun: new THREE.Color(1.5, 1.45, 1.45),
  /** Compared with AgX and ACES against A1.jpg in the fixed shots: both washed the gold stone and the blue sky out at this exposure. */
  toneMapping: ToneMappingMode.NEUTRAL as ToneMappingMode,
  bloom: { intensity: 0.7, threshold: 2.4, smoothing: 0.5 },
};

const glsl = (v: THREE.Vector3 | THREE.Color) => {
  const a = v instanceof THREE.Color ? [v.r, v.g, v.b] : [v.x, v.y, v.z];
  return `vec3(${a.map((x) => x.toFixed(4)).join(', ')})`;
};

/** How far the haze colour leans to the sun's colour for a view direction (shared by the shader and the sky). */
const sunLean = (cos: number) => Math.pow(Math.max(cos, 0), 5) * 0.85;

/**
 * Replace three's fog chunks: FogExp2 gains an exponential height term (clear on the walkways, dense below them) and a
 * colour that warms towards the sun. Every material with `fog` gets it. Call before the first material compiles.
 */
export function installHaze() {
  const sunH = new THREE.Vector3(LOOK.sunDir.x, 0, LOOK.sunDir.z).normalize();
  THREE.ShaderChunk.fog_pars_vertex = /* glsl */ `
#ifdef USE_FOG
	varying float vFogDepth;
	varying vec3 vFogWorld;
#endif`;
  THREE.ShaderChunk.fog_vertex = /* glsl */ `
#ifdef USE_FOG
	vFogDepth = - mvPosition.z;
	vFogWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );
#endif`;
  THREE.ShaderChunk.fog_pars_fragment = /* glsl */ `
#ifdef USE_FOG
	uniform vec3 fogColor;
	varying float vFogDepth;
	varying vec3 vFogWorld;
	#ifdef FOG_EXP2
		uniform float fogDensity;
	#else
		uniform float fogNear;
		uniform float fogFar;
	#endif
#endif`;
  THREE.ShaderChunk.fog_fragment = /* glsl */ `
#ifdef USE_FOG
	#ifdef FOG_EXP2
		vec3 hazeRay = vFogWorld - cameraPosition;
		float hazeLen = max( length( hazeRay ), 1e-4 );
		vec3 hazeDir = hazeRay / hazeLen;
		float hazeY0 = ( cameraPosition.y - ${LOOK.hazeLevel.toFixed(2)} ) / ${LOOK.hazeHeight.toFixed(2)};
		float hazeY1 = ( vFogWorld.y - ${LOOK.hazeLevel.toFixed(2)} ) / ${LOOK.hazeHeight.toFixed(2)};
		float hazeE0 = exp( - clamp( hazeY0, -10.0, 30.0 ) );
		float hazeE1 = exp( - clamp( hazeY1, -10.0, 30.0 ) );
		float hazeDy = hazeY1 - hazeY0;
		float hazeMean = abs( hazeDy ) > 1e-3 ? ( hazeE0 - hazeE1 ) / hazeDy : hazeE0;
		float hazeDens = fogDensity * mix( 1.0, ${LOOK.hazeUpFactor.toFixed(3)}, smoothstep( 0.02, 0.10, hazeDir.y ) );
		float hazeTau = ${LOOK.hazeFloor.toFixed(5)} * hazeLen * hazeMean + hazeDens * hazeDens * hazeLen * hazeLen;
		float fogFactor = 1.0 - exp( - hazeTau );
		fogFactor = max( fogFactor, 0.94 * smoothstep( ${(-LOOK.hazeSink[0]).toFixed(1)}, ${(-LOOK.hazeSink[1]).toFixed(1)}, vFogWorld.y - ${LOOK.hazeLevel.toFixed(2)} ) );
		float hazeSun = pow( max( dot( hazeDir, ${glsl(sunH)} ), 0.0 ), 5.0 ) * 0.85;
		vec3 hazeCol = mix( fogColor, ${glsl(LOOK.hazeSunColor)}, hazeSun );
		hazeCol = mix( hazeCol, ${glsl(LOOK.hazeDeepColor)}, smoothstep( 0.03, 0.5, - hazeDir.y ) );
		// a rising ray ends in the sky: its colour at that height and heading
		float hazeAim = dot( normalize( vec3( hazeDir.x, 0.0, hazeDir.z ) + vec3( 1e-4, 0.0, 0.0 ) ), ${glsl(sunH)} );
		vec3 hazeBlue = hazeAim < 0.0 ? mix( ${glsl(LOOK.skyAnti)}, ${glsl(LOOK.skySide)}, hazeAim + 1.0 ) : mix( ${glsl(LOOK.skySide)}, ${glsl(LOOK.skySun)}, hazeAim );
		hazeBlue = mix( hazeBlue, vec3( dot( hazeBlue, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.4 ) * vec3( 1.07, 1.0, 0.93 ); // not as blue as the sky: the hanging city is lit by it
		hazeCol = mix( hazeCol, hazeBlue, 0.85 * smoothstep( -0.01, 0.16, hazeDir.y ) );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, hazeCol, fogFactor );
	#else
		float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
		gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor, fogFactor );
	#endif
#endif`;
}

/**
 * Load the HDRI and make two filtered maps of it: the sky the player sees, and the light it gives.
 * Both: the pixels are turned so the photo's sun stands where LOOK.sunDir points and cut at LOOK.skyClamp.
 * The sky is blended into the haze colour at and below the horizon, so distant things fade into the colour the sky
 * has there. The light is the same sky greyed and warmed a little (a clear evening sky alone lights the shade a
 * strong blue), with the sunlit ground in its lower half at shallow angles (the bounce that fills upright faces).
 */
/**
 * The visible sky (the owner's decision of 2026-11-24): after reference A1, the horizon's pale warm band runs up into the blue
 * over a long gradient (to about 16 degrees instead of 9) and the blue is less saturated. Only the sky that is seen follows
 * these numbers: the light it gives is built from the sky as it was before. `?sky=old` shows that earlier sky, to compare.
 */
export const SKY_A1 = { bandTop: 0.28, grey: 0.08, redFall: 2.5, greenFall: 1.3 };

export async function loadSky(scene: THREE.Scene, renderer: THREE.WebGLRenderer, url = LOOK.hdri, sunU = LOOK.hdriSunU, gain = LOOK.hdriGain, variant: string | null = null) {
  const a1 = variant !== 'old';
  const src = await new HDRLoader().setDataType(THREE.FloatType).loadAsync(url);
  const { width: w, height: h } = src.image as { width: number; height: number };
  const data = src.image.data as Float32Array;
  const sky = new Uint16Array(w * h * 4);
  const light = new Uint16Array(w * h * 4);
  const targetU = Math.atan2(LOOK.sunDir.z, LOOK.sunDir.x) / (2 * Math.PI) + 0.5;
  const shift = Math.round((sunU - targetU) * w);
  const sunH = new THREE.Vector3(LOOK.sunDir.x, 0, LOOK.sunDir.z).normalize();
  const haze = [0, 0, 0];
  const px = [0, 0, 0];
  const bounce = LOOK.bounceColor.toArray();
  const fill = LOOK.fillTint.toArray();
  const one = THREE.DataUtils.toHalfFloat(1);
  // HDRLoader keeps the file's row order (top row first) and sets flipY, so row 0 is the zenith.
  for (let y = 0; y < h; y++) {
    const elevation = (0.5 - (y + 0.5) / h) * Math.PI;
    // haze band: full at and below the horizon, gone 9 degrees up, so the blue of the sky shows in the play view
    const k = 1 - THREE.MathUtils.smoothstep(elevation, -0.01, 0.16);
    const band = elevation < 0 ? 1 : k;
    const bandA1 = elevation < 0 ? 1 : 1 - THREE.MathUtils.smoothstep(elevation, -0.01, SKY_A1.bandTop);
    const zenith = 1 + (LOOK.zenithGain - 1) * THREE.MathUtils.smoothstep(Math.sin(Math.max(elevation, 0)), 0.08, 0.85);
    const deep = THREE.MathUtils.smoothstep(-Math.sin(elevation), 0.03, 0.5);
    // the lit ground, only at shallow angles: that lights upright faces; straight below stays haze, so undersides stay dark
    const ground = THREE.MathUtils.smoothstep(-elevation, 0.1, 0.3) * (1 - THREE.MathUtils.smoothstep(-elevation, 0.75, 1.15));
    // the upper sky lights the paving almost alone: its share of the light is cut, the horizon band is kept
    const upperCut = 1 - (1 - LOOK.skyFill) * THREE.MathUtils.smoothstep(elevation, 0.05, 0.5);
    for (let x = 0; x < w; x++) {
      const sx = (((x + shift) % w) + w) % w;
      const i = (y * w + sx) * 4;
      const o = (y * w + x) * 4;
      const az = ((x + 0.5) / w - 0.5) * 2 * Math.PI;
      const lean = sunLean(Math.cos(az) * sunH.x + Math.sin(az) * sunH.z);
      haze[0] = LOOK.hazeColor.r + (LOOK.hazeSunColor.r - LOOK.hazeColor.r) * lean;
      haze[1] = LOOK.hazeColor.g + (LOOK.hazeSunColor.g - LOOK.hazeColor.g) * lean;
      haze[2] = LOOK.hazeColor.b + (LOOK.hazeSunColor.b - LOOK.hazeColor.b) * lean;
      haze[0] += (LOOK.hazeDeepColor.r - haze[0]) * deep;
      haze[1] += (LOOK.hazeDeepColor.g - haze[1]) * deep;
      haze[2] += (LOOK.hazeDeepColor.b - haze[2]) * deep;
      for (let c = 0; c < 3; c++) {
        const v = Math.min(data[i + c] * gain, LOOK.skyClamp) * LOOK.skyIntensity * zenith;
        px[c] = v + (haze[c] - v) * Math.min(1, band);
        if (!a1) sky[o + c] = THREE.DataUtils.toHalfFloat(px[c]);
      }
      if (a1) {
        const lum = 0.2126 * data[i] + 0.7152 * data[i + 1] + 0.0722 * data[i + 2];
        for (let c = 0; c < 3; c++) {
          const raw = data[i + c] + (lum - data[i + c]) * SKY_A1.grey;
          const v = Math.min(raw * gain, LOOK.skyClamp) * LOOK.skyIntensity * zenith;
          // (the warm band leaves red first, then green, on its way up into the blue: half-way it is a pale blue as in A1, not
          // the lilac a straight blend of peach and blue gives)
          const t = Math.min(1, bandA1) ** (c === 0 ? SKY_A1.redFall : c === 1 ? SKY_A1.greenFall : 1);
          sky[o + c] = THREE.DataUtils.toHalfFloat(v + (haze[c] - v) * t);
        }
      }
      const grey = 0.2126 * px[0] + 0.7152 * px[1] + 0.0722 * px[2];
      for (let c = 0; c < 3; c++) {
        const lit = (px[c] + (grey * fill[c] - px[c]) * LOOK.fillGrey) * upperCut;
        light[o + c] = THREE.DataUtils.toHalfFloat(lit + (bounce[c] - lit) * ground);
      }
      sky[o + 3] = light[o + 3] = one;
    }
  }
  src.dispose();
  const pmrem = new THREE.PMREMGenerator(renderer);
  const filtered = (pixels: Uint16Array) => {
    const tex = new THREE.DataTexture(pixels, w, h, THREE.RGBAFormat, THREE.HalfFloatType);
    tex.mapping = THREE.EquirectangularReflectionMapping;
    tex.colorSpace = THREE.LinearSRGBColorSpace;
    tex.minFilter = tex.magFilter = THREE.LinearFilter;
    tex.flipY = true;
    tex.needsUpdate = true;
    const out = pmrem.fromEquirectangular(tex).texture;
    tex.dispose();
    return out;
  };
  scene.environment = filtered(light);
  scene.environmentIntensity = LOOK.ambientIntensity / LOOK.skyIntensity;
  scene.background = filtered(sky); // the filtered sky: a gradient needs no more, and the 1K source is freed
  scene.backgroundBlurriness = 0;
  scene.backgroundIntensity = 1;
  pmrem.dispose();
}

/**
 * Make the gilt reflect the sky `LOOK.giltEnv` times as strongly as the rest. three.js only reads a material's own
 * `envMapIntensity` when the material has an `envMap` of its own (otherwise it uses the scene's `environmentIntensity`),
 * so the gilt is given the scene's environment as its own. Call once the sky and the kit are both loaded.
 */
export function giltTakesSky(scene: THREE.Scene, gilt: THREE.MeshStandardMaterial[]) {
  if (!scene.environment) return;
  for (const m of gilt) {
    m.envMap = scene.environment;
    m.envMapIntensity = scene.environmentIntensity * LOOK.giltEnv;
    m.needsUpdate = true;
  }
}

export interface Sun {
  light: THREE.DirectionalLight;
  /** Centre the shadow map on what the camera looks at, in whole texels so the shadow edges do not swim. */
  follow(camera: THREE.Camera, floorY: number): void;
}

export function createSun(scene: THREE.Scene, quality: 'low' | 'medium' | 'high'): Sun {
  const light = new THREE.DirectionalLight(LOOK.sunColor, LOOK.sunIntensity);
  const size = quality === 'high' ? 4096 : 2048;
  const half = quality === 'high' ? LOOK.shadowHalf : LOOK.shadowHalf * 0.7;
  light.castShadow = true;
  light.shadow.mapSize.set(size, size);
  const sc = light.shadow.camera;
  sc.left = sc.bottom = -half;
  sc.right = sc.top = half;
  sc.near = 1;
  sc.far = 420;
  light.shadow.bias = -0.0002;
  light.shadow.normalBias = 0.02;
  scene.add(light, light.target);
  const dir = LOOK.sunDir.clone().normalize();
  const right = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), dir).normalize();
  const up = new THREE.Vector3().crossVectors(dir, right).normalize();
  const texel = (half * 2) / size;
  const fwd = new THREE.Vector3();
  const focus = new THREE.Vector3();
  const follow = (camera: THREE.Camera, floorY: number) => {
    camera.getWorldDirection(fwd);
    const t = fwd.y < -0.05 ? THREE.MathUtils.clamp((floorY - camera.position.y) / fwd.y, 6, 60) : 22;
    focus.copy(camera.position).addScaledVector(fwd, t);
    const a = Math.round(focus.dot(right) / texel) * texel;
    const b = Math.round(focus.dot(up) / texel) * texel;
    const c = Math.round(focus.dot(dir) / 4) * 4;
    focus.set(0, 0, 0).addScaledVector(right, a).addScaledVector(up, b).addScaledVector(dir, c);
    light.target.position.copy(focus);
    light.position.copy(focus).addScaledVector(dir, 210);
    light.target.updateMatrixWorld();
    light.updateMatrixWorld();
  };
  return { light, follow };
}

/** A floor far below everything: it takes the haze colour completely, so no view looks through to the sky's underside. */
export function hazeFloor(): THREE.Mesh {
  const m = new THREE.Mesh(new THREE.CircleGeometry(2400, 48), new THREE.MeshBasicMaterial({ color: '#000000' }));
  m.rotation.x = -Math.PI / 2;
  m.position.y = -170;
  m.frustumCulled = false;
  return m;
}
