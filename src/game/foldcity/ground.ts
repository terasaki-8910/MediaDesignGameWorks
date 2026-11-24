// The ground of the sheet: one continuous mesh following the surface, streets of setts, pavements, courts, plazas and parks
// drawn in the fragment shader from the street lattice (three tiny data textures), so the pattern is crisp at any scale
// and costs no texture memory worth counting. Streets cross creases because the pattern lives in sheet coordinates.
import * as THREE from 'three';
import { FAR_JITTER, KEY_ALONG, patchShader, type AtmosphereUniforms } from './atmosphere.ts';
import { BLOCK_LANDMARK, SIDEWALK, type Lattice } from './layout.ts';
import { A0, A1, B0, B1, BEND, GROUND_Y, LIP_SOFT, SAMPLES_A, SAMPLES_B, sheetGrid, TWIST_FADE, W0, Z0, type SheetState } from './sheet.ts';
import { breaks, frameAt, makeFrame, type Surface } from './surfaces.ts';

/**
 * The ground goes into the far sky block by block as the buildings do, but sooner than they (as if it lay GROUND_AHEAD
 * metres further off) and by smaller steps from one block to the next (this share of FAR_JITTER): a block's edge is a
 * straight line, and where the ground ended the city against the sky it showed as a ruled edge. Now the houses end it.
 */
const GROUND_JITTER = 0.35;
const GROUND_AHEAD = 60;

const GLSL_DECL = /* glsl */ `
uniform sampler2D uLines;
uniform sampler2D uCells;
uniform sampler2D uLineIndex;
uniform vec2 uLineOrigin;
uniform vec2 uCount;
uniform vec3 uStreet;
uniform vec3 uWalk;
uniform vec3 uYard;
uniform vec3 uPlaza;
uniform vec3 uPlazaB;
uniform vec3 uPark;
uniform vec3 uPath;
uniform vec3 uUnder;
uniform vec4 uSheetBox;
uniform vec3 uSheetShow;
uniform vec2 uKeyAlong;
uniform sampler2D uShadowA;
uniform sampler2D uShadowB;
uniform float uShadowMix;
uniform float uShadowOn;
uniform float uBgSlab;
uniform float uBgCars;
uniform float uBgTraffic;
uniform float uBgGarden;
uniform float uBgJoint;
uniform float uBgOwn;
uniform float uBgCanyonPave;
uniform float uBgBand;
uniform float uBgSetts;
uniform float uBgPave;
uniform float uBgOccShade;
uniform float uBgShadow;
uniform float uBgGround;
varying float vTwist;
varying vec2 vSheet;
float bgRough = 0.92;
// how much of the key light reaches this point of the ground (the buildings' shadows)
float bgSun = 1.0;
// how much of the sky's light does: little in a court and at the foot of the fronts, more in the middle of a street
float bgOcc = 1.0;
// how much of the paving's own pattern is drawn: all of it under the walkways seen from above, less with distance from
// the play volume and where the ground is seen along (the walls beside the play area)
float bgNear = 1.0;
// how far the ground is seen from above (1 within 26 degrees of its normal, 0 beyond 53)
float bgTop = 1.0;
// the share of the paving's pattern, the traffic and the gardens that is drawn: all of it in the closed structures, less in the open canyon
float bgShut = 1.0;

float h21( vec2 p ) { p = fract( p * vec2( 123.34, 456.21 ) ); p += dot( p, p + 45.32 ); return fract( p.x * p.y ); }
// the street line at or below s: the index map gives it to the metre, the next line's centre settles the rest
int findLine( float s, int row, int n ) {
	int i = int( texelFetch( uLineIndex, ivec2( int( floor( s - uLineOrigin[ row ] ) ), row ), 0 ).r * 255.0 + 0.5 );
	if ( i < n - 2 && texelFetch( uLines, ivec2( i + 1, row ), 0 ).x <= s ) i ++;
	return clamp( i, 0, n - 2 );
}
// 1 inside, 0 outside, soft over one pixel
float inside( float d, float aa ) { return smoothstep( - aa, aa, d ); }
// a line of half-width w at distance d from its middle: it goes into its surroundings where it is thinner than a pixel
float bgLine( float d, float w, float aa ) { return ( 1.0 - smoothstep( w - aa, w + aa, abs( d ) ) ) * min( 1.0, 2.5 * w / max( aa, 1e-3 ) ) * ( 1.0 - smoothstep( 4.0, 12.0, aa / w ) ); }

// courses of two stones laid turn about, w metres each (the brief's A2: paving in bands): -1 and 1, 0 where a course is under a pixel
float bgBands( float x, float w, float aa ) {
	float t = abs( fract( x / ( 2.0 * w ) ) - 0.5 ) * 2.0 * w; // distance from the middle of the darker course's joint
	return ( smoothstep( 0.5 * w - aa, 0.5 * w + aa, t ) * 2.0 - 1.0 ) * ( 1.0 - smoothstep( 0.25, 0.7, aa / w ) );
}

// paving in courses of two stones (the brief's A2), each course a row of slabs laid with broken joints, every slab its
// own cut of the stone: x runs across the courses (w metres each), y along them (slabs of len metres). band is how far
// the two stones lie apart, own how far a slab lies from its course; -1..1 times those, and plain where a course is
// under a pixel. Round 5 had the courses alone, at two and a half times the contrast: from a distance they were stripes
float bgPaving( vec2 p, float w, float len, float band, float own, float joint, float aa ) {
	float i = floor( p.x / w );
	float v = p.y / len + h21( vec2( i, 7.0 ) );
	float fade = 1.0 - smoothstep( 0.25, 0.7, aa / w );
	// the joints: between the courses and between the slabs of a course, a line never thinner than a pixel
	float hw = max( 0.04, 0.5 * aa );
	float jx = 1.0 - smoothstep( hw - aa, hw + aa, abs( fract( p.x / w + 0.5 ) - 0.5 ) * w );
	float jy = 1.0 - smoothstep( hw - aa, hw + aa, abs( fract( v + 0.5 ) - 0.5 ) * len );
	return band * bgBands( p.x + 0.5 * w, w, aa ) + ( own * ( h21( vec2( i, floor( v ) ) ) * 2.0 - 1.0 ) - joint * max( jx, jy ) ) * fade;
}

// a car seen from above, q metres along it and off metres across from its middle: (body, cabin, the shade beside it)
vec3 bgCar( float q, float off, float aa ) {
	return vec3( ( 1.0 - smoothstep( 2.15 - aa, 2.15 + aa, q ) ) * ( 1.0 - smoothstep( 0.9 - aa, 0.9 + aa, abs( off ) ) ),
		( 1.0 - smoothstep( 1.0 - aa, 1.0 + aa, abs( q - 0.25 ) ) ) * ( 1.0 - smoothstep( 0.7 - aa, 0.7 + aa, abs( off ) ) ),
		( 1.0 - smoothstep( 2.3 - aa, 2.3 + aa, q ) ) * ( 1.0 - smoothstep( 1.25 - aa, 1.25 + aa, abs( off + 0.25 ) ) ) );
}
// its paint: black, silver, white, dark red, dark blue, by its number (0 to 1)
vec3 bgCarPaint( float id ) {
	return id < 0.2 ? vec3( 0.075, 0.078, 0.085 ) : id < 0.36 ? vec3( 0.33, 0.34, 0.35 ) : id < 0.46 ? vec3( 0.52, 0.51, 0.48 ) : id < 0.53 ? vec3( 0.13, 0.075, 0.065 ) : vec3( 0.09, 0.12, 0.16 );
}

// the tone of the slab a point lies on (0 to 1, each slab its own); a plain 0.5 where a slab is smaller than a pixel
float slabTone( vec2 s, vec2 tile, float aa ) {
	return mix( h21( floor( s / tile ) ), 0.5, smoothstep( 0.2, 0.7, aa / min( tile.x, tile.y ) ) );
}

// the ends of the shared sheet: its far ends and its upper edges dissolve, the sheet beyond the tube's seam is not drawn
void bgEnds( vec2 s ) {
	if ( uSheetShow.z < 0.5 ) return;
	if ( abs( s.y ) > uSheetBox.w ) discard;
	// (the sheet's two ends along the axis need none of this: at that distance the haze has taken everything)
	float v = 1.0 - smoothstep( 20.0, 240.0, uSheetBox.z - abs( s.y ) );
	v = max( v, smoothstep( ${TWIST_FADE[0].toFixed(2)}, ${TWIST_FADE[1].toFixed(2)}, vTwist ) );
	bgVeil = v;
}
// the back of the sheet: the city's foundations, a grid of deep vaults between ribs of stone under the streets
vec3 bgUnder( vec2 s ) {
	vec2 aw = fwidth( s );
	float aa = max( max( aw.x, aw.y ), 1e-3 );
	vec2 q = abs( fract( s / 24.0 ) - 0.5 ) * 24.0;
	float rib = 1.0 - smoothstep( 9.0 - aa, 9.6 + aa, max( q.x, q.y ) );
	float depth = smoothstep( 0.0, 9.0, max( q.x, q.y ) );
	vec3 vault = uUnder * mix( 0.42, 0.95, depth * depth );
	return mix( uUnder * 1.35, vault, rib * ( 1.0 - smoothstep( 0.3, 1.2, aa / 12.0 ) ) );
}

// how much of the key light the buildings and trees take away here (0 to 1): the shadow maps of the structure shown and
// of the one being folded to (shadow.ts)
float bgShadow( vec2 p ) {
	vec2 uv = ( p - vec2( ${A0.toFixed(1)}, ${B0.toFixed(1)} ) ) / vec2( ${(A1 - A0).toFixed(1)}, ${(B1 - B0).toFixed(1)} );
	return mix( textureLod( uShadowA, uv, 0.0 ).r, textureLod( uShadowB, uv, 0.0 ).r, uShadowMix );
}
// 1 when the way from p towards the key light is blocked, within reach, by the buildings of the block lo..hi
float bgCast( vec2 p, vec2 lo, vec2 hi, float reach ) {
	vec2 along = normalize( vBgKeyDir.xz + vec2( 1e-4, 0.0 ) );
	vec2 t0 = ( lo - p ) / along;
	vec2 t1 = ( hi - p ) / along;
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
	float tone = 0.9 + 0.2 * rnd;
	// the paving's own pattern (courses, slabs, joints) is for the city under the walkways, seen from above (bgNear): from
	// 110 to 240 m from the play volume it goes, and where the ground is seen along, so the walls beside the play area
	// keep only what is on the ground: kerbs, lane lines, crossings, parked cars, shadows. It is the sun that picks courses
	// and joints out: on ground turned away from it they are fainter. The slabs' own tones, the joints, the traffic and the
	// gardens are there only where the ground is seen from above (top), and the open canyon shows a share of it all (shut)
	float near = bgNear;
	float sl = uBgSlab * near;
	float shut = bgShut;
	float pv = uBgPave * near * shut;
	float top = bgTop * shut;

	// the roadway: dark setts relaid in patches, a pale crown, lane lines, crossings at every junction, a gutter in the
	// kerb's shade, parked cars and traffic. Nothing here is a noise texture: what gives a street its texture from above is
	// what it is laid with and what is on it
	bool inU = eu < 0.0;
	bool inV = ev < 0.0;
	bool alongV = inU; // a street between two u lines runs along v
	vec4 L = alongV ? ( e0 < e1 ? la : lb ) : ( e2 < e3 ? lc : ld );
	float lat = abs( ( alongV ? s.x : s.y ) - L.x );
	float run = alongV ? s.y : s.x;
	vec3 street = uStreet * ( 1.0 + 0.1 * sl * ( slabTone( alongV ? s.yx : s.xy, vec2( 14.0, 3.2 ), aa ) - 0.5 ) );
	// the lanes where cars stand are setts, relaid patch by patch; the lanes they drive in are asphalt, a shade darker
	float parking = inside( lat - ( L.y - 2.5 ), aa );
	street *= 1.0 + 0.1 * near * parking + mix( uBgSetts, 1.0, parking ) * ( pv * bgPaving( vec2( run, lat ), 1.6, 2.5, 0.6 * uBgBand, 0.3 * uBgOwn * top, 0.0, aa ) );
	float median = 0.0;
	if ( inU != inV ) {
		street *= 1.0 + 0.08 * ( 1.0 - smoothstep( 0.0, L.y * 0.7, lat ) ); // the crown of the road, worn pale
		// how far along the street to the nearest junction's edge (the crossing streets' kerbs)
		float toX = alongV ? ev : eu;
		vec3 paint = vec3( 0.42, 0.41, 0.38 );
		// a boulevard (the wide avenue on a crease) has a planted strip down its middle, between two kerbs, and two lanes a side
		if ( L.y > 15.0 ) {
			median = 1.0 - inside( lat - 3.2, aa );
			street = mix( street, paint, 0.8 * bgLine( lat - 0.5 * ( 3.2 + L.y - 2.4 ), 0.09, aa ) * step( 0.5, fract( run / 9.0 ) ) * step( 7.0, toX ) );
		} else {
			// the centre line, dashed (solid on an avenue), stopping short of the junction
			street = mix( street, paint, 0.8 * bgLine( lat, 0.09, aa ) * ( L.z > 0.5 ? 1.0 : step( 0.45, fract( run / 7.0 ) ) ) * step( 7.0, toX ) );
		}
		// the edge of the parking lane
		street = mix( street, paint, 0.5 * bgLine( lat - ( L.y - 2.5 ), 0.06, aa ) * step( 7.0, toX ) );
		// a zebra crossing before each junction: bars 0.55 m wide along the street, 3.4 m long, from kerb to kerb (a plain
		// paler band where a bar is under a pixel)
		float fine = smoothstep( 0.2, 0.6, aa / 0.55 );
		float bars = mix( step( 0.5, fract( lat / 1.1 ) ), 0.5, fine ) * ( 1.0 - smoothstep( 1.2, 3.0, aa ) );
		float zebra = ( 1.0 - smoothstep( 1.7 - aa, 1.7 + aa, abs( toX - 3.2 ) ) ) * step( lat, L.y - 0.5 ) * ( 1.0 - median );
		street = mix( street, vec3( 0.5, 0.49, 0.46 ), 0.85 * zebra * bars );
		// and the stop line behind it
		street = mix( street, paint, 0.8 * bgLine( toX - 6.0, 0.14, aa ) * step( lat, L.y - 0.5 ) * ( 1.0 - median ) );
	}
	// (the planted strip: a lawn between two kerbs of pale stone)
	street = mix( street, mix( uWalk * 1.1, uPark, inside( 2.85 - lat, aa ) ), median );
	street *= 1.0 - 0.3 * ( 1.0 - smoothstep( 0.0, 1.2, - e ) ); // the gutter along the kerb, in the kerb's shade
	// cars parked along both kerbs (not across a crossing, not on a boulevard's planted strip): seen from above a street
	// has life in it. Each is a body with a darker cabin, its own paint, and its shade on the setts beside it; they are
	// gone where a car is under two pixels, so the walls the play cameras look along carry none
	if ( inU != inV ) {
		float off = lat - ( L.y - 1.3 );
		float slot = floor( run / 5.7 );
		float id = h21( vec2( slot, L.x * 0.37 + ( ( alongV ? s.x : s.y ) > L.x ? 3.1 : 7.7 ) ) );
		float q = abs( run - ( slot + 0.5 ) * 5.7 );
		float there = step( id, 0.62 ) * step( 9.0, alongV ? ev : eu ) * uBgCars * ( 1.0 - smoothstep( 0.45, 1.3, aa ) );
		vec3 car = bgCar( q, off, aa );
		vec3 paint = bgCarPaint( id );
		paint = mix( paint, paint * 0.5 + vec3( 0.03, 0.035, 0.04 ), car.y );
		street *= 1.0 - 0.3 * car.z * there;
		street = mix( street, paint, car.x * there );
		// and the traffic: cars in the lanes between the parked rows (and the planted strip), each somewhere in its own
		// stretch of 11 m, the share of the stretches that uBgTraffic gives taken; none on a crossing, and only where the
		// street is seen from above
		float d0 = L.y > 15.0 ? 3.6 : 0.0;
		float lanes = max( 1.0, floor( ( L.y - 2.5 - d0 ) / 2.9 ) );
		float lw = ( L.y - 2.5 - d0 ) / lanes;
		float lane = clamp( floor( ( lat - d0 ) / lw ), 0.0, lanes - 1.0 );
		float side = ( alongV ? s.x : s.y ) > L.x ? 3.1 : 7.7;
		float stretch = floor( run / 11.0 + h21( vec2( lane + side, L.x * 0.21 ) ) );
		float tid = h21( vec2( stretch, L.x * 0.53 + lane * 1.7 + side ) );
		float tq = abs( fract( run / 11.0 + h21( vec2( lane + side, L.x * 0.21 ) ) ) * 11.0 - ( 3.0 + 5.0 * fract( tid * 17.0 ) ) );
		float going = step( tid, uBgTraffic ) * step( 9.0, alongV ? ev : eu ) * step( d0, lat ) * uBgCars * top * ( 1.0 - smoothstep( 0.45, 1.3, aa ) );
		car = bgCar( tq, lat - ( d0 + ( lane + 0.5 ) * lw ), aa );
		paint = bgCarPaint( fract( tid * 29.0 ) );
		paint = mix( paint, paint * 0.5 + vec3( 0.03, 0.035, 0.04 ), car.y );
		street *= 1.0 - 0.3 * car.z * going;
		street = mix( street, paint, car.x * going );
	}

	// the pavement along the block edge: pale slabs in courses across it, a kerb of paler stone and the joint behind it
	vec2 ws = eu < ev ? s.yx : s.xy; // (x along the kerb)
	vec3 walk = uWalk * ( 1.0 + 0.1 * sl * ( slabTone( ws, vec2( 2.6, 1.3 ), aa ) - 0.5 ) ) * ( 1.0 + pv * bgPaving( ws, 1.3, 1.3, uBgBand, 0.4 * uBgOwn * top, uBgJoint * top, aa ) );
	walk *= 1.0 + 0.22 * ( 1.0 - smoothstep( 0.32, 0.4 + aa, e ) ); // the kerb stone
	walk *= 1.0 - 0.3 * bgLine( e - 0.48, 0.07, aa );

	// the block: its courts, paved in bands of two stones (the brief's A2), each block its own tone
	// (how far its two stones lie apart is the block's own: a half to one and a half times the usual)
	vec3 inner = uYard * tone * ( 1.0 + pv * bgPaving( s, 1.6, 3.2, 1.2 * uBgBand * ( 0.6 + 0.8 * rnd ), 0.45 * uBgOwn * top, uBgJoint * top, aa ) ) * ( 1.0 + 0.08 * sl * ( slabTone( s, vec2( 3.2, 3.2 ), aa ) - 0.5 ) );
	bool plaza = type > 0.5 && type < 1.5;
	if ( plaza ) {
		// plaza: paving laid in rings round the fountain or the monument, a dark band at two radii, rays between them
		vec2 c = vec2( 0.5 * ( la.x + la.y + lb.x - lb.y ), 0.5 * ( lc.x + lc.y + ld.x - ld.y ) );
		vec2 p = s - c;
		vec2 hs = vec2( 0.5 * ( lb.x - lb.y - la.x - la.y ), 0.5 * ( ld.x - ld.y - lc.x - lc.y ) );
		float rr = length( p );
		float m = min( hs.x, hs.y );
		float band = ( 1.0 - smoothstep( 0.5 - aa, 0.5 + aa, abs( rr - 13.0 ) ) ) + ( 1.0 - smoothstep( 0.7 - aa, 0.7 + aa, abs( rr - m * 0.78 ) ) );
		float ray = ( 1.0 - smoothstep( 0.35, 0.35 + aa, abs( fract( atan( p.y, p.x ) * 2.546479 ) - 0.5 ) * rr * 0.39 ) ) * step( 13.0, rr ) * step( rr, m * 0.78 );
		// slabs of two stones laid in a chequer of 4.8 m, a border of the darker stone inside the kerb
		vec2 tl = floor( s / 4.8 );
		float chequer = mod( tl.x + tl.y, 2.0 ) * ( 1.0 - smoothstep( 0.2, 0.7, aa / 4.8 ) );
		float border = 1.0 - smoothstep( 1.3 - aa, 1.3 + aa, abs( e - 4.0 ) );
		inner = mix( uPlaza, uPlazaB, clamp( band + ray * 0.8 + chequer * 0.45 + border, 0.0, 1.0 ) * 0.6 ) * ( 0.95 + 0.1 * rnd ) * ( 1.0 + pv * bgPaving( s.yx, 1.2, 2.4, 0.8 * uBgBand, 0.35 * uBgOwn * top, uBgJoint * top, aa ) );
		inner *= ( 1.0 + 0.1 * sl * ( slabTone( s, vec2( 2.4, 2.4 ), aa ) - 0.5 ) ) * ( 1.0 + 0.2 * ( 1.0 - smoothstep( 0.32, 0.4 + aa, e ) ) );
	} else if ( type > 1.5 && type < 2.5 ) {
		// park: a lawn mown in stripes, a winding path, a darker rim of hedge
		vec2 c = vec2( 0.5 * ( la.x + la.y + lb.x - lb.y ), 0.5 * ( lc.x + lc.y + ld.x - ld.y ) );
		vec2 p = s - c;
		vec3 lawn = uPark * mix( 0.94, 1.06, mix( step( 0.5, fract( p.x / 5.0 ) ), 0.5, smoothstep( 0.2, 0.7, aa / 2.5 ) ) );
		float path = 1.0 - inside( abs( p.y - 7.0 * sin( p.x * 0.11 + rnd * 6.0 ) ) - 1.4, aa );
		float rimH = 1.0 - inside( e - ${(SIDEWALK + 2.0).toFixed(1)}, aa );
		inner = mix( lawn, uPath, path );
		inner = mix( inner, lawn * 0.85, rimH * ( 1.0 - path ) );
	} else if ( fract( rnd * 7.31 ) < uBgGarden ) {
		// most blocks keep a garden in their courts: beds of lawn, of shrubs and of paving between paths of gravel, laid out
		// from the block's corner, each bed its own. Seen from above only (a path is 1.6 m): from further off and along
		// the ground the court is its paving
		vec2 plot = fract( rnd * 3.7 ) < 0.5 ? vec2( 7.2, 5.4 ) : vec2( 5.4, 7.2 );
		vec2 g = ( s - vec2( la.x + la.y, lc.x + lc.y ) - ${(SIDEWALK + 1.0).toFixed(1)} ) / plot;
		vec2 q = ( fract( g ) - 0.5 ) * plot;
		float hb = h21( floor( g ) + rnd * 31.0 );
		float bed = inside( 0.5 * plot.x - 0.8 - abs( q.x ), aa ) * inside( 0.5 * plot.y - 0.8 - abs( q.y ), aa );
		vec3 plant = hb < 0.5 ? uPark * ( 0.85 + 0.3 * fract( hb * 13.0 ) ) : hb < 0.78 ? uPark * 0.62 : inner;
		float there = near * shut * ( 1.0 - smoothstep( 0.5, 1.4, aa ) ) * inside( e - ${(SIDEWALK + 1.0).toFixed(1)}, aa );
		inner = mix( inner, mix( uPath * 0.85, plant, bed ), there );
	}

	float inBlock = inside( e, aa ); // 0 in the street, 1 in the block
	float yardM = inside( e - ${SIDEWALK.toFixed(1)}, aa ); // 1 beyond the pavement (a plaza has none)
	vec3 blockCol = mix( walk, inner, plaza ? 1.0 : yardM );
	bgRough = mix( 0.95, 0.85, inBlock );
	// shadows: this block's buildings and those of the three blocks towards the key light
	int du = vBgKeyDir.x > 0.0 ? 1 : -1;
	int dv = vBgKeyDir.z > 0.0 ? 1 : -1;
	vec4 ua = du > 0 ? lb : texelFetch( uLines, ivec2( max( iu - 1, 0 ), 0 ), 0 );
	vec4 ub = du > 0 ? texelFetch( uLines, ivec2( min( iu + 2, int( uCount.x ) - 1 ), 0 ), 0 ) : la;
	vec4 va = dv > 0 ? ld : texelFetch( uLines, ivec2( max( iv - 1, 0 ), 1 ), 0 );
	vec4 vb = dv > 0 ? texelFetch( uLines, ivec2( min( iv + 2, int( uCount.y ) - 1 ), 1 ), 0 ) : lc;
	float shade = 0.0;
	if ( uShadowOn < 0.5 ) {
	if ( bgBuilt( iu, iv ) ) shade = max( shade, max( bgBlockCast( s, la, lb, lc, ld ), yardM * 0.9 ) );
	if ( bgBuilt( iu + du, iv ) ) shade = max( shade, bgBlockCast( s, ua, ub, lc, ld ) );
	if ( bgBuilt( iu, iv + dv ) ) shade = max( shade, bgBlockCast( s, la, lb, va, vb ) );
	if ( bgBuilt( iu + du, iv + dv ) ) shade = max( shade, bgBlockCast( s, ua, ub, va, vb ) );
	}
	bgSun = uShadowOn > 0.5 ? 1.0 - uBgShadow * bgShadow( s ) : 1.0 - 0.8 * shade;
	// the sky's light: a court between two rows of houses is deep shade, a pavement lies at the foot of its front, a street
	// opens towards its middle; plazas and parks lie open
	bool builtHere = bgBuilt( iu, iv );
	float open = plaza || ( type > 1.5 && type < 2.5 ) ? 1.0 : mix( 0.62, 0.36, yardM );
	if ( ! builtHere ) open = 1.0;
	bgOcc = mix( mix( 0.5, 1.0, smoothstep( 0.0, 12.0, - e ) ), open, inBlock ) * ( 0.74 + 0.26 * bgSun );
	// the sheet's upper edge (the walls of the channel's slot): it ends block by block, each block whole with its houses
	// or gone, so what meets the sky there is a roofline and never a ruled edge (sheet.ts, lipVeil)
	if ( uSheetShow.z > 0.5 ) {
		float cut = uSheetShow.x + rnd * ( uSheetShow.y - uSheetShow.x );
		bgVeil = max( bgVeil, smoothstep( 0.0, ${LIP_SOFT.toFixed(1)}, 0.5 * abs( lc.x + ld.x ) - cut ) );
		// what the haze has all but taken goes on into the sky block by block as well (atmosphere.ts, bgFar)
		bgFarShift = ( rnd - 0.5 ) * ${(FAR_JITTER * GROUND_JITTER).toFixed(1)} + ${GROUND_AHEAD.toFixed(1)};
	}
	return mix( street, blockCol, inBlock );
}
`;

/** The shared sheet's vertices: sheet.ts's `sheetAt` in the vertex shader, reading the state's two tables from a two-row texture. */
const GLSL_BEND = /* glsl */ `
uniform highp sampler2D uSheetTab;
vec3 bgSheet( vec2 s ) {
	float u = clamp( s.x - ${A0.toFixed(1)}, 0.0, ${(SAMPLES_A - 0.001).toFixed(3)} );
	int i = int( floor( u ) );
	float p0 = texelFetch( uSheetTab, ivec2( i, 0 ), 0 ).x;
	float p1 = texelFetch( uSheetTab, ivec2( i + 1, 0 ), 0 ).x;
	float psi = mix( p0, p1, u - float( i ) );
	float d = abs( s.y );
	// the twist of the canyon wall here (sheet.ts, veilAt)
	vTwist = max( 0.0, d - ${(W0 + BEND / 2).toFixed(1)} ) * abs( p1 - p0 );
	float v = clamp( d, 0.0, ${(SAMPLES_B - 0.001).toFixed(3)} );
	int j = int( floor( v ) );
	vec3 tab3 = mix( texelFetch( uSheetTab, ivec2( j, 1 ), 0 ).xyz, texelFetch( uSheetTab, ivec2( j + 1, 1 ), 0 ).xyz, v - float( j ) );
	vec2 tab = tab3.yz;
	vec2 q = tab;
	// the world's sun in the sheet's frame here: along a, towards the play area, along b (atmosphere.ts, bgLight)
	float phi = psi * clamp( ( d - ${W0.toFixed(1)} ) / ${BEND.toFixed(1)}, 0.0, 1.0 ) + tab3.x;
	float sg = s.y < 0.0 ? -1.0 : 1.0;
	vBgKeyDir = vec3( uBgSun.x, uBgSun.y * cos( phi ) - sg * uBgSun.z * sin( phi ), uBgSun.y * sin( phi ) * sg + uBgSun.z * cos( phi ) );
	vBgSkyUp = vec3( 0.0, cos( phi ), sin( phi ) * sg );
	if ( d > ${W0.toFixed(1)} ) {
		vec4 a0 = texelFetch( uSheetTab, ivec2( ${W0}, 1 ), 0 );
		vec4 a1 = texelFetch( uSheetTab, ivec2( ${W0 + BEND}, 1 ), 0 );
		float t = min( d - ${W0.toFixed(1)}, ${BEND.toFixed(1)} );
		float hlf = ( psi + a1.x - a0.x ) / ${BEND.toFixed(1)} * t * 0.5;
		float chord = t * ( abs( hlf ) < 1e-3 ? 1.0 - hlf * hlf / 6.0 : sin( hlf ) / hlf );
		q = a0.yz + chord * vec2( cos( a0.x + hlf ), sin( a0.x + hlf ) );
		if ( d > ${(W0 + BEND).toFixed(1)} ) {
			vec2 dd = tab - a1.yz;
			float c = cos( psi );
			float sn = sin( psi );
			q += vec2( dd.x * c - dd.y * sn, dd.x * sn + dd.y * c );
		}
	}
	return vec3( s.x, ${GROUND_Y.toFixed(1)} + q.y, ${Z0.toFixed(1)} + sign( s.y ) * q.x );
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
  // for every metre of u and of v, the street line at or below it: the shader finds its block in two reads
  const origin = new THREE.Vector2(Math.floor(lat.u[0].c), Math.floor(lat.v[0].c));
  const span = Math.max(Math.ceil(lat.u[nu - 1].c) - origin.x, Math.ceil(lat.v[nv - 1].c) - origin.y) + 2;
  const idx = new Uint8Array(span * 2 * 4);
  [lat.u, lat.v].forEach((list, row) => {
    let k = 0;
    for (let m = 0; m < span; m++) {
      while (k < list.length - 2 && list[k + 1].c <= m + origin.getComponent(row)) k++;
      idx[(row * span + m) * 4] = k;
    }
  });
  const index = new THREE.DataTexture(idx, span, 2, THREE.RGBAFormat, THREE.UnsignedByteType);
  index.minFilter = index.magFilter = THREE.NearestFilter;
  index.needsUpdate = true;
  return { lines, cells, index, origin, count: new THREE.Vector2(nu, nv) };
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

/** The two shadow maps the ground blends (shadow.ts), and how far it is from the first to the second. */
export interface ShadowUniforms {
  uShadowA: { value: THREE.Texture | null };
  uShadowB: { value: THREE.Texture | null };
  uShadowMix: { value: number };
}

/** Where the sheet ends and how its ends are shown (the shared sheet of sheet.ts; the old variants leave it off). */
export interface SheetEnds {
  /** (a0, a1, |b| max, |b| beyond which nothing is drawn). */
  uSheetBox: { value: THREE.Vector4 };
  /** (the sheet dissolves from this |b|, to this |b|, 1 = on). */
  uSheetShow: { value: THREE.Vector3 };
}

/** The ground's material: the street pattern from the lattice, lit as flat sheet, under the background's haze. */
export function groundMaterial(
  lattice: Lattice, uniforms: AtmosphereUniforms, doubleSide: boolean, bend?: Record<string, THREE.IUniform>, shadows?: ShadowUniforms,
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
      'bgEnds( vSheet );\n{ vec3 bgRay = normalize( vBgWorld - cameraPosition ); vec3 bgN = normalize( cross( dFdx( vBgWorld ), dFdy( vBgWorld ) ) ); bgTop = smoothstep( 0.6, 0.9, abs( dot( bgRay, bgN ) ) ); bgShut = mix( 1.0, uBgCanyonPave, uBgFarSky.x ); }\nbgNear = ( 1.0 - smoothstep( 110.0, 240.0, bgPlayDist() ) ) * mix( 0.4, 1.0, smoothstep( -0.2, 0.5, vBgKeyDir.y ) ) * mix( 0.1, 1.0, bgTop );\ndiffuseColor.rgb = bgGround( vSheet ) * uBgGround;\n#ifdef DOUBLE_SIDED\nif ( ! gl_FrontFacing ) { diffuseColor.rgb = bgUnder( vSheet ); bgRough = 0.95; bgSun = 0.0; bgOcc = 0.8; }\n#endif',
    fragmentRough: 'roughnessFactor = bgRough;',
    light: 'bgLight( vec3( 0.0, 1.0, 0.0 ), vBgKeyDir, normalize( vBgSkyUp ), bgSun, mix( mix( uBgOccShade, uBgSkyLobe.z, smoothstep( -0.9, 0.9, vBgKeyDir.y ) ), 1.0, bgOcc ) )',
    ground: true,
    uniforms: {
      ...ends,
      ...bend,
      uKeyAlong: { value: new THREE.Vector2(KEY_ALONG[0], KEY_ALONG[1]) },
      uShadowA: shadows?.uShadowA ?? { value: null },
      uShadowB: shadows?.uShadowB ?? { value: null },
      uShadowMix: shadows?.uShadowMix ?? { value: 0 },
      uShadowOn: { value: shadows ? 1 : 0 },
      uLines: { value: tex.lines },
      uLineIndex: { value: tex.index },
      uLineOrigin: { value: tex.origin },
      uCells: { value: tex.cells },
      uCount: { value: tex.count },
      uStreet: { value: srgb('#5d5851') },
      uWalk: { value: srgb('#958f83') },
      uYard: { value: srgb('#6f6a60') },
      uPlaza: { value: srgb('#8a8272') },
      uPlazaB: { value: srgb('#6f685a') },
      uPark: { value: srgb('#5f6a52') },
      uPath: { value: srgb('#93897a') },
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

export function buildSheetGround(lattice: Lattice, uniforms: AtmosphereUniforms, shadows?: ShadowUniforms): SheetGround {
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
  const width = Math.max(SAMPLES_A, SAMPLES_B) + 1;
  const table = new Float32Array(width * 2 * 4);
  const tab = new THREE.DataTexture(table, width, 2, THREE.RGBAFormat, THREE.FloatType);
  tab.minFilter = tab.magFilter = THREE.NearestFilter;
  const { material, ends } = groundMaterial(lattice, uniforms, true, { uSheetTab: { value: tab } }, shadows);
  const mesh = new THREE.Mesh(g, material);
  mesh.name = 'foldcity-ground';
  mesh.frustumCulled = false;
  mesh.renderOrder = 2; // after the buildings: they hide most of it, and its shader is the dearer one
  return {
    mesh,
    triangles: index.length / 3,
    update(state) {
      for (let i = 0; i <= SAMPLES_A; i++) table[i * 4] = state.psi[i];
      for (let i = 0, k = width * 4; i <= SAMPLES_B; i++, k += 4) {
        table[k] = state.g[i];
        table[k + 1] = state.gx[i];
        table[k + 2] = state.gy[i];
      }
      tab.needsUpdate = true;
      ends.uSheetBox.value.set(A0, A1, B1, Math.min(state.cut, 1e6));
      ends.uSheetShow.value.set(state.lip[0], state.lip[1], 1);
    },
  };
}

/** Exposed so tests can see that landmarks exist in the lattice texture's range. */
export const LANDMARK_TYPE = BLOCK_LANDMARK;
