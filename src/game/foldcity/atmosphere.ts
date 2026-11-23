// The folded city's own haze. The play area keeps look.ts's haze (it thickens below the walkways); the background is not
// "below" anything, it is a world that curls around the player, so its haze is plain distance from the camera and one
// colour, the horizon's (look.ts, hazeColor): near walls stay clear, far parts sink into it. Separately, where the sheet
// ends (the tops of the canyon's walls, the far ends of the channel) it dissolves into the sky behind it, read from the
// same filtered sky map the scene draws as its background, so no edge shows. (Until the sky has loaded, or if it fails,
// the colours of look.ts stand in.) Materials here set `fog: false` and call `bgAtmosphere` last.
import * as THREE from 'three';
import { LOOK } from '../look.ts';

export interface AtmosphereParams {
  /**
   * The haze with distance: fog = 1 - exp(-(density * d)^power). It thickens with depth instead of lying as one even veil:
   * with 1/560 and the fifth power there is under 1 % on 200 m, 4 % on 300 m, 17 % on 400 m, 43 % on 500 m, 76 % on 600 m
   * and 95 % on 700 m, so
   * the near city keeps its own colours and darks and the far city sinks.
   */
  density: number;
  power: number;
  /** How strongly the haze takes the colour of the thing it covers: 1 = the plain haze. */
  strength: number;
  /** The city's own light, before the haze: brightness and saturation (1 = as the lighting gives it). */
  gain: number;
  saturation: number;
  /** Shadows are lifted towards the warm haze grey by this much (0 = none): the city's darkest faces are never black. */
  lift: number;
  /** The least haze anything of the background lies under, however near (0 to 1): it never stands as crisp as the play area. */
  base?: number;
  /** How much deeper below the walkways (from about 30 m down to 110 m) the haze gets, as a share of full haze: the piers' feet sink into it. */
  sink: number;
}

export type AtmosphereUniforms = Record<string, THREE.IUniform>;

/**
 * The city's own light. The play area's sun is low and comes from one side of the world, so on a folded sheet it would light
 * a wall of city more than the ground and leave a ceiling black; a light that is the same on every face (round 1) leaves the
 * city without direction, a model. The light in between: every face of the sheet gets a key light in its own frame, at a
 * fixed low height above the sheet, from the direction the world's sun has along that face (the sun projected onto the
 * sheet), so each building has a lit and a shade side and throws a long shadow across its street (ground.ts) on a floor, a
 * wall and a ceiling alike. How much of that key a face gets, and how much sky light, follows how far the face is turned to
 * the world's sun (EXPOSE): the canyon's wall that faces the sun stands in it, the wall opposite in shade, floor and ceiling
 * between the two, and none is black. Linear colours; the gain and saturation of AtmosphereParams still apply on top.
 */
export const KEY_ELEVATION = (34 * Math.PI) / 180;
/**
 * Where the haze has all but taken the city it goes on into the sky (bgFar). It does so block by block: each block of the
 * street lattice, with its houses whole, a little nearer or further than the next (up to half of FAR_JITTER metres either
 * way, from the block's own number), so the far end of a canyon wall is a line of roofs and not a ruled edge.
 */
export const FAR_JITTER = 260;
/** Direction towards the key light along the flat sheet (a, b): the sun's side of the play area. */
export const KEY_ALONG: readonly [number, number] = (() => {
  const l = Math.hypot(LOOK.sunDir.x, LOOK.sunDir.z);
  return [LOOK.sunDir.x / l, LOOK.sunDir.z / l] as const;
})();
const KEY_COLOR = new THREE.Color(2.9, 2.38, 1.76);
const SKY_COLOR = new THREE.Color(0.92, 1.0, 1.16);
const SHADE_COLOR = new THREE.Color(0.86, 0.84, 0.86);
/** (key on a face turned away from the sun, key on one turned to it, sky light away, sky light towards). */
const EXPOSE = new THREE.Vector4(0.42, 1.12, 0.8, 0.9);

/** `?farwin=1`: the fronts keep this share of the way to their rows' tone from 135-200 m out to about 400 m (the default takes 0.78 of it at once), and the rest by 520 m. */
export const FAR_WINDOWS = 0.4;
/** The instance colour's alpha is free (the key's direction comes from the instance's matrix): FoldCity's studies leave it at 1. */
export const keyTurn = (_swap: boolean, _flip: boolean): number => 1;

export function atmosphereUniforms(p: AtmosphereParams): AtmosphereUniforms {
  const sunH = new THREE.Vector3(LOOK.sunDir.x, 0, LOOK.sunDir.z).normalize();
  return {
    uBgDensity: { value: p.density },
    uBgPower: { value: p.power },
    uBgStrength: { value: p.strength },
    uBgGain: { value: p.gain },
    uBgSat: { value: p.saturation },
    uBgLift: { value: p.lift },
    uBgSink: { value: p.sink },
    uBgBase: { value: p.base ?? 0 },
    uBgHaze: { value: LOOK.hazeColor.clone() },
    uBgHazeSun: { value: LOOK.hazeSunColor.clone() },
    uBgHazeDeep: { value: LOOK.hazeDeepColor.clone() },
    uBgSkyAnti: { value: LOOK.skyAnti.clone() },
    uBgSkySide: { value: LOOK.skySide.clone() },
    uBgSkySun: { value: LOOK.skySun.clone() },
    uBgSunH: { value: sunH },
    uBgSky: { value: null as THREE.Texture | null },
    uBgSkyOn: { value: 0 },
    uBgVeil: { value: 0 },
    uBgDebug: { value: 0 },
    uBgKey: { value: new THREE.Vector2(Math.cos(KEY_ELEVATION), Math.sin(KEY_ELEVATION)) },
    uBgSun: { value: LOOK.sunDir.clone().normalize() },
    uBgExpose: { value: EXPOSE.clone() },
    uBgFarSky: { value: new THREE.Vector2(0, 1e6) },
    uBgRowTone: { value: null as THREE.Texture | null },
    uBgRowOn: { value: 0 },
    uBgWin: { value: new THREE.Vector4(135, 200, 0, 0) },
    uBgKeyCol: { value: KEY_COLOR.clone() },
    uBgSkyCol: { value: SKY_COLOR.clone() },
    uBgShadeCol: { value: SHADE_COLOR.clone() },
  };
}

const DECL = /* glsl */ `
uniform float uBgDensity;
uniform float uBgPower;
uniform float uBgStrength;
uniform float uBgGain;
uniform float uBgSat;
uniform float uBgLift;
uniform float uBgSink;
uniform float uBgBase;
uniform vec3 uBgHaze;
uniform vec3 uBgHazeSun;
uniform vec3 uBgHazeDeep;
uniform vec3 uBgSkyAnti;
uniform vec3 uBgSkySide;
uniform vec3 uBgSkySun;
uniform vec3 uBgSunH;
uniform sampler2D uBgSky;
uniform float uBgSkyOn;
uniform float uBgVeil;
uniform float uBgDebug;
varying vec3 vBgUp;
uniform vec2 uBgKey;
uniform vec4 uBgExpose;
uniform vec2 uBgFarSky;
uniform sampler2D uBgRowTone;
uniform float uBgRowOn;
uniform vec4 uBgWin;
uniform vec3 uBgKeyCol;
uniform vec3 uBgSkyCol;
uniform vec3 uBgShadeCol;
// the light on a face whose normal, in the sheet's frame (y = away from the sheet), is n. key = the world's sun in that
// frame: (x, z) its direction along the sheet, y how far the sheet's face is turned to it. sun = how much of the key
// arrives (the ground's shadows), sky = how much of the sky's light does (a street between its fronts, a court, the foot
// of a wall see little of the sky: the city's deep shade)
vec3 bgLight( vec3 n, vec3 key, float sun, float sky ) {
	vec2 d = normalize( key.xz + vec2( 1e-4, 0.0 ) );
	vec3 l = vec3( d.x * uBgKey.x, uBgKey.y, d.y * uBgKey.x );
	float ex = smoothstep( -0.9, 0.9, key.y );
	return uBgKeyCol * ( max( dot( n, l ), 0.0 ) * sun * mix( uBgExpose.x, uBgExpose.y, ex ) ) + mix( uBgShadeCol, uBgSkyCol, n.y * 0.5 + 0.5 ) * ( sky * mix( uBgExpose.z, uBgExpose.w, ex ) );
}
// a building's own shade: its walls see less of the sky, and of the key light, the lower they stand in their street;
// roofs see all of both
vec2 bgCanyon( vec3 n, float high ) {
	float wall = 1.0 - smoothstep( 0.2, 0.7, n.y );
	float low = 1.0 - smoothstep( 0.0, 26.0, high );
	return vec2( 1.0 - 0.5 * wall * low, 1.0 - 0.58 * wall * low );
}
// how far a thing at this distance, which the haze has all but taken, has gone on into the sky behind it (0 to 1). Only
// where the sky is behind it: all of the open canyon (uBgFarSky.x = 1), and what stands above the ceiling of the channel
// (uBgFarSky.y, the walls of its slot). Under a ceiling the far end stays haze (the caps of morphcity.ts close it).
float bgFar( float len ) {
	// (a building is taken whole, by the distance of its foot: bgFarLen; a block of ground by its own shift)
	len = max( ( bgFarLen > 0.0 ? bgFarLen : len ) + bgFarShift, 0.0 );
	return smoothstep( 0.80, 0.985, 1.0 - exp( - pow( uBgDensity * len, uBgPower ) ) ) * max( uBgFarSky.x, smoothstep( uBgFarSky.y, uBgFarSky.y + 40.0, vBgWorld.y ) );
}
vec3 bgAtmosphere( vec3 col ) {
	col = mix( vec3( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) ), col, uBgSat ) * uBgGain + uBgLift * uBgHaze;
	vec3 ray = vBgWorld - cameraPosition;
	float len = max( length( ray ), 1e-4 );
	vec3 dir = ray / len;
	// the haze: one colour, the horizon's in the direction looked in (read from the sky map), thickening with distance alone
	float tau = pow( uBgDensity * len, uBgPower );
	// (roofs and towers stand in thinner haze, but only this side of where the haze takes everything: nothing is left standing
	// alone in the sky when the ground under it has gone)
	float thin = mix( bgThin, 1.0, smoothstep( 220.0, 380.0, len ) );
	float f = ( 1.0 - exp( - tau * thin ) ) * uBgStrength;
	f = max( f, ( 1.0 - smoothstep( -110.0, -30.0, vBgWorld.y ) ) * uBgSink );
	vec3 haze = mix( uBgHaze, uBgHazeSun, pow( max( dot( dir, uBgSunH ), 0.0 ), 5.0 ) * 0.85 );
#ifdef ENVMAP_TYPE_CUBE_UV
	// (the ray keeps its own height within a degree of the horizon, so the far end of the channel cannot be told from the sky beside it)
	if ( uBgSkyOn > 0.5 ) haze = textureCubeUV( uBgSky, normalize( vec3( dir.x, clamp( dir.y, -0.02, 0.012 ), dir.z ) + vec3( 1e-4, 0.0, 0.0 ) ), 0.0 ).rgb;
#endif
	bgHazeCol = haze;
	bgFog = clamp( f, 0.0, 1.0 );
	col = mix( col, haze, clamp( max( f, uBgBase ), 0.0, 1.0 ) );
	// where the sheet ends it dissolves into whatever sky lies behind it, so no edge shows
	// and what the haze has taken altogether goes on into the sky: the far end of the canyon and of the channel, and a wall
	// that rises out of sight, have no outline against it
	float veil = max( max( bgVeil, uBgVeil ), bgFar( len ) );
	if ( veil <= 0.0 ) return col;
	vec3 sky = mix( uBgHaze, uBgHazeSun, pow( max( dot( dir, uBgSunH ), 0.0 ), 5.0 ) * 0.85 );
	sky = mix( sky, uBgHazeDeep, smoothstep( 0.03, 0.5, - dir.y ) );
	float aim = dot( normalize( vec3( dir.x, 0.0, dir.z ) + vec3( 1e-4, 0.0, 0.0 ) ), uBgSunH );
	vec3 blue = aim < 0.0 ? mix( uBgSkyAnti, uBgSkySide, aim + 1.0 ) : mix( uBgSkySide, uBgSkySun, aim );
	sky = mix( sky, blue, smoothstep( -0.01, 0.16, dir.y ) );
#ifdef ENVMAP_TYPE_CUBE_UV
	if ( uBgSkyOn > 0.5 ) sky = textureCubeUV( uBgSky, dir, 0.0 ).rgb;
#endif
	return mix( col, sky, clamp( veil, 0.0, 1.0 ) );
}
// ?bgdebug=facing: flat colours by class. Ground seen roof-on (the view ray within 30 degrees of the sheet's normal) red,
// other ground yellow, roofs seen roof-on magenta, other roofs blue, building walls green. Dissolved parts count as sky.
vec3 bgFacing() {
	vec3 ray = normalize( vBgWorld - cameraPosition );
#ifdef BG_GROUND
	vec3 sn = normalize( cross( dFdx( vBgWorld ), dFdy( vBgWorld ) ) );
	bool on = abs( dot( ray, sn ) ) > 0.8660254;
	vec3 c = on ? vec3( 0.6, 0.0, 0.0 ) : vec3( 0.6, 0.6, 0.0 );
#else
	bool on = abs( dot( ray, normalize( vBgUp ) ) ) > 0.8660254;
	vec3 c = normalize( vBgNormal ).y > 0.3 ? ( on ? vec3( 0.6, 0.0, 0.6 ) : vec3( 0.0, 0.0, 0.6 ) ) : vec3( 0.0, 0.6, 0.0 );
#endif
	if ( uBgDebug > 1.5 ) c = length( vBgWorld - cameraPosition ) > 200.0 ? vec3( 0.6, 0.0, 0.0 ) : vec3( 0.0, 0.6, 0.0 ); // ?bgdebug=range
	// ?bgdebug=dist: bands of 100 m as a three-bit code (red 1, green 2, blue 4): 0-100 m red, 100-200 green, ..., 600 m and beyond white
	if ( uBgDebug > 2.5 ) { float k = min( floor( length( vBgWorld - cameraPosition ) / 100.0 ) + 1.0, 7.0 ); c = 0.6 * vec3( mod( k, 2.0 ), mod( floor( k / 2.0 ), 2.0 ), floor( k / 4.0 ) ); }
	return max( max( bgVeil, uBgVeil ), bgFar( length( vBgWorld - cameraPosition ) ) ) > 0.5 ? vec3( 0.0 ) : c;
}
`;

/**
 * Patch a MeshStandardMaterial's shader: the world position as a varying, the haze function, and the call at the end.
 * `vertexDecl`/`vertexMain` and `fragmentDecl` let the caller add its own pieces (the ground's sheet coordinates).
 */
export function patchShader(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> },
  uniforms: AtmosphereUniforms,
  extra: {
    vertexDecl?: string; vertexMain?: string; vertexBegin?: string; fragmentDecl?: string; fragmentColor?: string; fragmentRough?: string; uniforms?: Record<string, THREE.IUniform>;
    /** GLSL expression of the light on the fragment (see bgLight); the default lights a batched building by its own normal. */
    light?: string;
    /** This material is the sheet's ground (the debug view tells ground from buildings). */
    ground?: boolean;
    /** GLSL statements run last, after the haze (the slot's veil sets its own alpha). */
    fragmentEnd?: string;
  } = {},
) {
  Object.assign(shader.uniforms, uniforms, extra.uniforms ?? {});
  const swap = (src: string, marker: string, text: string) => {
    if (!src.includes(marker)) throw new Error(`shader chunk ${marker} not found`);
    return src.replace(marker, text);
  };
  shader.vertexShader = swap(shader.vertexShader, '#include <common>', `#include <common>\nvarying vec3 vBgWorld;\nvarying vec3 vBgNormal;\nvarying vec3 vBgKeyDir;\nvarying float vBgHigh;\nvarying vec3 vBgUp;\nvarying vec4 vBgFoot;\nuniform vec3 uBgSun;\n${extra.vertexDecl ?? ''}`);
  shader.vertexShader = swap(
    shader.vertexShader, '#include <beginnormal_vertex>',
    `#include <beginnormal_vertex>\nvBgNormal = objectNormal;\nvBgKeyDir = uBgSun;\nvBgHigh = 0.0;\nvBgUp = vec3( 0.0, 1.0, 0.0 );\nvBgFoot = vec4( 0.0 );\n#ifdef USE_BATCHING\nmat3 bgM = mat3( batchingMatrix );\nvBgFoot = vec4( batchingMatrix[ 3 ].xyz, 1.0 );\n#ifdef USE_BATCHING_COLOR\nvBgFoot.w = 1.0 + getBatchingColor( getIndirectIndex( gl_DrawID ) ).a;\n#endif\nvBgUp = bgM[ 1 ];\nvBgKeyDir = vec3( dot( uBgSun, normalize( bgM[ 0 ] ) ), dot( uBgSun, normalize( bgM[ 1 ] ) ), dot( uBgSun, normalize( bgM[ 2 ] ) ) );\nvBgHigh = position.y * length( bgM[ 1 ] );\n#endif`,
  );
  if (extra.vertexBegin) shader.vertexShader = swap(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>\n${extra.vertexBegin}`);
  shader.vertexShader = swap(shader.vertexShader, '#include <fog_vertex>', `#include <fog_vertex>\nvBgWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );\n${extra.vertexMain ?? ''}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <common>', `#include <common>\n${extra.ground ? '#define BG_GROUND\n' : ''}varying vec3 vBgWorld;\nvarying vec3 vBgNormal;\nvarying vec3 vBgKeyDir;\nvarying float vBgHigh;\nvarying vec4 vBgFoot;\nfloat bgFarLen = -1.0; // set by a material: the distance bgFar goes by, instead of the fragment's own\nfloat bgFarShift = 0.0; // and metres added to it (a block's own)\nfloat bgVeil = 0.0; // set by a material: 1 = this fragment has dissolved into the haze\nvec3 bgHazeCol = vec3( 0.0 ); // set by bgAtmosphere: the haze's colour along this ray, and how much of it lies on the fragment
float bgFog = 0.0;
float bgThin = 1.0; // the haze's depth here, as a share: roofs and towers stand in thinner haze than the streets\n${extra.fragmentDecl ?? ''}`);
  // the city's own light replaces the scene's sun, fill and sky light
  shader.fragmentShader = swap(
    shader.fragmentShader, '#include <opaque_fragment>',
    `bgThin = mix( 1.0, 0.6, smoothstep( 14.0, 60.0, vBgHigh ) );\nif ( vBgFoot.w > 0.5 ) { bgFarLen = length( vBgFoot.xyz - cameraPosition ); bgFarShift = ( vBgFoot.w - 1.5 ) * ${FAR_JITTER.toFixed(1)}; }\noutgoingLight = diffuseColor.rgb * ( ${extra.light ?? 'bgLight( normalize( vBgNormal ), vBgKeyDir, bgCanyon( normalize( vBgNormal ), vBgHigh ).x, bgCanyon( normalize( vBgNormal ), vBgHigh ).y )'} );\n#include <opaque_fragment>`,
  );
  shader.fragmentShader = swap(shader.fragmentShader, '#include <envmap_physical_pars_fragment>', `#include <envmap_physical_pars_fragment>\n${DECL}`);
  // far facades lose their windows: beyond about 200 m a front is the mean tone of each of its rows (soft horizontal bands
  // of storeys and cornices) with a fifth of its windows' contrast left, read from a one-pixel-wide copy of the atlas; nearer
  // than 135 m it is the atlas itself (uBgWin.xy). `?farwin=1` (FAR_WINDOWS) keeps the windows further out at reduced
  // contrast: uBgWin.z of the way to the rows' tone from there on, the rest between uBgWin.x + 265 and + 385 m
  if (shader.fragmentShader.includes('#include <map_fragment>'))
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	// (only the strips that hold windows, rows 96 to 456 of the atlas from its foot: slate, zinc, ashlar and glazing keep their grain)
	if ( uBgRowOn > 0.5 && vMapUv.y > 0.1094 && vMapUv.y < 0.8125 ) sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, textureLod( uBgRowTone, vec2( 0.5, vMapUv.y ), 0.0 ).rgb, mix( 0.78, uBgWin.z, uBgWin.w ) * smoothstep( uBgWin.x, uBgWin.y, length( vBgWorld - cameraPosition ) ) + uBgWin.w * ( 0.78 - uBgWin.z ) * smoothstep( uBgWin.x + 265.0, uBgWin.x + 385.0, length( vBgWorld - cameraPosition ) ) );
	diffuseColor *= sampledDiffuseColor;
#endif`,
    );
  if (extra.fragmentColor) shader.fragmentShader = swap(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>\n${extra.fragmentColor}`);
  if (extra.fragmentRough) shader.fragmentShader = swap(shader.fragmentShader, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${extra.fragmentRough}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <fog_fragment>', `#include <fog_fragment>\ngl_FragColor.rgb = uBgDebug > 0.5 ? bgFacing() : bgAtmosphere( gl_FragColor.rgb );
${extra.fragmentEnd ?? ''}`);
}

/**
 * The mean colour of every row of the facade atlas, as a texture one pixel wide: what a front looks like from too far to
 * tell its windows (patchShader). Null when the image cannot be read.
 */
export function rowTone(map: THREE.Texture): THREE.DataTexture | null {
  const image = map.image as (CanvasImageSource & { width: number; height: number }) | undefined;
  if (!image || typeof document === 'undefined') return null;
  const canvas = document.createElement('canvas');
  canvas.width = image.width;
  canvas.height = image.height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) return null;
  ctx.drawImage(image, 0, 0);
  const px = ctx.getImageData(0, 0, image.width, image.height).data;
  const out = new Uint8Array(image.height * 4);
  const lin = (c: number) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  const enc = (c: number) => (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055);
  const h = image.height;
  const rows = new Float64Array(h * 3);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < image.width; x++) for (let c = 0; c < 3; c++) rows[y * 3 + c] += lin(px[(y * image.width + x) * 4 + c] / 255) / image.width;
  // within each strip of the atlas (art/blender/city_kit.py, STRIPS: rows from the bottom of a 512 px image) the rows are
  // smoothed and drawn three quarters of the way to the strip's mean: soft bands of storeys, not the stripes of a blind
  const STRIPS = [0, 16, 64, 80, 96, 208, 288, 368, 456, 512];
  const k = h / 512;
  for (let s = 0; s + 1 < STRIPS.length; s++) {
    const y1 = h - Math.round(STRIPS[s] * k); // image rows run from the top
    const y0 = h - Math.round(STRIPS[s + 1] * k);
    const mean = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let c = 0; c < 3; c++) mean[c] += rows[y * 3 + c] / (y1 - y0);
    const radius = Math.round(9 * k);
    for (let y = y0; y < y1; y++) {
      for (let c = 0; c < 3; c++) {
        let sum = 0;
        let w = 0;
        for (let d = -radius; d <= radius; d++) {
          const yy = Math.min(y1 - 1, Math.max(y0, y + d));
          const g = Math.exp(-(d * d) / (2 * (radius / 2) ** 2));
          sum += rows[yy * 3 + c] * g;
          w += g;
        }
        out[y * 4 + c] = Math.round(enc(0.25 * (sum / w) + 0.75 * mean[c]) * 255);
      }
      out[y * 4 + 3] = 255;
    }
  }
  const tex = new THREE.DataTexture(out, 1, image.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.minFilter = tex.magFilter = THREE.LinearFilter;
  tex.flipY = map.flipY;
  tex.needsUpdate = true;
  return tex;
}

/** Hand the scene's sky map to the haze: call from onBeforeRender, every frame (the map arrives after the first frames). */
export function bindSky(uniforms: AtmosphereUniforms, scene: THREE.Scene) {
  const bg = scene.background as THREE.Texture | THREE.Color | null;
  const ok = !!bg && (bg as THREE.Texture).isTexture === true && (bg as THREE.Texture).mapping === THREE.CubeUVReflectionMapping;
  uniforms.uBgSky.value = ok ? (bg as THREE.Texture) : null;
  uniforms.uBgSkyOn.value = ok ? 1 : 0;
}
