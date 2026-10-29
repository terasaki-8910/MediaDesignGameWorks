// The Core Gate's surface: a slow swirl with a bright rim, instead of a flat emissive disc that blooms to plain white.
// Works on the Blender gate's CoreDisc and on the procedural fallback disc alike.
import * as THREE from 'three';

export function portalMaterial(accent: THREE.Color): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    side: THREE.DoubleSide,
    fog: false,
    uniforms: { uTime: { value: 0 }, uColor: { value: accent.clone() }, uOpen: { value: 0 } },
    vertexShader: /* glsl */ `
      attribute vec2 discUv;
      varying vec2 vP;
      void main() {
        vP = discUv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime; uniform vec3 uColor; uniform float uOpen;
      varying vec2 vP;
      void main() {
        float r = length(vP);
        float a = atan(vP.y, vP.x);
        float t = uTime * (0.5 + uOpen);
        float arms = sin(a * 3.0 + r * 10.0 - t * 1.7) * 0.5 + 0.5;
        float ripple = sin(r * 22.0 - t * 2.4) * 0.5 + 0.5;
        float depth = 1.0 - smoothstep(0.0, 1.0, r);
        vec3 col = uColor * (0.12 + 0.4 * arms * depth + 0.14 * ripple * depth);
        col += uColor * pow(depth, 3.0) * (0.7 + 1.3 * uOpen); // light from deep inside, stronger once the fold is open
        col += mix(uColor, vec3(1.0), 0.35) * smoothstep(0.8, 1.0, r) * 1.4; // bright rim against the brass ring
        gl_FragColor = vec4(col, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Adds `discUv` (-1..1 across the disc) from the geometry's own extent, whatever plane the disc was modelled in. */
export function prepareDisc(geometry: THREE.BufferGeometry) {
  geometry.computeBoundingBox();
  const box = geometry.boundingBox!;
  const size = box.getSize(new THREE.Vector3());
  const centre = box.getCenter(new THREE.Vector3());
  const [u, v] = [0, 1, 2].sort((a, b) => size.getComponent(b) - size.getComponent(a));
  const pos = geometry.getAttribute('position');
  const get = (i: number, k: number) => (k === 0 ? pos.getX(i) : k === 1 ? pos.getY(i) : pos.getZ(i));
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) {
    uv[i * 2] = (get(i, u) - centre.getComponent(u)) / (size.getComponent(u) / 2);
    uv[i * 2 + 1] = (get(i, v) - centre.getComponent(v)) / (size.getComponent(v) / 2);
  }
  geometry.setAttribute('discUv', new THREE.BufferAttribute(uv, 2));
}
