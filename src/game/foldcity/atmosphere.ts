// The folded city's own haze. The play area keeps look.ts's haze (it thickens below the walkways); the background is not
// "below" anything, it is a world that bends around the player, so its haze is plain distance from the camera, and what
// things fade into is the sky itself: the haze colour along a ray is read from the same filtered sky map the scene draws
// as its background, so the far end of a sheet disappears into the sky instead of showing as an edge. (Until the sky has
// loaded, or if it fails, the colours of look.ts stand in.) Materials here set `fog: false` and call `bgAtmosphere` last.
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
  /** How much deeper below the walkways (from about 30 m down to 110 m) the haze gets, as a share of full haze: the piers' feet sink into it. */
  sink: number;
}

export type AtmosphereUniforms = Record<string, THREE.IUniform>;

export function atmosphereUniforms(p: AtmosphereParams): AtmosphereUniforms {
  const sunH = new THREE.Vector3(LOOK.sunDir.x, 0, LOOK.sunDir.z).normalize();
  return {
    uBgDensity: { value: p.density },
    uBgStrength: { value: p.strength },
    uBgGain: { value: p.gain },
    uBgSat: { value: p.saturation },
    uBgLift: { value: p.lift },
    uBgSink: { value: p.sink },
    uBgHaze: { value: LOOK.hazeColor.clone() },
    uBgHazeSun: { value: LOOK.hazeSunColor.clone() },
    uBgHazeDeep: { value: LOOK.hazeDeepColor.clone() },
    uBgSkyAnti: { value: LOOK.skyAnti.clone() },
    uBgSkySide: { value: LOOK.skySide.clone() },
    uBgSkySun: { value: LOOK.skySun.clone() },
    uBgSunH: { value: sunH },
    uBgSky: { value: null as THREE.Texture | null },
    uBgSkyOn: { value: 0 },
  };
}

const DECL = /* glsl */ `
uniform float uBgDensity;
uniform float uBgStrength;
uniform float uBgGain;
uniform float uBgSat;
uniform float uBgLift;
uniform float uBgSink;
uniform vec3 uBgHaze;
uniform vec3 uBgHazeSun;
uniform vec3 uBgHazeDeep;
uniform vec3 uBgSkyAnti;
uniform vec3 uBgSkySide;
uniform vec3 uBgSkySun;
uniform vec3 uBgSunH;
uniform sampler2D uBgSky;
uniform float uBgSkyOn;
varying vec3 vBgWorld;
vec3 bgAtmosphere( vec3 col ) {
	col = mix( vec3( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) ), col, uBgSat ) * uBgGain + uBgLift * uBgHaze;
	vec3 ray = vBgWorld - cameraPosition;
	float len = max( length( ray ), 1e-4 );
	vec3 dir = ray / len;
	float tau = uBgDensity * len;
	float f = ( 1.0 - exp( - tau * tau ) ) * uBgStrength;
	f = max( f, ( 1.0 - smoothstep( -110.0, -30.0, vBgWorld.y ) ) * uBgSink );
	vec3 hazeCol = mix( uBgHaze, uBgHazeSun, pow( max( dot( dir, uBgSunH ), 0.0 ), 5.0 ) * 0.85 );
	hazeCol = mix( hazeCol, uBgHazeDeep, smoothstep( 0.03, 0.5, - dir.y ) );
	float aim = dot( normalize( vec3( dir.x, 0.0, dir.z ) + vec3( 1e-4, 0.0, 0.0 ) ), uBgSunH );
	vec3 blue = aim < 0.0 ? mix( uBgSkyAnti, uBgSkySide, aim + 1.0 ) : mix( uBgSkySide, uBgSkySun, aim );
	blue = mix( blue, vec3( dot( blue, vec3( 0.2126, 0.7152, 0.0722 ) ) ), 0.4 ) * vec3( 1.07, 1.0, 0.93 );
	hazeCol = mix( hazeCol, blue, 0.85 * smoothstep( -0.01, 0.16, dir.y ) );
#ifdef ENVMAP_TYPE_CUBE_UV
	if ( uBgSkyOn > 0.5 ) hazeCol = textureCubeUV( uBgSky, dir, 0.0 ).rgb;
#endif
	return mix( col, hazeCol, clamp( f, 0.0, 1.0 ) );
}
`;

/**
 * Patch a MeshStandardMaterial's shader: the world position as a varying, the haze function, and the call at the end.
 * `vertexDecl`/`vertexMain` and `fragmentDecl` let the caller add its own pieces (the ground's sheet coordinates).
 */
export function patchShader(
  shader: { vertexShader: string; fragmentShader: string; uniforms: Record<string, THREE.IUniform> },
  uniforms: AtmosphereUniforms,
  extra: { vertexDecl?: string; vertexMain?: string; fragmentDecl?: string; fragmentColor?: string; fragmentRough?: string; uniforms?: Record<string, THREE.IUniform> } = {},
) {
  Object.assign(shader.uniforms, uniforms, extra.uniforms ?? {});
  const swap = (src: string, marker: string, text: string) => {
    if (!src.includes(marker)) throw new Error(`shader chunk ${marker} not found`);
    return src.replace(marker, text);
  };
  shader.vertexShader = swap(shader.vertexShader, '#include <common>', `#include <common>\nvarying vec3 vBgWorld;\n${extra.vertexDecl ?? ''}`);
  shader.vertexShader = swap(shader.vertexShader, '#include <fog_vertex>', `#include <fog_vertex>\nvBgWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );\n${extra.vertexMain ?? ''}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <common>', `#include <common>\n${extra.fragmentDecl ?? ''}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <envmap_physical_pars_fragment>', `#include <envmap_physical_pars_fragment>\n${DECL}`);
  if (extra.fragmentColor) shader.fragmentShader = swap(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>\n${extra.fragmentColor}`);
  if (extra.fragmentRough) shader.fragmentShader = swap(shader.fragmentShader, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${extra.fragmentRough}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <fog_fragment>', `#include <fog_fragment>\ngl_FragColor.rgb = bgAtmosphere( gl_FragColor.rgb );`);
}

/** Hand the scene's sky map to the haze: call from onBeforeRender, every frame (the map arrives after the first frames). */
export function bindSky(uniforms: AtmosphereUniforms, scene: THREE.Scene) {
  const bg = scene.background as THREE.Texture | THREE.Color | null;
  const ok = !!bg && (bg as THREE.Texture).isTexture === true && (bg as THREE.Texture).mapping === THREE.CubeUVReflectionMapping;
  uniforms.uBgSky.value = ok ? (bg as THREE.Texture) : null;
  uniforms.uBgSkyOn.value = ok ? 1 : 0;
}
