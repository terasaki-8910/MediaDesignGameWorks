// The folded city's own haze. The play area keeps look.ts's haze (it thickens below the walkways); the background is not
// "below" anything, it is a world that curls around the player, so its haze is plain distance from the camera and one
// colour, the horizon's (look.ts, hazeColor): near walls stay clear, far parts sink into it. Separately, where the sheet
// ends (the tops of the canyon's walls, the far ends of the channel) it dissolves into the sky behind it, read from the
// same filtered sky map the scene draws as its background, so no edge shows. (Until the sky has loaded, or if it fails,
// the colours of look.ts stand in.) Materials here set `fog: false` and call `bgAtmosphere` last.
import * as THREE from 'three';
import { LOOK } from '../look.ts';
import { PLAY } from './plan.ts';

export interface AtmosphereParams {
  /**
   * The haze with distance: fog = 1 - exp(-(density * d)^power). It thickens with depth instead of lying as one even veil:
   * with 1/560 and the fifth power there is under 1 % on 200 m, 4 % on 300 m, 17 % on 400 m, 43 % on 500 m, 76 % on 600 m
   * and 95 % on 700 m, so
   * the near city keeps its own colours and darks and the far city sinks.
   */
  density: number;
  power: number;
  /**
   * Beyond `tail` metres the haze thickens by the power `tailPower` instead (continuous at `tail`): with 470 m and 2.2 there
   * is 34 % on 470 m, 51 % on 600 m, 63 % on 700 m, 82 % on 900 m and 93 % on 1100 m. The far end of a closed structure is
   * a long gradient, where the fifth power alone ended it in 200 m, as a disc with a rim. Only the closed structures (the
   * channel, the tube) have this tail; the open canyon keeps the fifth power and dissolves into the sky behind it.
   */
  tail?: number;
  tailPower?: number;
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
  /**
   * The floor of the city's darks, as a luminance (linear, scene units): a face darker than this is drawn towards the haze
   * colour at this luminance, and one above it is left as it is (lum' = (lum^knee + toe^knee)^(1/knee), a sharp knee). The tone
   * mapping (Khronos Neutral) squares what lies under 0.08, so 0.078 here is L* 23 on screen and 0.095 is L* 28: deep
   * shade, slate and glass end between the two. Off (0) since round 5: it laid every shaded face on one flat tone; the
   * shade is lit by the sky instead (skyShade..) and the tone mapping's toe undone (untoe). Kept for `?bgtune=` comparisons.
   */
  toe?: number;
  knee?: number;
  /**
   * The fronts lose their windows between `winNear` and `winFar` metres from the play volume (plan.ts, PLAY; the cameras
   * ride inside it): `winKeep` of the way to the tone of each of their rows (soft bands of storeys). The city under the
   * walkways, which the overviews look down on, keeps its windows; the walls the play cameras look along, 120 to 250 m
   * ahead of them, are bands of storeys.
   */
  winNear?: number;
  winFar?: number;
  winKeep?: number;
  /**
   * With distance from the play volume the city's own tones draw together: between `calmNear` and `calmFar` metres a face's colour goes up to
   * `calm` of the way to the city's middle tone in lightness (its colour stays its own), so slate, glass, dormers and
   * stone stand less apart in light and dark on the walls beside the play area than they do under it.
   */
  calm?: number;
  /** The middle tone they draw to, as an albedo (linear): under the stone's, so the far fronts darken a little and the darks stay dark. */
  calmTone?: number;
  calmNear?: number;
  calmFar?: number;
  /** How much the tone of the ground's slabs and setts differs from one to the next, at random (1 = as round 3 had it; 0 since round 5: nothing on the ground is random but the parked cars). */
  slab?: number;
  /** The strength of the paving's whole pattern (ground.ts, bgPaving: courses, slabs and joints; see `band`, `own`, `joint`). */
  pave?: number;
  /** The tone of the whole ground, as a factor on its colours (1 = as painted in ground.ts). */
  ground?: number;
  /** How much of the key light a cast shadow takes from the ground (1 = all of it; the rest stands for the light the fronts throw back into a street). */
  shadow?: number;
  /** The cars parked along the kerbs (ground.ts): 1 = there, 0 = none. */
  cars?: number;
  /** The share of the stretches of a driving lane that hold a car (ground.ts: the traffic between the parked rows). */
  traffic?: number;
  /** The share of the blocks whose courts are gardens (ground.ts: beds between gravel paths); the rest are paved. */
  garden?: number;
  /**
   * The paving (ground.ts, bgPaving), each a factor on what is written there. `band`: how far apart the two stones of its
   * courses lie (1 = as round 5 had them, when the courses alone were the pattern and read as stripes). `own`: how far a
   * slab lies from its course. `joint`: how dark the joints between the slabs are. `setts`: how much of the paving of
   * the parking lanes (setts, relaid patch by patch) the driving lanes show as well.
   */
  band?: number;
  own?: number;
  joint?: number;
  setts?: number;
  /**
   * The share of the paving's pattern, of the traffic and of the gardens that the open canyon shows (the closed channel
   * and tube show all of it). The canyon's walls are what a camera turned sideways sees square-on, as a map; there the
   * ground is kept quiet. The roofs' grain (`grain`) is left out of the canyon altogether.
   */
  canyonPave?: number;
  /**
   * Seen from above, a roof shows its slates, its zinc sheets and its slabs: the atlas's grain on those strips (how far a
   * texel lies from the mean of its row) is drawn this many times stronger again where a building is seen within some
   * 30 degrees of its own upright (`topLo` to `topLo` + 0.12 as a cosine). Seen from the side, as from the play area,
   * the roofs stay as calm as painted.
   */
  grain?: number;
  topLo?: number;
  /**
   * The sky's light (bgLight). `skyLo`: the share of it a face turned into its sheet keeps (a soffit, the underside of a
   * cornice), against 1 for a face turned away from the sheet (a roof); walls lie between. `skyUp`: how much more a face
   * gets that looks up at the world's own sky (on a canyon wall: the sides of the houses that look up the wall).
   * `skyShade` and `skySun`: the sky's strength on a sheet turned away from the world's sun and on one turned to it.
   */
  skyLo?: number;
  skyUp?: number;
  skyShade?: number;
  skySun?: number;
  /**
   * The least of the sky's light the ground keeps in its deepest court (ground.ts: bgOcc is scaled into occ..1), on a sheet
   * turned to the world's sun and (`occShade`) on one turned away from it: streets in shade are the city's real darks.
   */
  occ?: number;
  occShade?: number;
  /** How much of the sky's and the key's light a wall loses at the foot of its street (bgCanyon; 1 = up to 0.5 and 0.58 of them). */
  canyon?: number;
  /**
   * How much of the tone mapping's own toe is undone for the city (0 = none, 1 = all). Khronos Neutral squares what lies
   * under 0.08 (the least of red, green and blue), which takes deep shade to black; undone, the city's darks run on
   * straight to zero (half their scene value), so shade keeps its modelling and nothing is clamped or lifted to a floor.
   */
  untoe?: number;
  /**
   * How far the city's colours go back to the saturation they have in the scene (0 = as the tone mapping shows them, 1 =
   * all the way). Khronos Neutral takes the same amount off red, green and blue (up to 0.04), which leaves a dark colour
   * more saturated than it was: stone in shade turns brown and slate in shade a strong blue. Undone at the same
   * brightness on screen, so only the colour changes: shade is as grey as it is lit.
   */
  chroma?: number;
  /** The share of `calm` that holds everywhere, under the walkways as well (the rest comes with distance from the play volume). */
  calmBase?: number;
  /** The far skyline (skyline.ts): the least and the most haze its masses stand in, nearest to furthest; and how far its fronts go to the tone of their rows (its windows are its texture in the haze). */
  skyHaze?: number;
  skyHazeFar?: number;
  skyWin?: number;
  skyWinFar?: number;
  /** Even under the walkways a front goes this far to the tone of its rows: its windows are there, and soft. */
  winBase?: number;
  /** How far the storeys of a front without windows go to one tone, the front's own (0 = each storey its own mean: bands). */
  rowEven?: number;
  /** How much of each row's own tone a front without windows keeps (the rest is the mean of its storey: rowTone). */
  rowBand?: number;
}

/** The keys `?bgtune=` may set (a debug parameter: `?bgtune=skyShade:1.8,calm:0.3`). */
export const TUNABLE = ['density', 'power', 'tail', 'tailPower', 'strength', 'gain', 'saturation', 'lift', 'base', 'sink', 'toe', 'knee', 'winNear', 'winFar', 'winKeep', 'calm', 'calmTone', 'calmNear', 'calmFar', 'slab', 'cars', 'traffic', 'garden', 'joint', 'setts', 'band', 'own', 'grain', 'canyonPave', 'topLo', 'pave', 'ground', 'shadow', 'skyLo', 'skyUp', 'skyShade', 'skySun', 'occ', 'occShade', 'canyon', 'calmBase', 'untoe', 'chroma', 'skyHaze', 'skyHazeFar', 'skyWin', 'skyWinFar', 'winBase', 'rowBand', 'rowEven'] as const;

/** `?bgtune=key:value,...` as overrides of the city's atmosphere; unknown keys and bad numbers are left out with a warning. */
export function parseTune(text: string | null): Partial<AtmosphereParams> {
  const out: Record<string, number> = {};
  for (const part of (text ?? '').split(',')) {
    if (!part) continue;
    const [key, value] = part.split(':');
    const v = Number(value);
    if (!(TUNABLE as readonly string[]).includes(key) || value === undefined || !Number.isFinite(v)) console.warn(`cannot read ?bgtune=${part} (keys: ${TUNABLE.join(', ')})`);
    else out[key] = v;
  }
  return out as Partial<AtmosphereParams>;
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

/** `?farwin=1`: the fronts go only this share of the way to their rows' tone where the default takes nearly all of it, and the rest some 300 m further from the play volume. */
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
    uBgToe: { value: p.toe ?? 0 },
    uBgKnee: { value: p.knee ?? 4 },
    uBgTail: { value: new THREE.Vector2(p.tail ?? 1e6, p.tailPower ?? 2.2) },
    uBgCalm: { value: new THREE.Vector3(p.calmNear ?? 90, p.calmFar ?? 260, p.calm ?? 0) },
    uBgSlab: { value: p.slab ?? 1 },
    uBgCars: { value: p.cars ?? 1 },
    uBgTraffic: { value: p.traffic ?? 0 },
    uBgGarden: { value: p.garden ?? 0 },
    uBgJoint: { value: p.joint ?? 0 },
    uBgBand: { value: p.band ?? 1 },
    uBgOwn: { value: p.own ?? 1 },
    uBgCanyonPave: { value: p.canyonPave ?? 1 },
    uBgGrain: { value: p.grain ?? 0 },
    uBgTopLo: { value: p.topLo ?? 0.8 },
    uBgSetts: { value: p.setts ?? 0 },
    uBgPave: { value: p.pave ?? 0.06 },
    uBgGround: { value: p.ground ?? 1 },
    uBgShadow: { value: p.shadow ?? 0.94 },
    uBgSkyLobe: { value: new THREE.Vector4(p.skyLo ?? 0.2, p.skyUp ?? 0.5, p.occ ?? 0, p.canyon ?? 1) },
    uBgCalmBase: { value: p.calmBase ?? 0 },
    uBgOccShade: { value: p.occShade ?? p.occ ?? 0 },
    uBgUntoe: { value: p.untoe ?? 0 },
    uBgChroma: { value: p.chroma ?? 0 },
    uBgSkyWin: { value: new THREE.Vector2(p.skyWin ?? 0.45, p.skyWinFar ?? p.skyWin ?? 0.45) },
    uBgWinBase: { value: p.winBase ?? 0 },
    uBgCalmTone: { value: p.calmTone ?? 0.26 },
    uBgSkyHaze: { value: new THREE.Vector2(p.skyHaze ?? 0.5, p.skyHazeFar ?? 0.8) },
    uBgWinK: { value: p.winKeep ?? 0.78 },
    uBgSkyShow: { value: 1 },
    uBgPlayMin: { value: PLAY.min.clone() },
    uBgPlayMax: { value: PLAY.max.clone() },
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
    uBgExpose: { value: new THREE.Vector4(EXPOSE.x, EXPOSE.y, p.skyShade ?? EXPOSE.z, p.skySun ?? EXPOSE.w) },
    uBgFarSky: { value: new THREE.Vector2(0, 1e6) },
    uBgRowTone: { value: null as THREE.Texture | null },
    uBgRowOn: { value: 0 },
    uBgWin: { value: new THREE.Vector4(p.winNear ?? 135, p.winFar ?? 200, 0, 0) },
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
uniform float uBgToe;
uniform float uBgKnee;
uniform vec2 uBgTail;
uniform vec3 uBgCalm;
uniform vec2 uBgSkyHaze;
uniform float uBgWinK;
uniform float uBgSkyShow;
uniform vec2 uBgSkyWin;
uniform float uBgWinBase;
uniform float uBgCalmTone;
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
uniform vec4 uBgSkyLobe;
uniform float uBgCalmBase;
uniform float uBgUntoe;
uniform float uBgChroma;
uniform float uBgGrain;
uniform float uBgTopLo;
uniform vec2 uBgFarSky;
uniform sampler2D uBgRowTone;
uniform float uBgRowOn;
uniform vec4 uBgWin;
uniform vec3 uBgKeyCol;
uniform vec3 uBgSkyCol;
uniform vec3 uBgShadeCol;
// the light on a face whose normal, in the sheet's frame (y = away from the sheet), is n. key = the world's sun in that
// frame: (x, z) its direction along the sheet, y how far the sheet's face is turned to it. up = the world's up in that
// frame. sun = how much of the key arrives (the ground's shadows), sky = how much of the sky's light does (a street
// between its fronts, a court, the foot of a wall see little of the sky: the city's deep shade).
// The sky's light has a shape of its own, so that a wall in shade is modelled by it: all of it on a face turned away from
// the sheet (a roof, the top of a cornice or a sill), about half on a wall, uBgSkyLobe.x of it on a face turned into the
// sheet (a soffit, the underside of an eave: a dark line under every overhang); and more, in the sky's blue, on a face that
// looks up at the world's own sky (uBgSkyLobe.y; only where the sheet is folded up: on the floor the dome is that sky),
// so on a wall of city the sides of a house and the slopes of a roof differ in shade as they do in the sun
vec3 bgLight( vec3 n, vec3 key, vec3 up, float sun, float sky ) {
	vec2 d = normalize( key.xz + vec2( 1e-4, 0.0 ) );
	vec3 l = vec3( d.x * uBgKey.x, uBgKey.y, d.y * uBgKey.x );
	float ex = smoothstep( -0.9, 0.9, key.y );
	float hemi = n.y * 0.5 + 0.5;
	vec3 dome = mix( uBgShadeCol, uBgSkyCol, hemi ) * mix( uBgSkyLobe.x, 1.0, pow( hemi, 0.75 ) ) + uBgSkyCol * ( uBgSkyLobe.y * max( dot( n, up ), 0.0 ) * ( 1.0 - up.y * up.y ) );
	return uBgKeyCol * ( max( dot( n, l ), 0.0 ) * sun * mix( uBgExpose.x, uBgExpose.y, ex ) ) + dome * ( sky * mix( uBgExpose.z, uBgExpose.w, ex ) );
}
// a building's own shade: its walls see less of the sky, and of the key light, the lower they stand in their street;
// roofs see all of both
vec2 bgCanyon( vec3 n, float high ) {
	float wall = 1.0 - smoothstep( 0.2, 0.7, n.y );
	float low = 1.0 - smoothstep( 0.0, 26.0, high );
	return vec2( 1.0 - 0.5 * uBgSkyLobe.w * wall * low, 1.0 - 0.58 * uBgSkyLobe.w * wall * low );
}
// how far a thing at this distance, which the haze has all but taken, has gone on into the sky behind it (0 to 1). Only
// where the sky is behind it: all of the open canyon (uBgFarSky.x = 1), and what stands above the ceiling of the channel
// (uBgFarSky.y, the walls of its slot). Under a ceiling the far end stays haze (the caps of morphcity.ts close it).
// the haze's depth over a distance: the fifth power out to uBgTail.x metres and, in the closed structures, a gentler power
// (uBgTail.y) beyond, so the far end of a channel or a tube goes into the haze over several hundred metres and has no rim.
// The open canyon (uBgFarSky.x = 1) keeps the fifth power all the way: its far end goes on into the sky (bgFar)
float bgTau( float len ) {
	float d = min( len, uBgTail.x );
	return pow( uBgDensity * d, uBgPower ) * pow( max( len / uBgTail.x, 1.0 ), mix( uBgTail.y, uBgPower, uBgFarSky.x ) );
}
float bgFar( float len ) {
	if ( bgSkyline > 0.0 ) return 0.0;
	// (a building is taken whole, by the distance of its foot: bgFarLen; a block of ground by its own shift)
	len = max( ( bgFarLen > 0.0 ? bgFarLen : len ) + bgFarShift, 0.0 );
	return smoothstep( 0.80, 0.985, 1.0 - exp( - bgTau( len ) ) ) * max( uBgFarSky.x, smoothstep( uBgFarSky.y, uBgFarSky.y + 40.0, vBgWorld.y ) );
}
vec3 bgAtmosphere( vec3 col ) {
	col = mix( vec3( dot( col, vec3( 0.2126, 0.7152, 0.0722 ) ) ), col, uBgSat ) * uBgGain + uBgLift * uBgHaze;
	// the toe: what is darker than uBgToe goes towards the haze colour at that luminance (deep shade, slate, glass: dark, never black)
	float bgLum = dot( col, vec3( 0.2126, 0.7152, 0.0722 ) );
	col += uBgHaze * ( ( pow( pow( max( bgLum, 1e-5 ), uBgKnee ) + pow( max( uBgToe, 1e-5 ), uBgKnee ), 1.0 / uBgKnee ) - bgLum ) / dot( uBgHaze, vec3( 0.2126, 0.7152, 0.0722 ) ) );
	vec3 ray = vBgWorld - cameraPosition;
	float len = max( length( ray ), 1e-4 );
	vec3 dir = ray / len;
	// the haze: one colour, the horizon's in the direction looked in (read from the sky map), thickening with distance alone
	float tau = bgTau( len );
	// (roofs and towers stand in thinner haze, but only this side of where the haze takes everything: nothing is left standing
	// alone in the sky when the ground under it has gone)
	float thin = mix( bgThin, 1.0, smoothstep( 220.0, 380.0, len ) );
	float f = ( 1.0 - exp( - tau * thin ) ) * uBgStrength;
	f = max( f, ( 1.0 - smoothstep( -110.0, -30.0, vBgWorld.y ) ) * uBgSink );
	// the far skyline stands in a haze of its own: layer behind layer, each paler, none gone (bgSkyline = 1 nearest to 2 furthest)
	// (and all of them lose their feet in it; uBgSkyShow takes them away as the canyon closes)
	if ( bgSkyline > 0.0 ) f = mix( 1.0, mix( uBgSkyHaze.x, uBgSkyHaze.y, pow( clamp( bgSkyline - 1.0, 0.0, 1.0 ), 2.0 ) ), smoothstep( 3.0, 40.0, vBgHigh ) * uBgSkyShow );
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
	bgSkyMix = clamp( veil, 0.0, 1.0 );
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
// the tone mapping (Khronos Neutral, in post) takes x - 6.25 x^2 off every channel where x, the least of the three, is
// under 0.08: it squares the darks. Adding sqrt( 0.08 x ) - x beforehand leaves the least channel at half its value
// instead, straight down to zero and continuous at 0.08 (AtmosphereParams.untoe)
// And the saturation (AtmosphereParams.chroma): taking one amount off all three channels leaves a dark colour more
// saturated than the scene's. t is what the tone mapping will show of the colour; it is drawn towards its own grey until
// it is the scene's colour at the shown brightness (col * Y(t) / Y(col)), and the amount the tone mapping will take off
// is put back on. Brightness on screen stays what it was. Not where the city has gone into the sky (bgSkyMix): there it
// has to be the sky's own colour.
vec3 bgUntoe( vec3 col ) {
	float m = max( min( col.r, min( col.g, col.b ) ), 0.0 );
	vec3 x = m < 0.08 ? col + uBgUntoe * ( sqrt( 0.08 * m ) - m ) : col;
	float k = uBgChroma * ( 1.0 - bgSkyMix );
	if ( k <= 0.0 ) return x;
	const vec3 W = vec3( 0.2126, 0.7152, 0.0722 );
	float xm = max( min( x.r, min( x.g, x.b ) ), 0.0 );
	vec3 t = x - ( xm < 0.08 ? xm - 6.25 * xm * xm : 0.04 );
	float yt = dot( t, W );
	t = mix( vec3( yt ), t, mix( 1.0, clamp( yt / max( dot( col, W ), 1e-5 ), 0.0, 1.0 ), k ) );
	float tm = max( min( t.r, min( t.g, t.b ) ), 0.0 );
	return t + ( ( tm < 0.04 ? sqrt( tm / 6.25 ) : tm + 0.04 ) - tm );
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
	if ( bgSkyline > 0.0 && smoothstep( 3.0, 40.0, vBgHigh ) * uBgSkyShow < 0.08 ) return vec3( 0.0 ); // the skyline's feet, gone into the haze
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
  shader.vertexShader = swap(shader.vertexShader, '#include <common>', `#include <common>\nvarying vec3 vBgWorld;\nvarying vec3 vBgNormal;\nvarying vec3 vBgKeyDir;\nvarying vec3 vBgSkyUp;\nvarying float vBgHigh;\nvarying float vBgTint;\nvarying vec3 vBgUp;\nvarying vec4 vBgFoot;\nuniform vec3 uBgSun;\n${extra.vertexDecl ?? ''}`);
  shader.vertexShader = swap(
    shader.vertexShader, '#include <beginnormal_vertex>',
    `#include <beginnormal_vertex>\nvBgNormal = objectNormal;\nvBgKeyDir = uBgSun;\nvBgSkyUp = vec3( 0.0, 1.0, 0.0 );\nvBgTint = 1.0;\nvBgHigh = 0.0;\nvBgUp = vec3( 0.0, 1.0, 0.0 );\nvBgFoot = vec4( 0.0 );\n#ifdef USE_BATCHING\nmat3 bgM = mat3( batchingMatrix );\nvBgFoot = vec4( batchingMatrix[ 3 ].xyz, 1.0 );\n#ifdef USE_BATCHING_COLOR\nvec4 bgTint = getBatchingColor( getIndirectIndex( gl_DrawID ) );\nvBgFoot.w = 1.0 + bgTint.a;\nvBgTint = dot( bgTint.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ) / 0.94;\n#endif\nvBgUp = bgM[ 1 ];\nvBgKeyDir = vec3( dot( uBgSun, normalize( bgM[ 0 ] ) ), dot( uBgSun, normalize( bgM[ 1 ] ) ), dot( uBgSun, normalize( bgM[ 2 ] ) ) );\nvBgSkyUp = vec3( normalize( bgM[ 0 ] ).y, normalize( bgM[ 1 ] ).y, normalize( bgM[ 2 ] ).y );\nvBgHigh = position.y * length( bgM[ 1 ] );\n#endif`,
  );
  if (extra.vertexBegin) shader.vertexShader = swap(shader.vertexShader, '#include <begin_vertex>', `#include <begin_vertex>\n${extra.vertexBegin}`);
  shader.vertexShader = swap(shader.vertexShader, '#include <fog_vertex>', `#include <fog_vertex>\nvBgWorld = cameraPosition + mvPosition.xyz * mat3( viewMatrix );\n${extra.vertexMain ?? ''}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <common>', `#include <common>\n${extra.ground ? '#define BG_GROUND\n' : ''}varying vec3 vBgWorld;\nvarying vec3 vBgNormal;\nvarying vec3 vBgKeyDir;\nvarying vec3 vBgSkyUp;\nvarying float vBgHigh;\nvarying float vBgTint;\nvarying vec4 vBgFoot;\nfloat bgFarLen = -1.0; // set by a material: the distance bgFar goes by, instead of the fragment's own\nfloat bgFarShift = 0.0; // and metres added to it (a block's own)\nfloat bgVeil = 0.0; // set by a material: 1 = this fragment has dissolved into the haze\nvec3 bgHazeCol = vec3( 0.0 ); // set by bgAtmosphere: the haze's colour along this ray, and how much of it lies on the fragment
float bgFog = 0.0;
float bgSkyMix = 0.0; // set by bgAtmosphere: how far the fragment has gone on into the sky behind it
float bgThin = 1.0; // the haze's depth here, as a share: roofs and towers stand in thinner haze than the streets
float bgSkyline = 0.0; // set for a mass of the far skyline (skyline.ts): 1 = its nearest layer to 2 = its furthest
uniform vec3 uBgPlayMin;
uniform vec3 uBgPlayMax;
// metres from the play volume (0 inside it): the fronts' windows and the city's contrasts fade by this, not by the camera's distance
float bgPlayDist() { return length( max( max( uBgPlayMin - vBgWorld, vBgWorld - uBgPlayMax ), 0.0 ) ); }\n${extra.fragmentDecl ?? ''}`);
  // the city's own light replaces the scene's sun, fill and sky light
  shader.fragmentShader = swap(
    shader.fragmentShader, '#include <opaque_fragment>',
    `bgThin = mix( 1.0, 0.6, smoothstep( 14.0, 60.0, vBgHigh ) );\nif ( vBgFoot.w > 2.5 ) bgSkyline = vBgFoot.w - 2.0;\nelse if ( vBgFoot.w > 0.5 ) { bgFarLen = length( vBgFoot.xyz - cameraPosition ); bgFarShift = ( vBgFoot.w - 1.5 ) * ${FAR_JITTER.toFixed(1)}; }\noutgoingLight = diffuseColor.rgb * ( ${extra.light ?? 'bgLight( normalize( vBgNormal ), vBgKeyDir, normalize( vBgSkyUp ), bgCanyon( normalize( vBgNormal ), vBgHigh ).x, bgCanyon( normalize( vBgNormal ), vBgHigh ).y )'} );\n#include <opaque_fragment>`,
  );
  shader.fragmentShader = swap(shader.fragmentShader, '#include <envmap_physical_pars_fragment>', `#include <envmap_physical_pars_fragment>\n${DECL}`);
  // fronts away from the play volume lose their windows (AtmosphereParams.winNear..): there a front is the mean tone of each
  // of its rows (soft horizontal bands of storeys and cornices), read from a one-pixel-wide copy of the atlas; under the
  // walkways it is the atlas itself, uBgWinBase of the way to those tones. `?farwin=1` (FAR_WINDOWS) keeps the windows
  // further out at reduced contrast: uBgWin.z of the way to the rows' tone, the rest between uBgWin.x + 265 and + 385 m.
  // The far skyline keeps part of its windows (uBgSkyWin): they are its only texture in the haze
  if (shader.fragmentShader.includes('#include <map_fragment>'))
    shader.fragmentShader = shader.fragmentShader.replace(
      '#include <map_fragment>',
      `#ifdef USE_MAP
	vec4 sampledDiffuseColor = texture2D( map, vMapUv );
	// (only the strips that hold windows, rows 96 to 456 of the atlas from its foot: slate, zinc, ashlar and glazing keep their grain)
	if ( uBgRowOn > 0.5 && vMapUv.y > 0.1094 && vMapUv.y < 0.8125 ) sampledDiffuseColor.rgb = mix( sampledDiffuseColor.rgb, textureLod( uBgRowTone, vec2( 0.5, vMapUv.y ), 0.0 ).rgb, vBgFoot.w > 2.5 ? mix( uBgSkyWin.x, uBgSkyWin.y, clamp( vBgFoot.w - 3.0, 0.0, 1.0 ) ) : mix( uBgWinBase, mix( uBgWinK, uBgWin.z, uBgWin.w ), smoothstep( uBgWin.x, uBgWin.y, bgPlayDist() ) ) + uBgWin.w * ( uBgWinK - uBgWin.z ) * smoothstep( uBgWin.x + 265.0, uBgWin.x + 385.0, bgPlayDist() ) );
	// seen from above a roof shows its grain (AtmosphereParams.grain): slate and the mansard above row 368, zinc in rows 64
	// to 80, and a third of it on the ashlar below (the slabs of a terrace); not the strips of storeys, not the far skyline
	if ( uBgRowOn > 0.5 && uBgGrain != 0.0 && vBgFoot.w < 2.5 && ( vMapUv.y < 0.1563 || vMapUv.y > 0.7188 ) ) {
		float bgTopView = smoothstep( uBgTopLo, uBgTopLo + 0.12, abs( dot( normalize( vBgWorld - cameraPosition ), normalize( vBgUp ) ) ) ) * ( 1.0 - uBgFarSky.x );
		// (in lightness only: a texel keeps its colour and goes further from its row's tone, to between 0.45 and 1.8 times its own)
		float bgRowL = dot( textureLod( uBgRowTone, vec2( 0.5, vMapUv.y ), 0.0 ).rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
		float bgTexL = max( dot( sampledDiffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 );
		sampledDiffuseColor.rgb *= clamp( 1.0 + ( 1.0 - bgRowL / bgTexL ) * uBgGrain * bgTopView * ( vMapUv.y < 0.125 ? 0.35 : 1.0 ), 0.45, 1.8 );
	}
	diffuseColor *= sampledDiffuseColor;
#endif`,
    );
  // with distance from the play volume the buildings' tones draw together (AtmosphereParams.calm): in lightness only, and
  // each to the tone of its own house (the instance's tint: one block of houses paler, the next darker), so
  // stone stays warm and slate blue-grey out to where the haze takes them; the ground keeps its own tones, and so does the
  // far skyline (it has its haze)
  if (extra.fragmentColor) shader.fragmentShader = swap(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>\n${extra.fragmentColor}`);
  else
    shader.fragmentShader = swap(shader.fragmentShader, '#include <color_fragment>', `#include <color_fragment>
diffuseColor.rgb *= mix( 1.0, uBgCalmTone * vBgTint / max( dot( diffuseColor.rgb, vec3( 0.2126, 0.7152, 0.0722 ) ), 1e-3 ), vBgFoot.w > 2.5 ? 0.0 : uBgCalm.z * mix( uBgCalmBase, 1.0, smoothstep( uBgCalm.x, uBgCalm.y, bgPlayDist() ) ) );`);
  if (extra.fragmentRough) shader.fragmentShader = swap(shader.fragmentShader, '#include <roughnessmap_fragment>', `#include <roughnessmap_fragment>\n${extra.fragmentRough}`);
  shader.fragmentShader = swap(shader.fragmentShader, '#include <fog_fragment>', `#include <fog_fragment>\ngl_FragColor.rgb = uBgDebug > 0.5 ? bgFacing() : bgUntoe( bgAtmosphere( gl_FragColor.rgb ) );
${extra.fragmentEnd ?? ''}`);
}

/**
 * The mean colour of every row of the facade atlas, as a texture one pixel wide: what a front looks like from too far to
 * tell its windows (patchShader). Null when the image cannot be read.
 */
export function rowTone(map: THREE.Texture, band = 0.25, even = 0): THREE.DataTexture | null {
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
  // smoothed and drawn most of the way (1 - band) to the strip's mean: soft bands of storeys, not the stripes of a blind
  const STRIPS = [0, 16, 64, 80, 96, 208, 288, 368, 456, 512];
  const k = h / 512;
  // (the three strips of storeys with windows, rows 96 to 368: `even` draws their means to the mean of all three)
  const front = [0, 0, 0];
  {
    const y0 = h - Math.round(368 * k);
    const y1 = h - Math.round(96 * k);
    for (let y = y0; y < y1; y++) for (let c = 0; c < 3; c++) front[c] += rows[y * 3 + c] / (y1 - y0);
  }
  for (let s = 0; s + 1 < STRIPS.length; s++) {
    const y1 = h - Math.round(STRIPS[s] * k); // image rows run from the top
    const y0 = h - Math.round(STRIPS[s + 1] * k);
    const mean = [0, 0, 0];
    for (let y = y0; y < y1; y++) for (let c = 0; c < 3; c++) mean[c] += rows[y * 3 + c] / (y1 - y0);
    if (STRIPS[s] >= 96 && STRIPS[s + 1] <= 368) for (let c = 0; c < 3; c++) mean[c] += (front[c] - mean[c]) * even;
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
        out[y * 4 + c] = Math.round(enc(band * (sum / w) + (1 - band) * mean[c]) * 255);
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
