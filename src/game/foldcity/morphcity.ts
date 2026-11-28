// The folded city of the game: one sheet of streets and buildings (sheet.ts, morphplan.ts) that shows a different
// structure in each puzzle section and folds from one into the next when a section is cleared. The ground is one mesh
// whose vertices follow the sheet, the buildings are one BatchedMesh whose instances ride it.
import * as THREE from 'three';
import type { VisualTheme } from '../../core/types.ts';
import { atmosphereUniforms, bindSky, FAR_WINDOWS, KEY_ELEVATION, patchShader, rowTone, TEX_LAYERS, TEX_NAMES, type AtmosphereParams, type AtmosphereUniforms } from './atmosphere.ts';
import { breathe } from '../frames.ts';
import { keepBuilding, keepMass, lodShown, type CityDetail } from './detail.ts';
import { gltfLoader } from '../gltf.ts';
import { LOOK } from '../look.ts';
import { ATMOSPHERE, type Background, type Prepare } from './foldcity.ts';
import { buildSheetGround, type SheetGround } from './ground.ts';
import { footprint } from './layout.ts';
import { meshName, MODELS, pickUnit, unitFamily, type UnitInfo } from './models.ts';
import { chooseUnits, type UnitChoice } from './unitpick.ts';
import { heightAt, planSteps, type KeepOut, type MorphBuilding, type MorphPlan } from './morphplan.ts';
import { PLAY, PLAY_CENTER } from './plan.ts';
import { SECTION_STRUCTURE, type Freeze } from './progression.ts';
import { rng } from './rng.ts';
import { bakeHeights, castShadows, MAP_HEIGHT, MAP_WIDTH, modelHeights, shadowTexture, type ModelHeights, type ShadowFit } from './shadow.ts';
import { A0, A1, blendState, BEND, CEILING_Y, headingAt, SLOT, copyState, GROUND_Y, makeState, restState, RING_HALF, RING_RADIUS, sheetAt, sheetFrame, STRUCTURES, Z0, type SheetState, type StructureName } from './sheet.ts';
import { skyline, type SkyMass } from './skyline.ts';
import { UNITS } from './units.ts';
import { makeFrame } from './surfaces.ts';

/** A fold from one structure into the next takes this long; with reduced motion the city fades out and back in instead. */
export const MORPH_SECONDS = 4;
const FADE_SECONDS = 0.35;
/** Cast shadows are worked out this far along the sheet from the play area (and 150 m further across it): beyond, the haze has them. */
const SHADOW_REACH = 700;

/**
 * Settles once `o` has been drawn (true), or after `ms` milliseconds without a frame that draws it (false).
 * Not a timer either: it asks again after every turn of the page's loop, a bounded number of times.
 */
const drawn = (o: THREE.Object3D, ms: number) =>
  new Promise<boolean>((resolve) => {
    const before = o.onAfterRender;
    let done = false;
    const finish = (ok: boolean) => {
      if (done) return;
      done = true;
      o.onAfterRender = before;
      resolve(ok);
    };
    o.onAfterRender = function (this: THREE.Object3D, ...args: Parameters<THREE.Object3D['onAfterRender']>) {
      before.apply(this, args);
      finish(true);
    };
    const t0 = performance.now();
    let turns = 0;
    const ask = () => {
      if (done) return;
      if (performance.now() - t0 > ms || ++turns > 200_000) finish(false);
      else void breathe().then(ask);
    };
    ask();
  });

interface Item {
  b: MorphBuilding;
  id: number;
  /** Per structure: the geometry of its near and of its far level there. */
  geometry: [number, number][];
  /** The geometry it shows now. */
  shown: number;
  /**
   * The textured unit that stands in its box, per structure (a lot's height differs between structures, and with it the
   * unit whose proportions fit), and the one it shows now; none for a tree, and none at all with `?bldg=old`.
   */
  units?: (UnitInfo | null)[];
  unit?: UnitInfo | null;
  /** The unit stands a half turn about its own up (the same unit beside itself never shows the same end). */
  turn: boolean;
  /** Its footprint along a and b. */
  foot: [number, number];
  /** How far it stands from the play volume in each structure at rest (metres): what the low detail decides by. */
  reach: number[];
  /** The frame it stands in now, its height factor (0 = not shown) and how far its base is sunk. */
  p: THREE.Vector3;
  x: THREE.Vector3;
  n: THREE.Vector3;
  z: THREE.Vector3;
  h: number;
  sink: number;
  angle: number;
  axis: THREE.Vector3;
}
interface Wave { origin: THREE.Vector3; start: number; strength: number; speed: number; dur: number }

const MAX_TILT = 0.09;
const EXTRA_SINK = 1.4;

export interface MorphCityOptions {
  /** Squares of sheet to keep free of buildings (the piers' feet). */
  keepOut?: readonly KeepOut[];
  /** Show this structure in every section (`?city=<name>`). */
  pin?: StructureName;
  freeze?: Freeze | null;
  /** Fold on and on through every structure and back (`?morph=loop`), to measure the frame time of a fold. */
  loop?: boolean;
  /** `?bgdebug=facing`: paint the background by class instead of lighting it (atmosphere.ts, bgFacing). */
  debug?: 0 | 1 | 2 | 3 | 4 | 5 | 6;
  /** `?farwin=1`: keep the fronts' windows further from the play volume at reduced contrast (atmosphere.ts, FAR_WINDOWS). */
  farWindows?: boolean;
  /** `?bgdebug=notrees`: leave the trees out of the batch (their shadows stay). */
  noTrees?: boolean;
  /** `?bgtune=key:value,...`: numbers of the city's atmosphere to try without a build (atmosphere.ts, parseTune). */
  tune?: Partial<AtmosphereParams>;
  /** `?bldg=old`: the buildings of city.glb as they were before the textured units (for comparison). */
  oldBuildings?: boolean;
  /** How much of the city is drawn (detail.ts); the quality 'low' draws less. It can be lowered while the game runs (setDetail). */
  detail?: CityDetail;
}

/**
 * The layers of buildings.glb as one array texture (512 x 256, eight layers, mipmapped: 5.6 MB on the GPU): the colour of
 * each from its own image, its weathering mask (alpha) from a channel of the three mask images. Returns the texture,
 * the mean colour of each layer (linear), which the shader's distance tone needs, and the mean colour of every row of
 * every layer as a small texture (a column a layer): what a front's storeys are from afar.
 */
function texLayers(file: { scene: THREE.Object3D }): { texture: THREE.DataArrayTexture; means: THREE.Vector3[]; rows: THREE.DataTexture } {
  const images = new Map<string, CanvasImageSource & { width: number; height: number }>();
  file.scene.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mat?.map?.image) images.set(mat.name, mat.map.image as CanvasImageSource & { width: number; height: number });
  });
  const first = images.get(`M_tx_${TEX_NAMES[0]}`);
  if (!first) throw new Error('buildings.glb has no layer images');
  const { width, height } = first;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  const read = (name: string) => {
    const image = images.get(name);
    if (!image || image.width !== width || image.height !== height) throw new Error(`buildings.glb: image ${name} is missing or of another size`);
    ctx.drawImage(image, 0, 0);
    return ctx.getImageData(0, 0, width, height).data;
  };
  const masks = [read('M_tx_mask_a'), read('M_tx_mask_b'), read('M_tx_mask_c')];
  const n = TEX_NAMES.length;
  const data = new Uint8Array(width * height * 4 * n);
  const rowData = new Uint8Array(n * height * 4);
  const lin = new Float32Array(256);
  for (let i = 0; i < 256; i++) lin[i] = i / 255 <= 0.04045 ? i / 255 / 12.92 : ((i / 255 + 0.055) / 1.055) ** 2.4;
  const srgb = (c: number) => Math.round(255 * (c <= 0.0031308 ? c * 12.92 : 1.055 * c ** (1 / 2.4) - 0.055));
  const means: THREE.Vector3[] = [];
  for (const [k, name] of TEX_NAMES.entries()) {
    const px = read(`M_tx_${name}`);
    const mask = masks[Math.floor(k / 3)];
    const sum = [0, 0, 0];
    const at = k * width * height * 4;
    for (let y = 0; y < height; y++) {
      const row = [0, 0, 0];
      for (let x = 0; x < width; x++) {
        const i = y * width + x;
        for (let c = 0; c < 3; c++) {
          data[at + i * 4 + c] = px[i * 4 + c];
          row[c] += lin[px[i * 4 + c]];
        }
        data[at + i * 4 + 3] = mask[i * 4 + (k % 3)];
      }
      for (let c = 0; c < 3; c++) {
        sum[c] += row[c];
        rowData[(y * n + k) * 4 + c] = srgb(row[c] / width);
      }
      rowData[(y * n + k) * 4 + 3] = 255;
    }
    means.push(new THREE.Vector3(sum[0], sum[1], sum[2]).divideScalar(width * height));
  }
  const texture = new THREE.DataArrayTexture(data, width, height, n);
  texture.format = THREE.RGBAFormat;
  texture.type = THREE.UnsignedByteType;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.magFilter = THREE.LinearFilter;
  texture.generateMipmaps = true;
  texture.anisotropy = 4;
  texture.needsUpdate = true;
  const rows = new THREE.DataTexture(rowData, n, height, THREE.RGBAFormat, THREE.UnsignedByteType);
  rows.colorSpace = THREE.SRGBColorSpace;
  rows.wrapS = THREE.ClampToEdgeWrapping;
  rows.wrapT = THREE.RepeatWrapping;
  rows.minFilter = rows.magFilter = THREE.LinearFilter;
  rows.needsUpdate = true;
  return { texture, means, rows };
}

/** The mesh of a unit at a level of detail, by its name in buildings.glb (a prop is one mesh). */
const unitMesh = (u: UnitInfo, lod: 0 | 1) => (u.family === 'prop' ? u.name : `${u.name}_lod${lod}`);

/** A geometry's colours as four floats a vertex (the city's models carry three, the textured units four as normalized shorts): one batch needs them alike. */
function colour4(geometry: THREE.BufferGeometry) {
  const src = geometry.getAttribute('color');
  if (src.itemSize === 4 && !src.normalized && src.array instanceof Float32Array) return;
  const out = new Float32Array(src.count * 4);
  for (let i = 0; i < src.count; i++) {
    out[i * 4] = src.getX(i);
    out[i * 4 + 1] = src.getY(i);
    out[i * 4 + 2] = src.getZ(i);
    out[i * 4 + 3] = src.itemSize === 4 ? src.getW(i) : 1;
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(out, 4));
}

export class MorphCity implements Background {
  readonly group = new THREE.Group();
  plan: MorphPlan | null = null;
  stats = { instances: 0, groundTriangles: 0 };
  /** How long the folds' warm-up took at load, in ms. */
  warmMs = 0;
  /** Where the load's time went, in ms (read through the debug hook when the load is measured). */
  timings: Record<string, number> = {};
  private readonly theme: VisualTheme;
  private readonly opts: MorphCityOptions;
  private items: Item[] = [];
  /** The far skyline of the open canyon (skyline.ts): instances of the same batch, standing where they stand for good. */
  private sky: { id: number; mass: SkyMass; k: [number, number, number]; open: THREE.Matrix4 }[] = [];
  /** `?bgdebug=unit0..2`: the colour that says which unit a building shows (three bits of its number). */
  private unitCode: ((it: Item) => [number, number, number]) | null = null;
  private readonly c4 = new THREE.Vector4();
  /** Where the far skyline stands: 0 = on the open canyon's flat far end, 1 = round the far end of the tube (pose). */
  private skyRing = 0;
  private mesh: THREE.BatchedMesh | null = null;
  private ground: SheetGround | null = null;
  private atm: AtmosphereUniforms | null = null;
  /**
   * The cast shadows (shadow.ts): a map per structure, worked out a few rows a frame after loading and kept; the ground
   * reads two textures (each holding the map of the structure in `shadowSlot`) and blends them through a fold.
   */
  private readonly modelH = new Map<number, ModelHeights>();
  /** The height field of each textured unit (its far mesh), by its name, and the building each plan entry is drawn as. */
  private readonly unitH = new Map<string, ModelHeights>();
  private readonly itemOf = new Map<MorphBuilding, Item>();
  private readonly shadowMaps: (Uint8Array | null)[] = STRUCTURES.map(() => null);
  private shadowJob: { si: number; out: Uint8Array; steps: Generator<void, void> } | null = null;
  private readonly shadowTex = [shadowTexture(), shadowTexture()];
  private readonly shadowSlot = [-1, -1];
  private readonly shadows = { uShadowA: { value: this.shadowTex[0] as THREE.Texture | null }, uShadowB: { value: this.shadowTex[1] as THREE.Texture | null }, uShadowMix: { value: 0 } };
  private heightScratch: Uint8Array | null = null;
  private warming = false;
  private sinceLoad = 0;
  private nextShadowAt = 2;
  private slot: THREE.Mesh | null = null;
  private readonly caps: THREE.Mesh[] = [];
  private readonly slotOn = { value: new THREE.Vector2(1, 0) };
  private waves: Wave[] = [];
  private skyShown = true;
  /** The detail changed: the skyline's masses are put again at the next pose. */
  private skyStale = false;
  private detail: CityDetail;
  private time = 0;
  /** What is shown: structure `from` at rest, or a fraction `f` of the way to `to`. */
  private from = 0;
  private to = 0;
  private f = 0;
  /** A fold under way (seconds run), or a fade (reduced motion): out, switch, in. */
  private morph: { t: number } | null = null;
  private fade: { t: number; target: number; switched: boolean } | null = null;
  private loopStep = 1;
  private readonly state: SheetState = makeState();
  private readonly frame = makeFrame();
  private readonly m4 = new THREE.Matrix4();
  private readonly m5 = new THREE.Matrix4();
  private readonly tmp = new THREE.Vector3();
  private readonly t1 = new THREE.Vector3();
  private readonly t2 = new THREE.Vector3();
  private readonly t3 = new THREE.Vector3();

  constructor(theme: VisualTheme, opts: MorphCityOptions = {}) {
    this.theme = theme;
    this.opts = opts;
    this.detail = opts.detail ?? 'full';
    if (opts.freeze) ({ from: this.from, to: this.to, f: this.f } = opts.freeze);
    else this.from = this.to = this.structureOf(0);
  }

  private structureOf(section: number): number {
    const name = this.opts.pin ?? SECTION_STRUCTURE[Math.min(Math.max(section, 0), SECTION_STRUCTURE.length - 1)];
    return STRUCTURES.indexOf(name);
  }

  async load(url: string, prepare?: Prepare) {
    // everything is put together off the scene and only shown once its shaders are compiled (prepare): the first frame that
    // draws the city is then an ordinary frame, where compiling in that frame held the page for about a second
    const stage = new THREE.Group();
    // the buildings, and beside them the props (trees, fountains, the piers' feet): one batch, the buildings' material
    const loader = gltfLoader(); // (buildings.glb is Draco-compressed: gltf.ts)
    let t0 = performance.now();
    const lap = (name: string) => {
      this.timings[name] = Math.round(performance.now() - t0);
      t0 = performance.now();
    };
    // the two files load while the city is planned (the plan needs neither): the plan's second or so of work no longer waits
    // for the download and the parsing, which go on between its slices
    // (the buildings are the textured units of buildings.glb; `?bldg=old` loads those of city.glb instead. The trees are in cityprops.glb either way)
    const old = !!this.opts.oldBuildings;
    const assets = Promise.all([old ? loader.loadAsync(url) : null, loader.loadAsync(url.replace(/city\.glb$/, 'cityprops.glb')), old ? null : loader.loadAsync(url.replace(/city\.glb$/, 'buildings.glb'))]);
    assets.catch(() => {}); // (a failed load is reported where it is awaited, below)
    // planned in slices of about 50 ms, so the page keeps drawing while it loads (a few longer frames rather than one for
    // each of the plan's forty-odd steps)
    const steps = planSteps(this.theme.city.seed, this.opts.keepOut);
    let step = steps.next();
    let slice = performance.now();
    while (!step.done) {
      if (performance.now() - slice > 50) {
        await breathe();
        slice = performance.now();
      }
      step = steps.next();
    }
    const plan = step.value;
    this.plan = plan;
    lap('plan');
    const [gltf, props, units] = await assets;
    lap('assets');
    const atm = atmosphereUniforms({ ...ATMOSPHERE, ...this.opts.tune });
    this.atm = atm;
    if (this.opts.debug) atm.uBgDebug.value = this.opts.debug;
    if (this.opts.farWindows) {
      const win = atm.uBgWin.value as THREE.Vector4;
      win.set(win.x, win.y, FAR_WINDOWS, 1);
    }

    const modelH = this.modelH;
    const ground = buildSheetGround(plan.lattice, atm, this.shadows);
    ground.mesh.onBeforeRender = (_r, scene) => bindSky(atm, scene);
    this.ground = ground;
    this.stats.groundTriangles = ground.triangles;
    stage.add(ground.mesh);

    // the two far ends of the sheet: a plane of plain haze across each, so the end of the channel and of the tube is haze and
    // not a window of sky in the shape of their cross-section. It follows the same rule as everything far (atmosphere.ts,
    // bgFar): in the open canyon, and above the channel's ceiling, it is the sky itself and cannot be seen.
    // (the caps and the slot's haze below share one program: uVeil = (1 for the slot's haze, how much of it: up to 1 as much
    // as the distance gives, from 1 to 2 the rest as well, so the last slit of a closing slot is haze before its edges meet))
    const veilMaterial = (uVeil: THREE.IUniform, depthWrite: boolean) => {
      const m = new THREE.MeshStandardMaterial({ color: 0x000000, roughness: 1, metalness: 0, fog: false, side: THREE.DoubleSide, transparent: true, depthWrite });
      m.onBeforeCompile = (shader) =>
        patchShader(shader, atm, {
          light: 'vec3( 0.0 )', uniforms: { uVeil }, fragmentDecl: 'uniform vec2 uVeil;',
          // (the slot's haze fades with the city in the reduced-motion fade; in the debug views it counts as city where it hides the sky)
          fragmentEnd: 'float slotA = mix( bgFog * min( uVeil.y, 1.0 ), 1.0, clamp( uVeil.y - 1.0, 0.0, 1.0 ) ) * ( 1.0 - uBgVeil ); gl_FragColor = uVeil.x < 0.5 ? vec4( gl_FragColor.rgb, 1.0 ) : uBgDebug > 0.5 ? vec4( 0.0, 0.6, 0.0, step( 0.5, slotA ) ) : vec4( bgHazeCol, slotA );',
        });
      m.customProgramCacheKey = () => 'foldcity-veil';
      return m;
    };
    const capMaterial = veilMaterial({ value: new THREE.Vector2(0, 1) }, true);
    // (one small piece of it far below everything is always drawn, so the program is compiled while the page loads and not
    // in the first frame of the first fold)
    const seed = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), capMaterial);
    seed.position.set(0, GROUND_Y - 300, Z0);
    seed.frustumCulled = false;
    stage.add(seed);
    for (const a of [A0 + 2, A1 - 2]) {
      // (no higher than a little over the ceiling: above that it would be sky, and drawing it costs the whole sky's pixels)
      const top = CEILING_Y + 60;
      const cap = new THREE.Mesh(new THREE.PlaneGeometry(3200, top - (GROUND_Y - 40)), capMaterial);
      cap.rotation.y = Math.PI / 2;
      cap.position.set(a, (top + GROUND_Y - 40) / 2, Z0);
      cap.name = 'foldcity-cap';
      cap.frustumCulled = false;
      cap.renderOrder = 3;
      this.caps.push(cap);
      stage.add(cap);
    }

    // the haze in the channel's slot: the sky seen through the slot lies behind as much haze as the ceiling beside it, so
    // far along the channel the slot closes into the haze instead of standing blue between two ruled edges. A strip just
    // above the ceiling, drawn over the sky with the haze's colour and as much of it as its distance gives.
    const slotMaterial = veilMaterial(this.slotOn, false);
    const slot = new THREE.Mesh(new THREE.PlaneGeometry(A1 - A0, 2 * (SLOT + BEND)), slotMaterial);
    slot.rotation.x = Math.PI / 2;
    slot.position.set((A0 + A1) / 2, CEILING_Y + 2, Z0);
    slot.name = 'foldcity-slot';
    slot.frustumCulled = false;
    slot.renderOrder = 4; // after the ground: over the sky and the slot's far walls
    this.slot = slot;
    stage.add(slot);

    const list = plan.buildings.filter((b) => b.alive.some(Boolean));
    const sources = new Map<string, THREE.Mesh>();
    let vertices = 0;
    let indices = 0;
    const source = (key: string, file: { scene: THREE.Object3D }, fileName: string) => {
      const have = sources.get(key);
      if (have) return have;
      const src = file.scene.getObjectByName(key) as THREE.Mesh | undefined;
      if (!src?.isMesh) throw new Error(`${fileName} has no mesh "${key}"`);
      sources.set(key, src);
      vertices += src.geometry.getAttribute('position').count;
      indices += src.geometry.index!.count;
      return src;
    };
    // which textured unit stands in each lot's box, structure by structure (unitpick.ts)
    const unitsOf = units ? chooseUnits(list, this.theme.city.seed) : new Map<MorphBuilding, UnitChoice>();
    for (const b of list) {
      const m = MODELS[b.model];
      const own = unitsOf.get(b);
      if (own) for (const u of own.units) for (const lod of [0, 1] as const) source(unitMesh(u!, lod), units!, 'buildings.glb');
      else for (const lod of [0, 1] as const) source(meshName(m, lod), m.props ? props : gltf!, m.props ? 'cityprops.glb' : 'city.glb');
    }
    // the far skyline is made of far models, some of which may stand nowhere in the city itself
    const farOnly = this.detail === 'low'; // (the near models are never shown: they are not put on the GPU either)
    const masses = skyline(this.theme.city.seed).filter((m) => keepMass(this.detail, m));
    const massUnit = new Map<SkyMass, UnitInfo>();
    {
      const pick = rng(this.theme.city.seed * 19 + 7);
      let before: UnitInfo | null = null;
      for (const mass of masses) {
        const m = MODELS[mass.model];
        const p = pick();
        const u: UnitInfo | null = units ? pickUnit(UNITS, m, m.w, m.h * mass.sy, p, before, null, unitFamily(m, pick())) : null;
        if (u) {
          massUnit.set(mass, u);
          before = u;
          source(unitMesh(u, 1), units!, 'buildings.glb');
        } else source(meshName(m, 1), m.props ? props : gltf!, m.props ? 'cityprops.glb' : 'city.glb');
      }
    }
    for (const [i, m] of MODELS.entries()) {
      const far = sources.get(meshName(m, 1));
      if (far) modelH.set(i, modelHeights(far.geometry));
      const src = sources.get(meshName(m, 0));
      if (!src) continue;
      src.geometry.computeBoundingBox();
      const bb = src.geometry.boundingBox!;
      const off = Math.abs(bb.max.x - bb.min.x - m.w) + Math.abs(bb.max.z - bb.min.z - m.d) + Math.abs(bb.max.y - m.h);
      const centre = Math.abs((bb.max.x + bb.min.x) / 2 - m.cx) + Math.abs((bb.max.z + bb.min.z) / 2 - m.cz);
      if (off + centre > 1.5) console.warn(`foldcity/models.ts disagrees with the GLB for ${m.name} (off by ${(off + centre).toFixed(1)} m)`);
    }
    const tuned = { ...ATMOSPHERE, ...this.opts.tune };
    let material: THREE.MeshStandardMaterial;
    if (units) {
      // the textured units' layers as an array texture, in one material (one draw call). Its map is one white texel: a
      // face that shows no layer (glass, rails, pots, gilt, the trees) is its vertex colour
      const layers = texLayers(units);
      if (layers.means.length !== TEX_LAYERS) throw new Error('buildings.glb: wrong number of layers');
      atm.uBgTex.value = layers.texture;
      atm.uBgTexRow.value = layers.rows;
      (atm.uBgTexMean.value as THREE.Vector3[]).forEach((v, k) => v.copy(layers.means[k]));
      const white = new THREE.DataTexture(new Uint8Array([255, 255, 255, 255]), 1, 1, THREE.RGBAFormat, THREE.UnsignedByteType);
      white.colorSpace = THREE.SRGBColorSpace;
      white.needsUpdate = true;
      material = new THREE.MeshStandardMaterial({ map: white, vertexColors: true, roughness: 0.85, metalness: 0 });
      material.name = 'M_city';
      for (const src of sources.values()) colour4(src.geometry);
      for (const u of UNITS) {
        const src = sources.get(unitMesh(u, 0));
        if (!src) continue;
        this.unitH.set(u.name, modelHeights((sources.get(unitMesh(u, 1)) ?? src).geometry));
        src.geometry.computeBoundingBox();
        const bb = src.geometry.boundingBox!;
        const off = Math.abs(bb.max.x - bb.min.x - u.w) + Math.abs(bb.max.z - bb.min.z - u.d) + Math.abs(bb.max.y - u.top) + Math.abs((bb.max.x + bb.min.x) / 2 - u.cx) + Math.abs((bb.max.z + bb.min.z) / 2 - u.cz);
        if (off > 1.5) console.warn(`foldcity/units.ts disagrees with buildings.glb for ${u.name} (off by ${off.toFixed(1)} m)`);
      }
    } else {
      material = (gltf!.scene.getObjectByName(meshName(MODELS[0], 0)) as THREE.Mesh).material as THREE.MeshStandardMaterial;
      if (material.map) material.map.anisotropy = 4;
      const tone = material.map ? rowTone(material.map, tuned.rowBand, tuned.rowEven) : null;
      if (tone) {
        atm.uBgRowTone.value = tone;
        atm.uBgRowOn.value = 1;
      }
    }
    material.fog = false;
    material.onBeforeCompile = (shader) => patchShader(shader, atm, { tex: !!units });
    material.customProgramCacheKey = () => (units ? 'foldcity-buildings-tex' : 'foldcity-buildings');

    // (the low detail never shows a near model: it is not put on the GPU either, and its far model stands in for it)
    const isNear = (key: string) => farOnly && key.endsWith('_lod0') && sources.has(key.replace(/_lod0$/, '_lod1'));
    if (farOnly) {
      vertices = indices = 0;
      for (const [key, src] of sources)
        if (!isNear(key)) {
          vertices += src.geometry.getAttribute('position').count;
          indices += src.geometry.index!.count;
        }
    }
    const mesh = new THREE.BatchedMesh(list.length + masses.length, vertices, indices, material);
    mesh.sortObjects = false;
    mesh.frustumCulled = false; // its instances move with the sheet; each is still culled on its own
    mesh.name = 'foldcity-buildings';
    mesh.renderOrder = 1; // after the play area, before the ground
    const ids = new Map<string, number>();
    for (const [key, src] of sources) if (!isNear(key)) ids.set(key, mesh.addGeometry(src.geometry));
    for (const key of sources.keys()) if (isNear(key)) ids.set(key, ids.get(key.replace(/_lod0$/, '_lod1'))!);
    const rTint = rng(this.theme.city.seed * 13 + 5);
    const tint = new THREE.Vector4();
    // `?bgdebug=unit0..2`: three bits of (the unit's number, its half turn) as the instance's colour; 0 = not a building
    const codeBits = (code: number) => {
      const k = ((this.opts.debug ?? 0) - 4) * 3;
      return [(code >> k) & 1, (code >> (k + 1)) & 1, (code >> (k + 2)) & 1].map((bit) => bit * 0.6) as [number, number, number];
    };
    const unitCode = (u: UnitInfo | null | undefined, turn: boolean) => (u && u.family !== 'prop' ? (UNITS.indexOf(u) + 1) * 2 + (turn ? 1 : 0) : 0);
    this.unitCode = (this.opts.debug ?? 0) >= 4 ? (it) => codeBits(unitCode(it.unit, it.turn)) : null;
    const rests = STRUCTURES.map((name) => restState(name));
    const reachAt = new THREE.Vector3();
    for (const b of list) {
      const own = unitsOf.get(b);
      const m = MODELS[b.model];
      const geometry = STRUCTURES.map((_, si): [number, number] => {
        const u = own?.units[si];
        return u ? [ids.get(unitMesh(u, 0))!, ids.get(unitMesh(u, 1))!] : [ids.get(meshName(m, 0))!, ids.get(meshName(m, 1))!];
      });
      const id = mesh.addInstance(geometry[0][1]);
      mesh.setVisibleAt(id, false); // until the first pose puts it on the sheet
      // a tone and a warmth per block (about 11 % either way: the brief's stone by stone), and 6 % more per house: seen from
      // far a wall of city is houses of different stone, where one tone made it a band
      const cell = b.lot.cell >= 0 ? plan.lattice.cells[b.lot.cell].r : 0.5;
      const h1 = Math.sin(cell * 91.7 + 3.1) * 43758.5453;
      const h2 = Math.sin(cell * 57.3 + 1.7) * 24634.6345;
      const prop = MODELS[b.model].kind === 'prop';
      const v = 0.94 * (prop ? 0.96 + rTint() * 0.08 : 0.89 + (h1 - Math.floor(h1)) * 0.22) * (prop ? 0.98 + rTint() * 0.04 : 0.94 + rTint() * 0.12);
      const warm = prop ? (rTint() - 0.5) * 0.05 : (h2 - Math.floor(h2) - 0.5) * 0.1 + (rTint() - 0.5) * 0.02;
      // the alpha carries the number of the building's block: with it the building goes into the far haze when its block does (atmosphere.ts, bgFar)
      mesh.setColorAt(id, tint.set(v * (1 + warm), v, v * (1 - warm), b.lot.cell >= 0 ? Math.round(cell * 255) / 255 : 0.5));
      const item: Item = {
        b, id, geometry, shown: geometry[0][1], units: own?.units, unit: own?.units[0], turn: own?.turn ?? false, foot: footprint(MODELS[b.model], b.lot.scale, b.lot.swap, b.lot.stretch),
        reach: rests.map((st) => PLAY.distanceToPoint(sheetAt(st, b.lot.u, b.lot.v, reachAt))), p: new THREE.Vector3(), x: new THREE.Vector3(1, 0, 0), n: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1),
        h: 0, sink: 0.5, angle: 0, axis: new THREE.Vector3(1, 0, 0),
      };
      this.items.push(item);
      this.itemOf.set(b, item);
      if (this.unitCode) mesh.setColorAt(id, tint.set(...this.unitCode(item), tint.w));
    }
    // the far skyline: upright on the flat far end of the open canyon's sheet, sunk a little, each in its row's haze (the
    // instance colour's alpha from 2 on says so: atmosphere.ts, bgSkyline)
    const open = restState('horizon');
    const at = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const up = new THREE.Vector3(0, 1, 0);
    for (const mass of masses) {
      const m = MODELS[mass.model];
      const u = massUnit.get(mass);
      const id = mesh.addInstance(ids.get(u ? unitMesh(u, 1) : meshName(m, 1))!);
      // (a unit is fitted to the model's box, as in the city)
      const k: [number, number, number] = u ? [m.w / u.w, m.h / u.h, m.d / u.d] : [1, 1, 1];
      sheetAt(open, mass.a, mass.b, at);
      q.setFromAxisAngle(up, (mass.turn * Math.PI) / 2);
      this.m4.compose(at.setY(at.y - 6), q, this.tmp.set(mass.scale * k[0], mass.scale * mass.sy * k[1], mass.scale * k[2]));
      // (the model's own centre stays where it is: a metre or two at this distance)
      mesh.setMatrixAt(id, this.m4);
      const v = 0.9 + rTint() * 0.1;
      mesh.setColorAt(id, tint.set(v, v, v, 2 + mass.layer));
      if (this.unitCode) mesh.setColorAt(id, tint.set(...codeBits(unitCode(u, false)), 2 + mass.layer));
      this.sky.push({ id, mass, k, open: this.m4.clone() });
    }
    this.stats.instances = list.length + masses.length;
    this.mesh = mesh;
    stage.add(mesh);
    // (the shadow map of the structure shown is made by the first pose; those of the others a little later: shadowWork)
    lap('build');
    this.warm();
    this.pose();
    lap('pose');
    if (prepare) await prepare(stage).catch(() => {});
    lap('compile');
    // and its parts enter one at a time, each once the one before has been drawn: the graphics driver finishes a shader the
    // first time something is drawn with it (the ground's takes about 0.6 s, the far ends' 0.15 s, the buildings' 0.1 s on the
    // PC this was measured on), so the wait is three shorter frames, all before the game says it is ready, and not one of
    // nearly a second after it. (Without `prepare`, as in the review shots and the frame-by-frame capture, where frames are drawn on demand, nothing is waited for.)
    let live = !!prepare;
    for (const o of [...stage.children]) {
      this.group.add(o);
      if (live && o.visible) live = await drawn(o, 400);
    }
    lap('enter');
  }

  /**
   * Run every fold once, a few fractions each way, before the city is first shown: the fold's code is compiled and its
   * tables have been through the blend by the time a player clears the first section. Costs a few poses at load.
   */
  private warm() {
    const t0 = performance.now();
    this.warming = true;
    const shown = { from: this.from, to: this.to, f: this.f };
    for (let k = 0; k < 3; k++)
      for (let i = 0; i + 1 < STRUCTURES.length; i++)
        for (const [from, to] of [[i, i + 1], [i + 1, i]])
          for (const f of [0.15, 0.5, 0.85]) {
            Object.assign(this, { from, to, f });
            this.pose();
          }
    Object.assign(this, shown);
    this.warming = false;
    this.warmMs = performance.now() - t0;
  }

  /**
   * The game entered a section. `fold` folds the city there from the structure before it (when the two are neighbours);
   * otherwise, and in the review shots, it is simply there. `reduceMotion` replaces the fold by a short fade.
   */
  setSection(section: number, fold = false, reduceMotion = false) {
    if (this.opts.freeze || this.opts.loop) return;
    const target = this.structureOf(section);
    const shown = this.morph || this.from !== this.to ? this.to : this.from;
    if (this.fade && fold && reduceMotion) {
      this.fade.target = target;
      return;
    }
    if (target === shown && !this.fade) return;
    if (fold && reduceMotion) {
      this.rest(shown);
      this.fade = { t: 0, target, switched: false };
    } else if (fold && Math.abs(target - shown) === 1) {
      this.rest(shown);
      this.to = target;
      this.morph = { t: 0 };
    } else {
      this.fade = null;
      this.setVeil(0);
      this.rest(target);
    }
  }

  /**
   * Draw less of the city (detail.ts), now: the buildings show their far models, those out of reach and the far trees are
   * not drawn, the skyline thins. Only lowers (what a detail leaves out of the batch at load cannot come back).
   */
  setDetail(detail: CityDetail) {
    if (detail === this.detail) return;
    this.detail = detail;
    this.skyStale = true;
    this.pose();
  }

  private rest(structure: number) {
    this.morph = null;
    if (this.from === structure && this.to === structure && this.f === 0) return;
    this.from = this.to = structure;
    this.f = 0;
    this.pose();
  }

  private setVeil(v: number) {
    if (this.atm) this.atm.uBgVeil.value = v;
  }

  /** Put the ground and every building where the current structure, or the current fraction of a fold, has them. */
  private pose() {
    if (!this.mesh || !this.ground) return;
    const resting = this.from === this.to || this.f <= 0;
    const arrived = this.from !== this.to && this.f >= 1;
    const at = arrived ? this.to : this.from;
    // the plan's transitions run forwards (STRUCTURES[i] to STRUCTURES[i + 1]); a fold back reads them in reverse
    const ti = Math.min(this.from, this.to);
    const fwd = this.from < this.to ? this.f : 1 - this.f;
    if (resting || arrived) copyState(restState(STRUCTURES[at]), this.state);
    else blendState({ from: STRUCTURES[this.from], to: STRUCTURES[this.to] }, this.f, this.state);
    this.ground.update(this.state);
    const still = resting || arrived;
    // the canyon is open to the sky; the channel and the tube are closed (atmosphere.ts, bgFar)
    // the slot's haze comes with the channel's ceiling (the last third of the fold into it) and leaves when the tube has closed
    this.slotOn.value.y = still ? (at === 1 ? 1 : 0) : ti === 0 ? Math.min(1, Math.max(0, (fwd - 0.6) / 0.4)) : 1 + Math.min(1, Math.max(0, (fwd - 0.4) / 0.4));
    if (this.slot) this.slot.visible = this.slotOn.value.y > 0;
    const open = still ? (at === 0 ? 1 : 0) : ti === 0 ? 1 - fwd : 0;
    if (this.atm) (this.atm.uBgFarSky.value as THREE.Vector2).set(open, CEILING_Y);
    // (in the open canyon the caps are all sky: not drawn)
    for (const cap of this.caps) cap.visible = open < 1;
    // the far skyline belongs to the open canyon: it goes into the haze all through the fold that closes it (evenly: the fold's pace is the sheet's)
    // and it stands again at the far end of the tube, round its wall, the same masses layer behind layer: without them the
    // tube ended in a core of plain haze over the goal (the final review). They come out of the haze in the second half
    // of the fold into the tube. The channel between the two has none (its slot's haze stays as it is).
    const ring = still ? (at === 2 ? 1 : 0) : ti === 1 ? Math.min(1, Math.max(0, (fwd - 0.5) / 0.5)) : 0;
    const show = Math.min(1, Math.max(0, Math.max(open, ring)));
    if (this.atm) this.atm.uBgSkyShow.value = show;
    const inRing = ring > 0 ? 1 : 0;
    if (this.skyStale || show > 0 !== this.skyShown || inRing !== this.skyRing || (inRing && !still)) {
      this.skyStale = false;
      this.skyShown = show > 0;
      this.skyRing = inRing;
      for (const s of this.sky) {
        // (round the tube only the masses whose place lies on it, clear of its seam; none taller than four fifths of its radius)
        const on = this.skyShown && keepMass(this.detail, s.mass) && (!inRing || Math.abs(s.mass.b) < RING_HALF - 40);
        this.mesh.setVisibleAt(s.id, on);
        if (!on) continue;
        if (!inRing) {
          this.mesh.setMatrixAt(s.id, s.open);
          continue;
        }
        const m = MODELS[s.mass.model];
        const f = sheetFrame(this.state, s.mass.a, s.mass.b, this.frame);
        const along = s.mass.turn % 2 === 0 ? f.ev : f.eu;
        this.t1.copy(along).multiplyScalar(s.mass.turn >= 2 ? -1 : 1);
        this.t3.crossVectors(this.t1, f.n);
        const sy = Math.min(s.mass.sy, (0.8 * RING_RADIUS) / (m.h * s.mass.scale));
        this.m4.makeBasis(this.t1.multiplyScalar(s.mass.scale * s.k[0]), this.t2.copy(f.n).multiplyScalar(s.mass.scale * sy * s.k[1]), this.t3.multiplyScalar(s.mass.scale * s.k[2]));
        this.m4.setPosition(this.tmp.copy(f.p).addScaledVector(f.n, -6));
        this.mesh.setMatrixAt(s.id, this.m4);
      }
    }
    // the cast shadows: those of the structure the city rests in, or the two of a fold blended as it goes
    if (this.warming) {
      // (the warm-up's poses are never drawn: no shadow map is made for them)
    } else if (still) this.showShadows(at, at, 0);
    else this.showShadows(this.from, this.to, this.f * this.f * (3 - 2 * this.f));
    for (const it of this.items) {
      const { b } = it;
      const h = still ? (b.alive[at] ? b.sy[at] : 0) : heightAt(b, ti, fwd);
      // (its level of detail and its unit are those of the structure it is nearer to: they change half-way through a fold)
      const si = still ? at : fwd < 0.5 ? ti : ti + 1;
      if (h <= 0 || (this.opts.noTrees && MODELS[b.model].name.startsWith('tree_')) || !keepBuilding(this.detail, MODELS[b.model], it.reach[si])) {
        if (it.h > 0) this.mesh.setVisibleAt(it.id, false);
        it.h = 0;
        continue;
      }
      const shown = it.geometry[si][lodShown(this.detail, b.lod[si])];
      if (shown !== it.shown) {
        this.mesh.setGeometryIdAt(it.id, shown);
        it.shown = shown;
      }
      if (it.units && it.unit !== it.units[si]) {
        it.unit = it.units[si];
        if (this.unitCode) {
          this.mesh.getColorAt(it.id, this.c4);
          this.mesh.setColorAt(it.id, this.c4.set(...this.unitCode(it), this.c4.w));
        }
      }
      if (it.h <= 0) this.mesh.setVisibleAt(it.id, true);
      it.h = h;
      const f = sheetFrame(this.state, b.lot.u, b.lot.v, this.frame);
      it.p.copy(f.p);
      it.n.copy(f.n);
      it.x.copy(b.lot.swap ? f.ev : f.eu).multiplyScalar(b.lot.flip ? -1 : 1);
      it.z.crossVectors(it.x, it.n);
      // while the sheet bends its curl lies between the two structures', and so does the seat (nothing jumps on arrival)
      if (still) it.sink = b.sink[at];
      else if (b.alive[ti] && b.alive[ti + 1]) it.sink = b.sink[ti] + (b.sink[ti + 1] - b.sink[ti]) * fwd;
      else it.sink = b.alive[ti] ? b.sink[ti] : b.sink[ti + 1];
      this.write(it);
    }
  }

  /** The shadow map of structure `si`, worked out now if it has not been yet (some 0.1 to 0.2 s). */
  private shadowMap(si: number): Uint8Array | null {
    if (!this.plan || !this.modelH.size) return null;
    const done = this.shadowMaps[si];
    if (done) return done;
    const job = this.shadowJob?.si === si ? this.shadowJob : this.startShadowJob(si);
    for (;;) if (job.steps.next().done) break;
    if (this.shadowJob === job) this.shadowJob = null;
    return (this.shadowMaps[si] = job.out);
  }

  private startShadowJob(si: number) {
    const state = restState(STRUCTURES[si]);
    this.heightScratch ??= new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    bakeHeights(this.heightScratch, this.modelH, this.plan!.buildings, si, EXTRA_SINK, this.unitH.size ? (b, k) => this.shadowFit(b, k) : undefined);
    const out = new Uint8Array(MAP_WIDTH * MAP_HEIGHT);
    // (the heights are copied: the next structure's job draws over the scratch)
    const steps = castShadows(this.heightScratch.slice(), out, (a, d) => headingAt(state, a, d), { slope: Math.tan(KEY_ELEVATION), sun: LOOK.sunDir }, [PLAY_CENTER.x - SHADOW_REACH, PLAY_CENTER.x + SHADOW_REACH], Math.min(state.cut, SHADOW_REACH + 150), 4);
    return { si, out, steps };
  }

  /** The unit that stands in a building's box in structure `si`, for the shadows (shadow.ts): its height field and how it is fitted. */
  private shadowFit(b: MorphBuilding, si: number): ShadowFit | undefined {
    const it = this.itemOf.get(b);
    const u = it?.units?.[si];
    const mh = u && this.unitH.get(u.name);
    if (!u || !mh) return undefined;
    const m = MODELS[b.model];
    return { mh, kx: m.w / u.w, ky: m.h / u.h, kz: m.d / u.d, cx: u.cx, cz: u.cz, turn: it!.turn };
  }

  /**
   * Make one shadow map that is still missing, whole: about 20 ms (measured), one frame that takes two. (Spread over many
   * frames at 2 ms each it cost more: every one of those frames missed its refresh on a busy GPU.)
   */
  private shadowWorkWhole() {
    if (!this.plan || !this.modelH.size) return;
    const si = this.shadowMaps.findIndex((m) => !m);
    if (si >= 0) this.shadowMap(si);
  }

  /** Show the shadows of structure `from`, a share `w` of the way to those of `to`. */
  private showShadows(from: number, to: number, w: number) {
    const put = (slot: number, si: number) => {
      const map = this.shadowMap(si);
      if (!map) return;
      (this.shadowTex[slot].image.data as Uint8Array).set(map);
      this.shadowTex[slot].needsUpdate = true;
      this.shadowSlot[slot] = si;
    };
    if (from === to || w <= 0 || w >= 1) {
      const si = w >= 1 ? to : from;
      let slot = this.shadowSlot.indexOf(si);
      if (slot < 0) put((slot = this.shadows.uShadowMix.value < 0.5 ? 1 : 0), si); // into the texture not being shown
      if (this.shadowSlot[slot] === si) this.shadows.uShadowMix.value = slot;
      return;
    }
    let a = this.shadowSlot.indexOf(from);
    if (a < 0) put((a = this.shadowSlot[0] === to ? 1 : 0), from);
    if (this.shadowSlot[1 - a] !== to) put(1 - a, to);
    this.shadows.uShadowMix.value = a === 0 ? w : 1 - w;
  }

  /** Compose a building's matrix: its frame on the sheet, sunk, at its height, tilted by its wave angle about its base. */
  private write(it: Item) {
    const m = MODELS[it.b.model];
    const s = it.b.lot.scale;
    const sx = s * (it.b.lot.stretch ?? 1);
    // (a textured unit fills the model's box: the lot, the plan and the shadows stay the model's; `turn` stands it a half turn round)
    const u = it.unit ?? undefined;
    const t = it.turn ? -1 : 1;
    const kx = u ? m.w / u.w : 1;
    const ky = u ? m.h / u.h : 1;
    const kz = u ? m.d / u.d : 1;
    this.m4.makeBasis(this.t1.copy(it.x).multiplyScalar(sx * kx * t), this.t2.copy(it.n).multiplyScalar(s * it.h * ky), this.t3.copy(it.z).multiplyScalar(s * kz * t));
    // (the model's own centre: a unit's centre lies where its mesh has it, the lot's centre where the model's was)
    this.tmp.set(0, 0, 0).addScaledVector(it.x, -(u ? u.cx * kx : m.cx) * sx * t).addScaledVector(it.z, -(u ? u.cz * kz : m.cz) * s * t).addScaledVector(it.n, -(it.sink + EXTRA_SINK));
    this.m4.setPosition(this.tmp);
    if (it.angle !== 0) {
      this.m5.makeRotationAxis(it.axis, it.angle).multiply(this.m4);
      this.m4.copy(this.m5);
    }
    const e = this.m4.elements;
    this.m4.setPosition(e[12] + it.p.x, e[13] + it.p.y, e[14] + it.p.z);
    this.mesh!.setMatrixAt(it.id, this.m4);
  }

  wave(origin: THREE.Vector3, strength = 0.35, speed = 90, dur = 1.6) {
    this.waves.push({ origin: origin.clone(), start: this.time, strength, speed, dur });
  }

  /** Back to time zero: no wave, no fold under way (the city rests in the structure it was folding to). */
  reset() {
    this.time = 0;
    this.waves = [];
    for (const it of this.items) it.angle = 0;
    this.fade = null;
    this.setVeil(0);
    if (this.opts.freeze) {
      ({ from: this.from, to: this.to, f: this.f } = this.opts.freeze);
      this.pose();
    } else {
      const target = this.to;
      this.from = -1; // force the pose: the waves' tilts are gone
      this.rest(target);
    }
  }

  update(dt: number) {
    this.time += dt;
    if (this.atm && this.group.parent) bindSky(this.atm, this.group.parent as THREE.Scene);
    if (!this.mesh) return;
    // the shadow maps of the other structures: one about every second and a half from two seconds after the city appears
    this.sinceLoad += dt;
    if (this.sinceLoad > this.nextShadowAt && !this.morph) {
      this.shadowWorkWhole();
      this.nextShadowAt = this.sinceLoad + 1.5;
    }
    let posed = false;
    if (this.opts.loop && !this.morph) {
      if (this.to + this.loopStep < 0 || this.to + this.loopStep >= STRUCTURES.length) this.loopStep = -this.loopStep;
      this.from = this.to;
      this.to += this.loopStep;
      this.f = 0;
      this.morph = { t: 0 };
    }
    if (this.morph) {
      this.morph.t += dt;
      this.f = Math.min(1, this.morph.t / MORPH_SECONDS);
      if (this.f >= 1) {
        const target = this.to;
        this.from = -1;
        this.rest(target);
      } else this.pose();
      posed = true;
    } else if (this.fade) {
      this.fade.t += dt;
      const k = this.fade.t / FADE_SECONDS;
      if (k >= 1 && !this.fade.switched) {
        this.fade.switched = true;
        this.rest(this.fade.target);
        posed = true;
      }
      this.setVeil(k < 1 ? k : Math.max(0, 2 - k));
      if (k >= 2) this.fade = null;
    }
    if (!this.waves.length) return;
    this.waves = this.waves.filter((w) => this.time - w.start < 1800 / w.speed + w.dur + 0.5);
    for (const it of this.items) {
      if (it.h <= 0) continue;
      let a = 0;
      for (const w of this.waves) {
        const dist = it.p.distanceTo(w.origin);
        // far buildings are answered sooner than their distance says
        const k = (this.time - w.start - dist / (w.speed * (1 + dist / 300))) / w.dur;
        if (k > 0 && k < 1) {
          a += w.strength * 0.3 * Math.sin(Math.PI * k);
          this.tmp.subVectors(it.p, w.origin);
          this.tmp.addScaledVector(it.n, -this.tmp.dot(it.n));
          if (this.tmp.lengthSq() > 1e-6) it.axis.crossVectors(it.n, this.tmp).normalize();
        }
      }
      a = Math.max(-MAX_TILT, Math.min(MAX_TILT, a));
      if (Math.abs(a - it.angle) > 1e-4 || (posed && a !== 0)) {
        it.angle = a;
        this.write(it);
      }
    }
  }
}
