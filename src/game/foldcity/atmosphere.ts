// The folded city's own haze. The play area keeps look.ts's haze (it thickens below the walkways); the background is not
// "below" anything, it is a world that curls around the player, so its haze is plain distance from the camera and one
// colour, the horizon's (look.ts, hazeColor): near walls stay clear, far parts sink into it. Separately, where the sheet
// ends (the tops of the canyon's walls, the far ends of the channel) it dissolves into the sky behind it, read from the
// same filtered sky map the scene draws as its background, so no edge shows. (Until the sky has loaded, or if it fails,
// the colours of look.ts stand in.) Materials here set `fog: false` and call `bgAtmosphere` last.
import * as THREE from 'three';
import { LOOK } from '../look.ts';

export interface AtmosphereParams {
  /** exp2 density with distance: fog = 1 - exp(-(density * d)^2). 0.0019 puts 28 % on 300 m, 68 % on 600 m, 97 % on 1000 m. */
  density: number;
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
 * a wall of city more than the ground and leave a ceiling dark. The background is lit in the sheet's own frame instead: a key
 * light at a fixed height above the sheet and a fixed direction along it, and a soft light from "above the sheet" and from
 * its streets, the same on the ground, on a wall and on a ceiling. Linear colours; the gain and saturation of
 * AtmosphereParams still apply on top.
 */
const KEY_ELEVATION = (40 * Math.PI) / 180;
/** Direction towards the key light along the sheet (a, b): from the sun's side of the play area. */
export const KEY_ALONG: readonly [number, number] = (() => {
  const l = Math.hypot(LOOK.sunDir.x, LOOK.sunDir.z);
  return [LOOK.sunDir.x / l, LOOK.sunDir.z / l] as const;
})();
const KEY_COLOR = new THREE.Color(3.0, 2.5, 1.9);
const SKY_COLOR = new THREE.Color(1.0, 1.05, 1.16);
const SHADE_COLOR = new THREE.Color(1.0, 0.94, 0.88);

/**
 * The direction of the key light in a building's own frame, as the turn (0 to 1) about its up axis that the batch carries in
 * the alpha of the instance colour. `swap`: the model's X runs along b; `flip`: turned half a turn.
 */
export function keyTurn(swap: boolean, flip: boolean): number {
  const [la, lb] = KEY_ALONG;
  const c = flip ? -1 : 1;
  const [lx, lz] = swap ? [c * lb, -c * la] : [c * la, c * lb];
  const t = Math.atan2(lz, lx) / (2 * Math.PI);
  return t - Math.floor(t);
}

export function atmosphereUniforms(p: AtmosphereParams): AtmosphereUniforms {
  const sunH = new THREE.Vector3(LOOK.sunDir.x, 0, LOOK.sunDir.z).normalize();
  return {
    uBgDensity: { value: p.density },
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
    uBgKeyCol: { value: KEY_COLOR.clone() },
    uBgSkyCol: { value: SKY_COLOR.clone() },
    uBgShadeCol: { value: SHADE_COLOR.clone() },
  };
}

const DECL = /* glsl */ `
uniform float uBgDensity;
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
uniform vec3 uBgKeyCol;
uniform vec3 uBgSkyCol;
uniform vec3 uBgShadeCol;
varying vec3 vBgWorld;
// the light on a face whose normal, in the sheet's frame (y = away from the sheet), is n; turn is where the key light
// stands around y, sun how much of it arrives (the ground's shadows)
vec3 bgLight( vec3 n, float turn, float sun ) {
	vec3 l = vec3( cos( turn ) * uBgKey.x, uBgKey.y, sin( turn ) * uBgKey.x );
	return uBgKeyCol * ( max( dot( n, l ), 0.0 ) * sun ) + mix( uBgShadeCol, uBgSkyCol, n.y * 0.5 + 0.5 );
}
vec3 bgAtmosphere( vec3 col ) {
	col = mix( vec3( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) ), col, uBgSat ) * uBgGain + uBgLift * uBgHaze;
	vec3 ray = vBgWorld - cameraPosition;
	float len = max( length( ray ), 1e-4 );
	vec3 dir = ray / len;
	// the haze: one colour, the horizon's in the direction looked in (read from the sky map), thickening with distance alone
	float tau = uBgDensity * len;
	float f = ( 1.0 - exp( - tau * tau ) ) * uBgStrength;
	f = max( f, ( 1.0 - smoothstep( -110.0, -30.0, vBgWorld.y ) ) * uBgSink );
	vec3 haze = mix( uBgHaze, uBgHazeSun, pow( max( dot( dir, uBgSunH ), 0.0 ), 5.0 ) * 0.85 );
#ifdef ENVMAP_TYPE_CUBE_UV
	// (the ray keeps its own height within a degree of the horizon, so the far end of the channel cannot be told from the sky beside it)
	if ( uBgSkyOn > 0.5 ) haze = textureCubeUV( uBgSky, normalize( vec3( dir.x, clamp( dir.y, -0.02, 0.012 ), dir.z ) + vec3( 1e-4, 0.0, 0.0 ) ), 0.0 ).rgb;
#endif
	col = mix( col, haze, clamp( max( f, uBgBase ), 0.0, 1.0 ) );
	// where the sheet ends it dissolves into whatever sky lies behind it, so no edge shows
	float veil = max( bgVeil, uBgVeil );
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
	return max( bgVeil, uBgVeil ) > 0.5 ? vec3( 0.0 ) : c;
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
  } = {},
) {
  Object.assign(shader.uniforms, uniforms, extra.uniforms ?? {});
  const swap = (src: string, marker: string, text: string) => {
    if (!src.includes(marker)) throw new Error(`shader chunk ${marker} not found`);
    return src.replace(marker, text);
  };
  shader.vertexShader = swap(shader.vertexShader, '#include <common>', `#include <common>\nvarying vec3 vBgWorld;\nvarying vec3 vBgNormal;\nvarying float vBgTurn;\nvarying vec3 vBgUp;\n${extra.vertexDecl ?? ''}`);
  shader.vertexShader = swap(
    shader.vertexShader, '#include <beginnormal_vertex>',
    `#include <beginnormal_vertex>\nvBgNormal = objectNormal;\nvBgTurn = 0.0;\nvBgUp = vec3( 0.0, 1.0, 0.0 );\n#ifdef USE_BATCHING\nvBgUp = mat3( batchingMatrix ) * vec3( 0.0, 1.0, 0.0 );\n#endif\n#ifdef USE_BATCHING_COLOR\nvBgTurn = getBatchingColor( getIndirectIndex( gl_DrawID ) ).a * 6.2831853;\n#endif`,
  );
  if (extra.vertexBegin) shader.vertexShader = swap(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>\n${extra.vertexBegin}`);
  shader.vertexShader = swap(shader.vertexShader, '#include <fog_vertex>', `#include <fog_vertex>\nvBgWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );\n${extra.vertexMain ?? ''}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <common>', `#include <common>\n${extra.ground ? '#define BG_GROUND\n' : ''}varying vec3 vBgNormal;\nvarying float vBgTurn;\nfloat bgVeil = 0.0; // set by a material: 1 = this fragment has dissolved into the haze\n${extra.fragmentDecl ?? ''}`);
  // the city's own light replaces the scene's sun, fill and sky light
  shader.fragmentShader = swap(
    shader.fragmentShader, '#include <opaque_fragment>',
    `outgoingLight = diffuseColor.rgb * ( ${extra.light ?? 'bgLight( normalize( vBgNormal ), vBgTurn, 1.0 )'} );\n#include <opaque_fragment>`,
  );
  shader.fragmentShader = swap(shader.fragmentShader, '#include <envmap_physical_pars_fragment>', `#include <envmap_physical_pars_fragment>\n${DECL}`);
  if (extra.fragmentColor) shader.fragmentShader = swap(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>\n${extra.fragmentColor}`);
  if (extra.fragmentRough) shader.fragmentShader = swap(shader.fragmentShader, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${extra.fragmentRough}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <fog_fragment>', `#include <fog_fragment>\ngl_FragColor.rgb = uBgDebug > 0.5 ? bgFacing() : bgAtmosphere( gl_FragColor.rgb );`);
}

/** Hand the scene's sky map to the haze: call from onBeforeRender, every frame (the map arrives after the first frames). */
export function bindSky(uniforms: AtmosphereUniforms, scene: THREE.Scene) {
  const bg = scene.background as THREE.Texture | THREE.Color | null;
  const ok = !!bg && (bg as THREE.Texture).isTexture === true && (bg as THREE.Texture).mapping === THREE.CubeUVReflectionMapping;
  uniforms.uBgSky.value = ok ? (bg as THREE.Texture) : null;
  uniforms.uBgSkyOn.value = ok ? 1 : 0;
}
