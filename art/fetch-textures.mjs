#!/usr/bin/env node
// Downloads the Poly Haven (CC0) sources the kit uses into art/textures/<id>/ and the sky into public/assets/sky/.
// Usage: node art/fetch-textures.mjs [--out <dir, default art/textures>] [<id>:<res>:<map,map,...>]...
// Without specs it fetches the list below (the files the Blender scripts read). Existing files are kept.
// Only api.polyhaven.com and dl.polyhaven.org are contacted, with a generic User-Agent.
import fs from 'node:fs';
import path from 'node:path';

const UA = { 'User-Agent': 'asset-fetch/1.0' };
const DEFAULTS = [
  'floor_tiles_02:1k:Diffuse,nor_gl,Rough',
  'sandstone_blocks_04:1k:Diffuse,nor_gl,Rough',
  'kloppenheim_06_puresky:1k:hdri',
];

const args = process.argv.slice(2);
let out = 'art/textures';
const specs = [];
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--out') out = args[++i];
  else specs.push(args[i]);
}

async function get(url) {
  const r = await fetch(url, { headers: UA });
  if (!r.ok) throw new Error(`${url}: HTTP ${r.status}`);
  return r;
}

for (const spec of specs.length ? specs : DEFAULTS) {
  const [id, res, maps] = spec.split(':');
  const files = await (await get(`https://api.polyhaven.com/files/${id}`)).json();
  for (const map of maps.split(',')) {
    const entry = map === 'hdri' ? files.hdri?.[res]?.hdr : files[map]?.[res]?.jpg;
    if (!entry) throw new Error(`${id}: no ${map} at ${res}`);
    const dir = map === 'hdri' && !specs.length ? 'public/assets/sky' : path.join(out, id);
    const file = path.join(dir, path.basename(new URL(entry.url).pathname));
    if (fs.existsSync(file) && fs.statSync(file).size === entry.size) {
      console.log(`kept ${file}`);
      continue;
    }
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(file, Buffer.from(await (await get(entry.url)).arrayBuffer()));
    console.log(`fetched ${file} (${entry.size} bytes)`);
  }
}
