// The Core Gate's surface: a membrane of dark cyan glass in its bronze frame, with a slow swirl of veins in it, instead of a
// flat emissive disc that blooms to plain white. It gives little light until the gate opens.
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
        // a membrane of dark glass: a deep body, the swirl as faint veins in it, and little light of its own until it opens
        vec3 body = uColor * vec3(0.5, 0.82, 0.9);
        vec3 col = body * (0.1 + 0.05 * (1.0 - depth));
        float veins = smoothstep(0.55, 1.0, arms) * (0.35 + 0.65 * depth);
        col += uColor * (0.12 * veins + 0.05 * ripple * depth);
        col += uColor * pow(depth, 3.0) * (0.14 + 1.9 * uOpen); // light from deep inside, once the fold is open
        // what a pane of glass shows: a band of the sky across it, and a thin bright line where it meets its frame
        float sheen = smoothstep(0.2, 0.0, abs(vP.y * 0.8 - vP.x * 0.6 - 0.34)) * (1.0 - r * r);
        col += vec3(0.75, 0.9, 1.0) * 0.07 * sheen;
        col += mix(uColor, vec3(1.0), 0.25) * smoothstep(0.93, 1.0, r) * 0.32;
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
