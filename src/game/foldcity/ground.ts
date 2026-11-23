// The ground of the sheet: one continuous mesh following the surface, streets, pavements, courtyards, plazas and parks
// drawn in the fragment shader from the street lattice (two tiny data textures), so the pattern is crisp at any scale
// and costs no texture memory worth counting. Streets cross creases because the pattern lives in sheet coordinates.
import * as THREE from 'three';
import { patchShader, type AtmosphereUniforms } from './atmosphere.ts';
import { BLOCK_LANDMARK, SIDEWALK, type Lattice } from './layout.ts';
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
varying vec2 vSheet;
float bgRough = 0.92;

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
	if ( inU != inV ) {
		bool alongV = inU; // a street between two u lines runs along v
		vec4 L = alongV ? ( e0 < e1 ? la : lb ) : ( e2 < e3 ? lc : ld );
		float lat = abs( ( alongV ? s.x : s.y ) - L.x );
		float along = alongV ? s.y : s.x;
		float edge = alongV ? ev : eu; // distance from the junction
		float dash = step( fract( along / 8.0 ), 0.55 );
		if ( L.z > 0.5 ) {
			mark += ( 1.0 - smoothstep( 0.1 - aa, 0.1 + aa, abs( lat - 0.4 ) ) ) * 0.9; // double line
			mark += ( 1.0 - smoothstep( 0.1 - aa, 0.1 + aa, abs( lat - L.y * 0.55 ) ) ) * dash * 0.8; // lane dashes
			float z = step( 0.5, fract( ( alongV ? s.x : s.y ) / 1.7 ) ) * inside( edge - 0.6, aa ) * ( 1.0 - inside( edge - 4.2, aa ) );
			mark += z * 0.85;
		} else {
			mark += ( 1.0 - smoothstep( 0.09 - aa, 0.09 + aa, lat ) ) * dash * 0.7;
		}
		mark *= 1.0 - smoothstep( 0.2, 0.7, aa );
	}
	street = mix( street, uMark, clamp( mark, 0.0, 1.0 ) * 0.8 );

	// the pavement along the block edge, with its kerb and joints
	vec3 walk = uWalk * ( 0.92 + 0.16 * fine ) * ( 0.92 + 0.16 * big );
	walk *= 1.0 - 0.28 * joints( s, 1.8, 0.05, aa );
	walk *= 1.0 - 0.45 * ( 1.0 - smoothstep( 0.0, 0.3, e ) ); // the kerb's shadow line
	bgRough = 0.85;

	// the block
	vec3 yard = uYard * tone * ( 0.85 + 0.2 * fine );
	yard *= 1.0 - 0.22 * joints( s, 5.5, 0.07, aa );
	vec3 inner = yard;
	if ( type > 0.5 && type < 1.5 ) {
		// plaza: paving all the way to the street, bands of light and dark stone, a ring of stone round the middle
		vec2 c = vec2( 0.5 * ( la.x + la.y + lb.x - lb.y ), 0.5 * ( lc.x + lc.y + ld.x - ld.y ) );
		vec2 p = s - c;
		vec2 hs = vec2( 0.5 * ( lb.x - lb.y - la.x - la.y ), 0.5 * ( ld.x - ld.y - lc.x - lc.y ) );
		float rr = length( p );
		float diag = step( 0.5, fract( ( p.x + p.y ) / 14.0 ) );
		float rim = min( min( hs.x, hs.y ) - abs( p.x ), min( hs.x, hs.y ) - abs( p.y ) );
		float ring = ( 1.0 - smoothstep( 0.6 - aa, 0.6 + aa, abs( rr - min( hs.x, hs.y ) * 0.6 ) / 4.0 ) );
		inner = mix( uPlaza, uPlazaB, diag * 0.4 + ring * 0.35 ) * ( 0.9 + 0.16 * fine ) * ( 0.94 + 0.1 * rnd );
		inner *= 1.0 - 0.26 * joints( s, 2.6, 0.06, aa );
		inner *= 1.0 - 0.14 * ( 1.0 - inside( rim - 1.2, aa ) );
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
	return mix( street, blockCol, inBlock );
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

  const tex = latticeTextures(lattice);
  const mat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.92, metalness: 0, fog: false, side: opts.doubleSide ? THREE.DoubleSide : THREE.FrontSide });
  const extra = {
    vertexDecl: 'attribute vec2 aSheet;\nvarying vec2 vSheet;',
    vertexMain: 'vSheet = aSheet;',
    fragmentDecl: GLSL_DECL,
    fragmentColor: 'diffuseColor.rgb = bgGround( vSheet );\n#ifdef DOUBLE_SIDED\nif ( ! gl_FrontFacing ) { diffuseColor.rgb = uUnder; bgRough = 0.95; }\n#endif',
    fragmentRough: 'roughnessFactor = bgRough;',
    uniforms: {
      uLines: { value: tex.lines },
      uCells: { value: tex.cells },
      uCount: { value: tex.count },
      uStreet: { value: srgb('#5c564e') },
      uWalk: { value: srgb('#9a9183') },
      uYard: { value: srgb('#7b7468') },
      uPlaza: { value: srgb('#b0a68f') },
      uPlazaB: { value: srgb('#8e8570') },
      uPark: { value: srgb('#666c57') },
      uPath: { value: srgb('#a59a83') },
      uMark: { value: srgb('#cfc8b6') },
      uUnder: { value: srgb('#5d564d') },
    },
  };
  mat.onBeforeCompile = (shader) => patchShader(shader, opts.uniforms, extra);
  mat.customProgramCacheKey = () => 'foldcity-ground';
  const mesh = new THREE.Mesh(g, mat);
  mesh.name = 'foldcity-ground';
  mesh.frustumCulled = false;
  mesh.userData.triangles = index.length / 3;
  return mesh;
}

/** Exposed so tests can see that landmarks exist in the lattice texture's range. */
export const LANDMARK_TYPE = BLOCK_LANDMARK;
