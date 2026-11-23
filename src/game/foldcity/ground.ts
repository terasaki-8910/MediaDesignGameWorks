// The ground of the sheet: one continuous mesh following the surface, streets, pavements, courtyards, plazas and parks
// drawn in the fragment shader from the street lattice (two tiny data textures), so the pattern is crisp at any scale
// and costs no texture memory worth counting. Streets cross creases because the pattern lives in sheet coordinates.
import * as THREE from 'three';
import { KEY_ALONG, patchShader, type AtmosphereUniforms } from './atmosphere.ts';
import { BLOCK_LANDMARK, SIDEWALK, type Lattice } from './layout.ts';
import { A0, A1, B1, BEND, GROUND_Y, PROFILE_SAMPLES, PROFILE_STEP, SEAM, sheetGrid, TWIST_FADE, W0, Z0, type SheetState } from './sheet.ts';
import { breaks, frameAt, makeFrame, type Surface } from './surfaces.ts';

const GLSL_DECL = /* glsl */ `
uniform sampler2D uLines;
uniform sampler2D uCells;
uniform vec2 uCount;
uniform vec3 uStreet;
uniform vec3 uWalk;
uniform vec3 uYard;
uniform vec3 uPlaza;
uniform vec3 uPlazaB;
uniform vec3 uPark;
uniform vec3 uPath;
uniform vec3 uMark;
uniform vec3 uUnder;
uniform vec4 uSheetBox;
uniform vec3 uSheetShow;
uniform vec2 uKeyAlong;
varying float vTwist;
varying vec2 vSheet;
float bgRough = 0.92;
// how much of the key light reaches this point of the ground (the buildings' shadows)
float bgSun = 1.0;

float h21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
float vn( vec2 p ) {
	vec2 i = floor( p ); vec2 f = fract( p ); f = f * f * ( 3.0 - 2.0 * f );
	return mix( mix( h21( i ), h21( i + vec2( 1.0, 0.0 ) ), f.x ), mix( h21( i + vec2( 0.0, 1.0 ) ), h21( i + vec2( 1.0, 1.0 ) ), f.x ), f.y );
}
int findLine( float s, int row, int n ) {
	int lo = 0;
	int hi = n - 2;
	for ( int k = 0; k < 12; k ++ ) {
		if ( lo >= hi ) break;
		int mid = ( lo + hi + 1 ) / 2;
		if ( texelFetch( uLines, ivec2( mid, row ), 0 ).x <= s ) lo = mid; else hi = mid - 1;
	}
	return lo;
}
// 1 inside, 0 outside, soft over one pixel
float inside( float d, float aa ) { return smoothstep( - aa, aa, d ); }
// joints of a tile grid: 1 on a joint
float joints( vec2 s, float tile, float w, float aa ) {
	vec2 q = abs( fract( s / tile + 0.5 ) - 0.5 ) * tile;
	float j = 1.0 - min( smoothstep( w - aa, w + aa, q.x ), smoothstep( w - aa, w + aa, q.y ) );
	return j * ( 1.0 - smoothstep( 0.25, 0.8, aa / tile ) );
}

// the ends of the shared sheet: far ends dissolve into the haze, the ring's tail is not drawn
void bgEnds( vec2 s ) {
	if ( uSheetShow.z < 0.5 ) return;
	if ( uSheetShow.y > 0.5 && s.x < uSheetBox.w ) discard;
	float v = max( 1.0 - smoothstep( 20.0, 240.0, s.x - uSheetBox.x ), 1.0 - smoothstep( 20.0, 240.0, uSheetBox.z - abs( s.y ) ) );
	v = max( v, smoothstep( ${TWIST_FADE[0].toFixed(2)}, ${TWIST_FADE[1].toFixed(2)}, vTwist ) );
	bgVeil = max( v, uSheetShow.x * ( 1.0 - smoothstep( 20.0, 280.0, uSheetBox.y - s.x ) ) );
}
// the back of the sheet: the city's foundations, a grid of deep vaults between ribs of stone under the streets
vec3 bgUnder( vec2 s ) {
	vec2 aw = fwidth( s );
	float aa = max( max( aw.x, aw.y ), 1e-3 );
	vec2 q = abs( fract( s / 24.0 ) - 0.5 ) * 24.0;
	float rib = 1.0 - smoothstep( 9.0 - aa, 9.6 + aa, max( q.x, q.y ) );
	float depth = smoothstep( 0.0, 9.0, max( q.x, q.y ) );
	float n = 0.5 * vn( s * 0.9 ) + 0.5 * vn( s * 0.11 );
	vec3 vault = uUnder * mix( 0.42, 0.95, depth * depth ) * ( 0.85 + 0.3 * n );
	return mix( uUnder * 1.35 * ( 0.9 + 0.2 * n ), vault, rib * ( 1.0 - smoothstep( 0.3, 1.2, aa / 12.0 ) ) );
}

// 1 when the way from p towards the key light is blocked, within reach, by the buildings of the block lo..hi
float bgCast( vec2 p, vec2 lo, vec2 hi, float reach ) {
	vec2 t0 = ( lo - p ) / uKeyAlong;
	vec2 t1 = ( hi - p ) / uKeyAlong;
	vec2 tn = min( t0, t1 );
	vec2 tf = max( t0, t1 );
	float a = max( max( tn.x, tn.y ), 0.0 );
	float b = min( tf.x, tf.y );
	if ( b <= a ) return 0.0;
	return 1.0 - smoothstep( reach * 0.7, reach, a );
}
bool bgBuilt( int i, int j ) {
	if ( i < 0 || j < 0 || i > int( uCount.x ) - 2 || j > int( uCount.y ) - 2 ) return false;
	float t = floor( texelFetch( uCells, ivec2( i, j ), 0 ).r * 255.0 + 0.5 );
	return t < 0.5 || t > 2.5;
}
// the built part of the block between lines a..b and c..d: inside its pavement
float bgBlockCast( vec2 p, vec4 a, vec4 b, vec4 c, vec4 d ) {
	const float inset = ${(SIDEWALK + 0.6).toFixed(1)};
	return bgCast( p, vec2( a.x + a.y + inset, c.x + c.y + inset ), vec2( b.x - b.y - inset, d.x - d.y - inset ), 30.0 );
}

vec3 bgGround( vec2 s ) {
	vec2 aw = fwidth( s );
	float aa = max( max( aw.x, aw.y ), 1e-3 );
	int iu = findLine( s.x, 0, int( uCount.x ) );
	int iv = findLine( s.y, 1, int( uCount.y ) );
	vec4 la = texelFetch( uLines, ivec2( iu, 0 ), 0 );
	vec4 lb = texelFetch( uLines, ivec2( iu + 1, 0 ), 0 );
	vec4 lc = texelFetch( uLines, ivec2( iv, 1 ), 0 );
	vec4 ld = texelFetch( uLines, ivec2( iv + 1, 1 ), 0 );
	vec4 cell = texelFetch( uCells, ivec2( iu, iv ), 0 );
	float type = floor( cell.r * 255.0 + 0.5 );
	float rnd = cell.g;
	// how far inside the block, from each of its four street edges
	float e0 = s.x - ( la.x + la.y );
	float e1 = ( lb.x - lb.y ) - s.x;
	float e2 = s.y - ( lc.x + lc.y );
	float e3 = ( ld.x - ld.y ) - s.y;
	float eu = min( e0, e1 );
	float ev = min( e2, e3 );
	float e = min( eu, ev );
	float big = 0.5 * ( vn( s * 0.021 ) + vn( s * 0.07 + 7.0 ) );
	float fine = 0.5 * vn( s * 1.3 ) + 0.3 * vn( s * 4.1 + 3.0 ) + 0.2 * vn( s * 11.0 );
	float tone = 0.88 + 0.22 * rnd + 0.3 * ( big - 0.5 );

	// the street
	vec3 street = uStreet * ( 0.86 + 0.3 * fine ) * ( 0.9 + 0.2 * big );
	bool inU = eu < 0.0;
	bool inV = ev < 0.0;
	float mark = 0.0;
	float median = 0.0;
	if ( inU != inV ) {
		bool alongV = inU; // a street between two u lines runs along v
		vec4 L = alongV ? ( e0 < e1 ? la : lb ) : ( e2 < e3 ? lc : ld );
		float lat = abs( ( alongV ? s.x : s.y ) - L.x );
		float along = alongV ? s.y : s.x;
		float edge = alongV ? ev : eu; // distance from the junction
		float dash = step( fract( along / 8.0 ), 0.55 );
		if ( L.z > 0.5 ) {
			mark += ( 1.0 - smoothstep( 0.1 - aa, 0.1 + aa, abs( lat - L.y * 0.5 ) ) ) * dash * 0.5; // lane dashes
			float z = step( 0.5, fract( ( alongV ? s.x : s.y ) / 1.7 ) ) * inside( edge - 0.6, aa ) * ( 1.0 - inside( edge - 4.2, aa ) );
			mark += z * 0.55;
			// a boulevard (the wide avenue on a crease) has a planted strip down its middle, between two kerbs
			if ( L.y > 15.0 ) median = 1.0 - inside( lat - 3.2, aa );
		}
		mark *= 1.0 - smoothstep( 0.2, 0.7, aa );
	}
	// setts: courses across the street, only seen close
	street *= 1.0 - 0.12 * joints( s, 0.9, 0.05, aa );
	street = mix( street, uMark, clamp( mark, 0.0, 1.0 ) * 0.5 );
	vec3 bed = mix( uPark * 0.8, uPath * 0.8, smoothstep( 0.45, 0.65, vn( s * 0.35 ) ) ) * ( 0.85 + 0.3 * fine );
	street = mix( street, bed, median );
	// the gutter along the kerb
	street *= 1.0 - 0.3 * ( 1.0 - smoothstep( 0.0, 0.7, - e ) );

	// the pavement along the block edge, with its kerb and joints
	vec3 walk = uWalk * ( 0.92 + 0.16 * fine ) * ( 0.92 + 0.16 * big );
	walk *= 1.0 - 0.12 * joints( s, 1.8, 0.05, aa );
	walk *= 1.0 + 0.14 * ( 1.0 - smoothstep( 0.25, 0.4 + aa, e ) ); // the kerb: a band of pale stone at the street's edge
	bgRough = 0.85;

	// the block
	vec3 yard = uYard * tone * ( 0.85 + 0.2 * fine );
	yard *= 1.0 - 0.07 * joints( s, 5.5, 0.07, aa );
	vec3 inner = yard;
	if ( type > 0.5 && type < 1.5 ) {
		// plaza: paving all the way to the street, bands of light and dark stone, a ring of stone round the middle
		vec2 c = vec2( 0.5 * ( la.x + la.y + lb.x - lb.y ), 0.5 * ( lc.x + lc.y + ld.x - ld.y ) );
		vec2 p = s - c;
		vec2 hs = vec2( 0.5 * ( lb.x - lb.y - la.x - la.y ), 0.5 * ( ld.x - ld.y - lc.x - lc.y ) );
		float rr = length( p );
		float m = min( hs.x, hs.y );
		// paving laid in rings round the fountain or the monument, a dark band at two radii, rays between them
		float band = ( 1.0 - smoothstep( 0.5 - aa, 0.5 + aa, abs( rr - 13.0 ) ) ) + ( 1.0 - smoothstep( 0.7 - aa, 0.7 + aa, abs( rr - m * 0.78 ) ) );
		float ang = atan( p.y, p.x );
		float ray = ( 1.0 - smoothstep( 0.35, 0.35 + aa, abs( fract( ang * 2.546479 ) - 0.5 ) * rr * 0.39 ) ) * step( 13.0, rr ) * step( rr, m * 0.78 );
		float rings = 0.5 + 0.5 * sin( rr * 2.4 );
		inner = mix( uPlaza, uPlazaB, clamp( band + ray * 0.8, 0.0, 1.0 ) * 0.55 + 0.1 * rings * ( 1.0 - smoothstep( 0.3, 0.9, aa ) ) );
		inner *= ( 0.9 + 0.16 * fine ) * ( 0.94 + 0.1 * rnd );
		float rim = min( hs.x - abs( p.x ), hs.y - abs( p.y ) );
		inner *= 1.0 + 0.1 * ( 1.0 - smoothstep( 0.25, 0.4 + aa, rim ) );
	} else if ( type > 1.5 && type < 2.5 ) {
		// park: lawn with a winding path and a darker rim of hedge
		vec2 c = vec2( 0.5 * ( la.x + la.y + lb.x - lb.y ), 0.5 * ( lc.x + lc.y + ld.x - ld.y ) );
		vec2 p = s - c;
		vec3 lawn = uPark * ( 0.8 + 0.4 * fine ) * ( 0.9 + 0.2 * big );
		float trees = smoothstep( 0.55, 0.75, vn( s * 0.22 + rnd * 40.0 ) );
		lawn *= 1.0 - 0.28 * trees;
		float wind = abs( p.y - 7.0 * sin( p.x * 0.11 + rnd * 6.0 ) ) - 1.4;
		float path = 1.0 - inside( wind, aa );
		float rimH = 1.0 - inside( e - ${(SIDEWALK + 2.0).toFixed(1)}, aa );
		inner = mix( lawn, uPath * ( 0.9 + 0.15 * fine ), path );
		inner = mix( inner, lawn * 0.65, rimH * ( 1.0 - path ) );
	}

	bool plaza = type > 0.5 && type < 1.5;
	float inBlock = inside( e, aa ); // 0 in the street, 1 in the block
	float yardM = inside( e - ${SIDEWALK.toFixed(1)}, aa ); // 1 beyond the pavement (a plaza has none)
	vec3 blockCol = mix( walk, inner, plaza ? 1.0 : yardM );
	bgRough = mix( 0.95, 0.85, inBlock );
	// shadows: this block's buildings and those of the three blocks towards the key light
	int du = uKeyAlong.x > 0.0 ? 1 : -1;
	int dv = uKeyAlong.y > 0.0 ? 1 : -1;
	vec4 ua = du > 0 ? lb : texelFetch( uLines, ivec2( max( iu - 1, 0 ), 0 ), 0 );
	vec4 ub = du > 0 ? texelFetch( uLines, ivec2( min( iu + 2, int( uCount.x ) - 1 ), 0 ), 0 ) : la;
	vec4 va = dv > 0 ? ld : texelFetch( uLines, ivec2( max( iv - 1, 0 ), 1 ), 0 );
	vec4 vb = dv > 0 ? texelFetch( uLines, ivec2( min( iv + 2, int( uCount.y ) - 1 ), 1 ), 0 ) : lc;
	float shade = 0.0;
	if ( bgBuilt( iu, iv ) ) shade = max( shade, max( bgBlockCast( s, la, lb, lc, ld ), yardM * 0.9 ) );
	if ( bgBuilt( iu + du, iv ) ) shade = max( shade, bgBlockCast( s, ua, ub, lc, ld ) );
	if ( bgBuilt( iu, iv + dv ) ) shade = max( shade, bgBlockCast( s, la, lb, va, vb ) );
	if ( bgBuilt( iu + du, iv + dv ) ) shade = max( shade, bgBlockCast( s, ua, ub, va, vb ) );
	bgSun = 1.0 - 0.85 * shade;
	return mix( street, blockCol, inBlock );
}
`;

/** The shared sheet's vertices: sheet.ts's `sheetAt` in the vertex shader, reading the state's profile from a one-row texture. */
const GLSL_BEND = /* glsl */ `
uniform highp sampler2D uProfile;
uniform vec3 uProfileInfo;
vec3 bgSheet( vec2 s ) {
	float u = clamp( ( s.x - uProfileInfo.x ) / uProfileInfo.y, 0.0, uProfileInfo.z - 0.001 );
	int i = int( floor( u ) );
	vec4 p0 = texelFetch( uProfile, ivec2( i, 0 ), 0 );
	vec4 p1 = texelFetch( uProfile, ivec2( i + 1, 0 ), 0 );
	vec4 p = mix( p0, p1, u - float( i ) );
	// the twist of the canyon wall here (sheet.ts, twistVeil)
	vTwist = max( 0.0, abs( s.y ) - ${(W0 + BEND / 2).toFixed(1)} ) * abs( p1.w - p0.w ) / uProfileInfo.y;
	float d = abs( s.y ) - ${W0.toFixed(1)};
	float g = abs( s.y );
	float h = 0.0;
	if ( d > 0.0 && p.w > 1e-5 ) {
		float k = p.w / ${BEND.toFixed(1)};
		float t = min( d, ${BEND.toFixed(1)} );
		g = ${W0.toFixed(1)} + sin( k * t ) / k;
		h = ( 1.0 - cos( k * t ) ) / k;
		if ( d > ${BEND.toFixed(1)} ) {
			g += ( d - ${BEND.toFixed(1)} ) * cos( p.w );
			h += ( d - ${BEND.toFixed(1)} ) * sin( p.w );
		}
	}
	return vec3( p.x - sin( p.z ) * h, p.y + cos( p.z ) * h, ${Z0.toFixed(1)} + sign( s.y ) * g );
}
`;

export interface GroundOptions {
  surface: Surface;
  sign: 1 | -1;
  lattice: Lattice;
  uniforms: AtmosphereUniforms;
  /** Draw both sides; the back of the sheet is a plain underside. */
  doubleSide?: boolean;
  /** Where on the surface to cut the strips (adaptive); the sheet is sampled at these. */
  maxStep?: number;
}

const srgb = (hex: string) => new THREE.Color(hex);

/** The lattice as two small float/byte textures for the shader. */
export function latticeTextures(lat: Lattice) {
  const nu = lat.u.length;
  const nv = lat.v.length;
  const w = Math.max(nu, nv);
  const data = new Float32Array(w * 2 * 4);
  lat.u.forEach((l, i) => data.set([l.c, l.hw, l.avenue ? 1 : 0, 0], i * 4));
  lat.v.forEach((l, i) => data.set([l.c, l.hw, l.avenue ? 1 : 0, 0], (w + i) * 4));
  const lines = new THREE.DataTexture(data, w, 2, THREE.RGBAFormat, THREE.FloatType);
  lines.minFilter = lines.magFilter = THREE.NearestFilter;
  lines.needsUpdate = true;
  const cu = nu - 1;
  const cv = nv - 1;
  const bytes = new Uint8Array(cu * cv * 4);
  lat.cells.forEach((c, i) => bytes.set([c.type, Math.round(c.r * 255), 0, 255], i * 4));
  const cells = new THREE.DataTexture(bytes, cu, cv, THREE.RGBAFormat, THREE.UnsignedByteType);
  cells.minFilter = cells.magFilter = THREE.NearestFilter;
  cells.needsUpdate = true;
  return { lines, cells, count: new THREE.Vector2(nu, nv) };
}

export function buildGround(opts: GroundOptions): THREE.Mesh {
  const { surface, sign, lattice } = opts;
  const maxStep = opts.maxStep ?? 48;
  const vs = surface.vRange;
  const us = surface.uRange;
  const uSamples = [vs[0] + 1, (vs[0] + vs[1]) / 2, vs[1] - 1];
  const vSamples = [us[0] + 1, (us[0] + us[1]) / 2, us[1] - 1];
  const bu = breaks(surface, sign, 'u', uSamples, maxStep);
  const bv = breaks(surface, sign, 'v', vSamples, maxStep);
  const nu = bu.length;
  const nv = bv.length;
  const pos = new Float32Array(nu * nv * 3);
  const nor = new Float32Array(nu * nv * 3);
  const sheet = new Float32Array(nu * nv * 2);
  const f = makeFrame();
  for (let j = 0; j < nv; j++)
    for (let i = 0; i < nu; i++) {
      const k = j * nu + i;
      frameAt(surface, sign, bu[i], bv[j], f);
      pos.set([f.p.x, f.p.y, f.p.z], k * 3);
      nor.set([f.n.x, f.n.y, f.n.z], k * 3);
      sheet.set([bu[i], bv[j]], k * 2);
    }
  // wound so the faces look along the normal: test one quad
  const mid = Math.floor(nv / 2) * nu + Math.floor(nu / 2);
  const p0 = new THREE.Vector3().fromArray(pos, mid * 3);
  const pu = new THREE.Vector3().fromArray(pos, (mid + 1) * 3).sub(p0);
  const pv = new THREE.Vector3().fromArray(pos, (mid + nu) * 3).sub(p0);
  const nrm = new THREE.Vector3().fromArray(nor, mid * 3);
  const ccw = new THREE.Vector3().crossVectors(pu, pv).dot(nrm) > 0;
  const index = new Uint32Array((nu - 1) * (nv - 1) * 6);
  let q = 0;
  for (let j = 0; j < nv - 1; j++)
    for (let i = 0; i < nu - 1; i++) {
      const a = j * nu + i;
      const b = a + 1;
      const c = a + nu;
      const d = c + 1;
      if (ccw) index.set([a, b, c, b, d, c], q);
      else index.set([a, c, b, b, c, d], q);
      q += 6;
    }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  g.setAttribute('aSheet', new THREE.BufferAttribute(sheet, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  g.computeBoundingSphere();

  const mesh = new THREE.Mesh(g, groundMaterial(lattice, opts.uniforms, !!opts.doubleSide).material);
  mesh.name = 'foldcity-ground';
  mesh.frustumCulled = false;
  mesh.userData.triangles = index.length / 3;
  return mesh;
}

/** Where the sheet ends and how its ends are shown (the shared sheet of sheet.ts; the old variants leave it off). */
export interface SheetEnds {
  /** (a0, a1, |b| max, seam). */
  uSheetBox: { value: THREE.Vector4 };
  /** (endFade, tailCut, 1 = on). */
  uSheetShow: { value: THREE.Vector3 };
}

/** The ground's material: the street pattern from the lattice, lit as flat sheet, under the background's haze. */
export function groundMaterial(
  lattice: Lattice, uniforms: AtmosphereUniforms, doubleSide: boolean, bend?: Record<string, THREE.IUniform>,
): { material: THREE.MeshStandardMaterial; ends: SheetEnds } {
  const tex = latticeTextures(lattice);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, fog: false, side: doubleSide ? THREE.DoubleSide : THREE.FrontSide });
  const ends: SheetEnds = { uSheetBox: { value: new THREE.Vector4(0, 0, 0, 0) }, uSheetShow: { value: new THREE.Vector3(0, 0, 0) } };
  const extra = {
    vertexDecl: `attribute vec2 aSheet;\nvarying vec2 vSheet;\nvarying float vTwist;${bend ? GLSL_BEND : ''}`,
    vertexMain: 'vSheet = aSheet;',
    vertexBegin: bend ? 'transformed = bgSheet( aSheet );' : 'vTwist = 0.0;',
    fragmentDecl: GLSL_DECL,
    fragmentColor:
      'bgEnds( vSheet );\ndiffuseColor.rgb = bgGround( vSheet );\n#ifdef DOUBLE_SIDED\nif ( ! gl_FrontFacing ) { diffuseColor.rgb = bgUnder( vSheet ); bgRough = 0.95; bgSun = 0.0; }\n#endif',
    fragmentRough: 'roughnessFactor = bgRough;',
    light: 'bgLight( vec3( 0.0, 1.0, 0.0 ), 0.0, bgSun )',
    uniforms: {
      ...ends,
      ...bend,
      uKeyAlong: { value: new THREE.Vector2(KEY_ALONG[0], KEY_ALONG[1]) },
      uLines: { value: tex.lines },
      uCells: { value: tex.cells },
      uCount: { value: tex.count },
      uStreet: { value: srgb('#4d4a45') },
      uWalk: { value: srgb('#7d776d') },
      uYard: { value: srgb('#5e5952') },
      uPlaza: { value: srgb('#857d6d') },
      uPlazaB: { value: srgb('#70695a') },
      uPark: { value: srgb('#5d6650') },
      uPath: { value: srgb('#8f8672') },
      uMark: { value: srgb('#a8a294') },
      uUnder: { value: srgb('#5d564d') },
    },
  };
  mat.onBeforeCompile = (shader) => patchShader(shader, uniforms, extra);
  mat.customProgramCacheKey = () => 'foldcity-ground';
  return { material: mat, ends };
}

/** The ground of the shared sheet: a fixed grid of sheet lines whose vertices follow whatever state the sheet is in. */
export interface SheetGround {
  mesh: THREE.Mesh;
  triangles: number;
  /** Move every vertex to its place in `state`. */
  update(state: SheetState): void;
}

export function buildSheetGround(lattice: Lattice, uniforms: AtmosphereUniforms): SheetGround {
  const { a, b } = sheetGrid();
  const na = a.length;
  const nb = b.length;
  const pos = new Float32Array(na * nb * 3);
  const sheet = new Float32Array(na * nb * 2);
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) sheet.set([a[i], b[j]], (j * na + i) * 2);
  const index = new Uint32Array((na - 1) * (nb - 1) * 6);
  let q = 0;
  for (let j = 0; j < nb - 1; j++)
    for (let i = 0; i < na - 1; i++) {
      const p = j * na + i;
      // a runs along +X and b along +Z on the flat sheet: this winding faces up, towards the play area
      index.set([p, p + na, p + 1, p + 1, p + na, p + na + 1], q);
      q += 6;
    }
  const g = new THREE.BufferGeometry();
  // the vertices are bent in the vertex shader, from the state's profile in a small texture; these are the flat sheet's
  for (let j = 0; j < nb; j++) for (let i = 0; i < na; i++) pos.set([a[i], GROUND_Y, Z0 + b[j]], (j * na + i) * 3);
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // the ground is lit as flat sheet (the same on a floor, a wall and a ceiling): its normals are never read
  g.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(na * nb * 3), 3));
  g.setAttribute('aSheet', new THREE.BufferAttribute(sheet, 2));
  g.setIndex(new THREE.BufferAttribute(index, 1));
  const table = new Float32Array((PROFILE_SAMPLES + 1) * 4);
  const profile = new THREE.DataTexture(table, PROFILE_SAMPLES + 1, 1, THREE.RGBAFormat, THREE.FloatType);
  profile.minFilter = profile.magFilter = THREE.NearestFilter;
  const { material, ends } = groundMaterial(lattice, uniforms, true, {
    uProfile: { value: profile },
    uProfileInfo: { value: new THREE.Vector3(A0, PROFILE_STEP, PROFILE_SAMPLES) },
  });
  ends.uSheetBox.value.set(A0, A1, B1, SEAM);
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'foldcity-ground';
  mesh.frustumCulled = false;
  return {
    mesh,
    triangles: index.length / 3,
    update(state) {
      for (let i = 0, k = 0; i <= PROFILE_SAMPLES; i++) {
        table[k++] = state.px[i];
        table[k++] = state.py[i];
        table[k++] = state.th[i];
        table[k++] = state.psi[i];
      }
      profile.needsUpdate = true;
      ends.uSheetShow.value.set(state.endFade, state.tailCut, 1);
    },
  };
}

/** Exposed so tests can see that landmarks exist in the lattice texture's range. */
export const LANDMARK_TYPE = BLOCK_LANDMARK;
