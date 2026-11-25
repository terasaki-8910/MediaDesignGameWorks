// The one place a GLTFLoader is made for files that may be Draco-compressed (buildings.glb: art/blender/gen_buildings.py
// exports it with KHR_draco_mesh_compression). The decoder is three's own glTF build (three/examples/jsm/libs/draco/gltf:
// the WebAssembly decoder and its wrapper). DRACOLoader names the two files by `new URL(..., import.meta.url)`, so the
// build copies them out of the installed three as hashed static files beside the page's script: nothing to copy by hand,
// and never a decoder of another version than the loader. A file without Draco loads through the same loader as before.
import { DRACO_GLTF_CONFIG, DRACOLoader } from 'three/examples/jsm/loaders/DRACOLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

let draco: DRACOLoader | null = null;

/** The shared Draco decoder: one pool of workers for every file, fetched and compiled once. */
function dracoLoader(): DRACOLoader {
  if (!draco) {
    draco = new DRACOLoader().setDecoderPath(DRACO_GLTF_CONFIG);
    // start fetching the decoder now, beside the GLB, not when the GLB's first mesh asks for it
    draco.preload();
  }
  return draco;
}

/** A GLTFLoader that also reads Draco-compressed meshes. */
export function gltfLoader(): GLTFLoader {
  return new GLTFLoader().setDRACOLoader(dracoLoader());
}
