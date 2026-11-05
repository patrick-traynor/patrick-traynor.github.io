// Loads the museum (your Blender .glb, or the placeholder) and reads the
// naming conventions out of it. This is the "hook up" layer: nothing in here
// knows about specific exhibits, it only follows names and custom properties.
// BLENDER.md explains each convention with the Blender side of the workflow.
//
//   spawn            empty    where the visitor starts, facing like Blender's Front view
//   exhibit_<id>     empty    an exhibit; <id> matches an "id" in exhibits.json
//   view_<id>        empty    optional: exact spot "Walk there" puts the visitor
//   plaque_<id>      mesh     gets the exhibit's title painted onto it
//   guide            empty    walking up to it offers the visitor guide
//   collision...     mesh     invisible wall: its steep faces block the player (any shape)
//   walk_...         mesh     invisible surface the player can stand on (floors, ramps, stairs)
//   sky / sky_...    mesh     sky dome: always unlit, never fogged, drawn behind everything
//
// Animations (Blender actions):
//   approach_<id>...          plays forward as you walk up to exhibit <id>, backwards as you leave
//   anything else             loops forever
//
// Custom properties (Blender: Object Properties > Custom Properties, export with
// "Include > Custom Properties" ticked):
//   radius, view_distance    on exhibit_ empties
//   exhibit = <id>           on exhibit_ empties, overrides the id taken from the name
//   collide = 1              on any visible mesh whose walls should block the player
//   spin = 0.5               spin around the object's own axis, radians per second
//   spin_axis = "z"          which of the object's own Blender axes to spin around (default z)
//   swing_axis / swing_amp / swing_speed    rock back and forth around the object's own
//                            Blender axis (default z), e.g. flaps and doors
//   bob = 0.05               float up and down, metres
//   lit = 1                  keep real lighting on this mesh even when baked mode is on
//   video = "assets/video/x.mp4"   play a looping, muted video on this mesh (string property)
//   flipbook_cols / flipbook_rows / flipbook_fps / flipbook_frames
//                            step through a sprite sheet in the mesh's texture
import * as THREE from 'three';
import { buildPlaceholder } from './placeholder.js';
import { plaqueTexture, signTexture } from './textures.js';

export async function loadWorld({ cfg, data, tryModel = true }) {
  let root = null;
  let clips = [];
  let source = 'placeholder';
  let saved = null;
  if (tryModel) {
    try {
      const gltf = await loadModel(cfg.modelUrl);
      root = gltf.scene;
      clips = gltf.animations ?? [];
      saved = gltf.saved;
      source = 'model';
      console.info(`[museum] Loaded ${cfg.modelUrl}${saved ? `, exported ${saved.toLocaleString()}` : ''}`);
    } catch (err) {
      console.info(`[museum] No model at ${cfg.modelUrl} (${err?.message ?? err}), building the placeholder museum.`);
    }
  }
  if (!root) root = buildPlaceholder(data, cfg);
  const baked = cfg.bakedLighting === 'auto' ? source === 'model' : Boolean(cfg.bakedLighting);
  const world = scanWorld(root, data, cfg, { baked, clips, gltf: source === 'model' });
  world.source = source;
  world.saved = saved;
  return world;
}

async function loadModel(url) {
  // Check first (never from the cache) so a missing file fails fast instead of trying to parse a 404 page.
  const head = await fetch(url, { method: 'HEAD', cache: 'no-store' });
  if (!head.ok) throw new Error(`HTTP ${head.status}`);
  // Load it under a URL that changes whenever the file does, so a fresh export is never
  // hidden behind an old copy in the browser's cache (an unchanged file still loads from cache).
  const modified = head.headers.get('last-modified');
  const tag = head.headers.get('etag') || modified || head.headers.get('content-length');
  const versioned = tag ? `${url}${url.includes('?') ? '&' : '?'}v=${encodeURIComponent(tag)}` : url;
  const [{ GLTFLoader }, { MeshoptDecoder }] = await Promise.all([
    import('three/addons/loaders/GLTFLoader.js'),
    import('three/addons/libs/meshopt_decoder.module.js'),
  ]);
  const loader = new GLTFLoader();
  loader.setMeshoptDecoder(MeshoptDecoder); // lets you ship files compressed with gltf-transform
  const gltf = await loader.loadAsync(versioned);
  gltf.saved = modified ? new Date(modified) : null;
  return gltf;
}

const isSky = (name) => name === 'sky' || name.startsWith('sky_');
const isWalk = (name) => name === 'walk' || name.startsWith('walk_');
const isCollision = (name) => name.startsWith('collision');

// gltf: true for Blender exports. glTF stores texture coordinates upside down compared to
// three.js, so textures we create here (plaques, videos, flipbooks) must be flipped to match.
export function scanWorld(root, data, cfg, { baked = false, clips = [], gltf = false } = {}) {
  root.updateMatrixWorld(true);
  const entries = new Map(data.exhibits.map((entry, index) => [entry.id, { entry, index }]));
  const world = {
    root, cfg, spawn: null, guide: null, exhibits: [], colliders: [], collision: null, walk: [], animated: [],
    mixer: null, approach: [], videos: [], warnings: [],
  };
  const markers = [];
  const views = new Map();
  const plaques = [];
  let spawnObj = null;
  let hasLights = false;
  let hasLit = false;

  let anyProps = false;
  root.traverse((obj) => {
    const name = obj.name || '';
    // A mesh's settings can sit on the object, its material, or (for a Blender object with
    // several materials, which arrives as a group of meshes) on that group.
    const ud = obj.isMesh ? meshProps(obj, root) : obj.userData || {};
    if (!anyProps && hasOwnProps(ud)) anyProps = true;
    if (obj.isLight) hasLights = true;

    if (name === 'spawn') spawnObj = obj;
    else if (name === 'guide') {
      world.guide = { kind: 'guide', id: 'guide', anchor: obj.getWorldPosition(new THREE.Vector3()), radius: num(ud.radius, cfg.defaultRadius * 0.8) };
    } else if (name.startsWith('exhibit_') && !obj.isMesh) markers.push(obj);
    else if (name.startsWith('view_')) views.set(name.slice(5), obj);

    if (!obj.isMesh) {
      if (ud.spin || ud.swing_amp || ud.bob || typeof ud.update === 'function') world.animated.push(animator(obj, ud));
      return;
    }

    if (taggedUp(obj, isSky)) { makeSky(obj); return; }
    if (taggedUp(obj, isWalk)) {
      obj.visible = false;
      obj.material = new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }); // hit from above whichever way the normals face
      world.walk.push(obj);
      return;
    }
    if (taggedUp(obj, isCollision)) {
      obj.visible = false;
      addCollider(world.colliders, obj);
      return;
    }
    if (ud.collide) addCollider(world.colliders, obj);
    if (name.startsWith('plaque_')) plaques.push(obj);
    if (ud.lit) hasLit = true;
    prepareMaterials(obj, cfg, baked && !ud.lit);
    if (ud.video != null && ud.video !== '') addVideo(world, obj, String(ud.video), gltf);
    if (ud.flipbook_cols || ud.flipbook_rows) addFlipbook(world, obj, ud, gltf);
    if (ud.spin || ud.swing_amp || ud.bob || typeof ud.update === 'function') world.animated.push(animator(obj, ud));
  });

  world.collision = collisionIndex(world.colliders);

  // Ground: with walk_ surfaces, raycast down onto them; without any, the floor is y = 0 everywhere.
  const ray = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const origin = new THREE.Vector3();
  world.groundAt = (x, z, fromY, depth) => {
    if (!world.walk.length) return 0;
    ray.set(origin.set(x, fromY, z), down);
    ray.near = 0;
    ray.far = depth;
    const hit = ray.intersectObjects(world.walk, false)[0];
    return hit ? hit.point.y : null;
  };

  // Spawn
  if (spawnObj) {
    world.spawn = poseOf(spawnObj);
    const g = world.groundAt(world.spawn.pos.x, world.spawn.pos.z, world.spawn.pos.y + 1, 6);
    if (g === null) world.warnings.push('"spawn" isn\'t above any walk_ surface, so the visitor may be stuck');
    else world.spawn.pos.y = g;
  } else {
    world.warnings.push('No "spawn" empty found, starting 5 m in front of the origin');
    world.spawn = { pos: new THREE.Vector3(0, 0, 5), yaw: 0, pitch: 0 };
  }

  // Exhibits
  for (const m of markers) {
    const id = String(m.userData.exhibit ?? m.name.slice(8));
    const hit = entries.get(id);
    if (!hit) {
      world.warnings.push(`"${m.name}" has no matching "id": "${id}" in exhibits.json`);
      continue;
    }
    const anchor = m.getWorldPosition(new THREE.Vector3());
    const front = m.getWorldDirection(new THREE.Vector3());
    front.y = 0;
    if (front.lengthSq() < 1e-6) front.set(0, 0, 1);
    front.normalize();

    let view;
    if (views.has(id)) {
      view = poseOf(views.get(id));
      view.pos.y = world.groundAt(view.pos.x, view.pos.z, view.pos.y + 1, 6) ?? view.pos.y;
    } else {
      const d = num(m.userData.view_distance, cfg.viewDistance);
      const pos = anchor.clone().addScaledVector(front, d);
      pos.y = world.groundAt(pos.x, pos.z, anchor.y + 0.5, 12) ?? Math.max(0, anchor.y - 1.45);
      view = { pos, yaw: Math.atan2(front.x, front.z), pitch: Math.atan2(anchor.y - (pos.y + cfg.eyeHeight), d) };
    }
    world.exhibits.push({ kind: 'exhibit', id, entry: hit.entry, index: hit.index, anchor, radius: num(m.userData.radius, cfg.defaultRadius), view });
  }

  for (const id of entries.keys()) {
    if (!world.exhibits.some((e) => e.id === id)) world.warnings.push(`"${id}" has no exhibit_${id} marker yet, so it only appears in the guide`);
  }

  for (const p of plaques) {
    const hit = entries.get(p.name.slice(7));
    const tex = hit && plaqueTexture(hit.entry, hit.index);
    if (tex) {
      tex.flipY = !gltf;
      p.material = new THREE.MeshBasicMaterial({ map: tex, side: sideOf(p) });
    }
  }

  // Meshes marked lit=1 need a light; add a soft one if the model didn't export any.
  if (hasLit && !hasLights) {
    root.add(new THREE.HemisphereLight('#ffffff', '#555555', 2));
    world.warnings.push('Some meshes have lit = 1 but the model has no lights, so a soft default light was added');
  }

  setupAnimations(world, clips);
  if (gltf && !anyProps) {
    world.warnings.unshift('museum.glb has no custom properties at all, so collide, video, radius and the rest are ignored. '
      + 'In Blender\'s glTF export, tick Include > Data > Custom Properties and export again.');
  }
  for (const w of world.warnings) console.warn('[museum]', w);
  return world;
}

// ---------- Animations ----------
function setupAnimations(world, clips) {
  if (!clips.length) return;
  world.mixer = new THREE.AnimationMixer(world.root);
  const byExhibit = new Map();
  for (const clip of clips) {
    const action = world.mixer.clipAction(clip);
    const m = /^approach_([A-Za-z0-9-]+)/.exec(clip.name);
    if (!m) {
      action.play(); // ambient: loops forever
      continue;
    }
    const exhibit = world.exhibits.find((e) => e.id === m[1]);
    if (!exhibit) {
      world.warnings.push(`Animation "${clip.name}" is for "${m[1]}", which has no exhibit_ marker`);
      continue;
    }
    action.setLoop(THREE.LoopOnce, 1);
    action.clampWhenFinished = true;
    action.play();
    action.paused = true; // hold the first frame until someone walks up
    if (!byExhibit.has(exhibit)) byExhibit.set(exhibit, []);
    byExhibit.get(exhibit).push(action);
  }
  for (const [exhibit, actions] of byExhibit) world.approach.push({ exhibit, actions, inside: false });
}

export function updateApproach(world, pos) {
  for (const a of world.approach) {
    const inside = withinReach(a.exhibit, pos);
    if (inside === a.inside) continue;
    a.inside = inside;
    for (const action of a.actions) {
      action.paused = false;
      action.timeScale = inside ? 1 : -1;
    }
  }
}

export function animateWorld(world, t, dt) {
  for (const a of world.animated) a(t, dt);
  world.mixer?.update(dt);
}

// ---------- Animated textures ----------
// Video on a surface. Nothing downloads until a visitor is nearby (see updateVideos).
// If the file can't play, the surface says so (with the path) instead of staying blank.
function addVideo(world, mesh, src, gltf) {
  if (typeof document === 'undefined') return;
  const side = sideOf(mesh);
  const entry = { src, mesh, gltf, side, pos: mesh.getWorldPosition(new THREE.Vector3()), playing: false, blocked: false, failed: false, video: null };
  world.videos.push(entry);
  if (/\.gif(\?|#|$)/i.test(src)) {
    videoFailed(world, entry, 'GIF: CONVERT TO MP4', `"${mesh.name}" uses a GIF (${src}). GIFs can't play on 3D surfaces: convert it to .mp4 (see BLENDER.md, section 8).`);
    return;
  }
  const video = document.createElement('video');
  Object.assign(video, { src, muted: true, loop: true, playsInline: true, preload: 'none', crossOrigin: 'anonymous' });
  video.setAttribute('muted', '');
  video.setAttribute('playsinline', '');
  video.addEventListener('error', () => videoFailed(world, entry, 'VIDEO NOT LOADED', `"${mesh.name}" couldn't load ${src}: wrong path, missing file, or a format the browser can't play (use H.264 .mp4).`));
  entry.video = video;
  const tex = new THREE.VideoTexture(video);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.flipY = !gltf;
  if (world.cfg.pixelTextures) tex.magFilter = THREE.NearestFilter;
  mesh.material = new THREE.MeshBasicMaterial({ map: tex, side, toneMapped: false });
}

function videoFailed(world, entry, title, message) {
  if (entry.failed) return;
  entry.failed = true;
  entry.playing = false;
  world.warnings.push(message);
  console.warn('[museum]', message);
  const tex = signTexture({
    w: 256, h: 64, bg: '#2c3135', border: '#c9814f',
    lines: [
      { text: title, size: 22, color: '#f0ede7', gap: 1.3 },
      { text: entry.src, size: 10, font: 'mono', weight: 600, color: '#c9814f' },
    ],
  });
  if (!tex) return;
  tex.flipY = !entry.gltf;
  entry.mesh.material = new THREE.MeshBasicMaterial({ map: tex, side: entry.side });
}

// Play videos within range of the visitor, pause the rest. Called a few times a second.
export function updateVideos(world, pos, range = 25) {
  for (const v of world.videos) {
    if (v.failed || !v.video) continue;
    const near = v.pos.distanceTo(pos) < range;
    if (near && !v.playing && !v.blocked) {
      v.playing = true;
      v.video.play().catch((err) => {
        v.playing = false;
        if (err?.name === 'NotAllowedError') v.blocked = true; // autoplay refused: retried after the next click
        else videoFailed(world, v, 'VIDEO NOT LOADED', `"${v.mesh.name}" couldn't play ${v.src} (${err?.name ?? 'error'}): check the path, and use an H.264 .mp4.`);
      });
    } else if (!near && v.playing) {
      v.playing = false;
      v.video.pause();
    }
  }
}

export function unblockVideos(world) {
  for (const v of world.videos) v.blocked = false;
}

// Sprite sheet: frames laid out left to right, top to bottom, in the mesh's texture.
function addFlipbook(world, mesh, ud, gltf) {
  const cols = Math.max(1, Math.round(num(ud.flipbook_cols, 1)));
  const rows = Math.max(1, Math.round(num(ud.flipbook_rows, 1)));
  const frames = Math.max(1, Math.min(cols * rows, Math.round(num(ud.flipbook_frames, cols * rows))));
  const fps = num(ud.flipbook_fps, 8);
  const textures = [];
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
    if (!m.map) continue;
    m.map = m.map.clone(); // its own copy, so other meshes sharing the image don't animate too
    m.map.repeat.set(1 / cols, 1 / rows);
    m.map.needsUpdate = true;
    textures.push(m.map);
  }
  if (!textures.length) {
    world.warnings.push(`"${mesh.name}" has flipbook settings but no texture`);
    return;
  }
  let last = -1;
  const show = (f) => {
    const col = f % cols;
    const row = Math.floor(f / cols);
    for (const tex of textures) tex.offset.set(col / cols, gltf ? row / rows : 1 - (row + 1) / rows);
  };
  show(0);
  world.animated.push((t) => {
    const f = Math.floor(t * fps) % frames;
    if (f !== last) { last = f; show(f); }
  });
}

// ---------- Interaction ----------
function withinReach(target, pos) {
  const dx = target.anchor.x - pos.x;
  const dz = target.anchor.z - pos.z;
  const sameFloor = Math.abs(target.anchor.y - (pos.y + 1.2)) < 2.5;
  return sameFloor && Math.hypot(dx, dz) <= target.radius;
}

// The exhibit (or guide) the visitor is near, on the same floor, and roughly facing.
export function findTarget(world, pos, yaw) {
  const fx = -Math.sin(yaw);
  const fz = -Math.cos(yaw);
  let best = null;
  let bestD = Infinity;
  const all = world.guide ? [...world.exhibits, world.guide] : world.exhibits;
  for (const t of all) {
    if (!withinReach(t, pos)) continue;
    const dx = t.anchor.x - pos.x;
    const dz = t.anchor.z - pos.z;
    const d = Math.hypot(dx, dz);
    if (d > 0.6 && (dx * fx + dz * fz) / d < 0.3) continue; // must be roughly in front of you
    if (d < bestD) { best = t; bestD = d; }
  }
  return best;
}

// ---------- Helpers ----------
// Position (feet) plus the direction you would be looking in Blender's Front view.
// (Blender's Front view looks along +Y, which is three.js's -Z after export.)
function poseOf(obj) {
  const pos = obj.getWorldPosition(new THREE.Vector3());
  const dir = obj.getWorldDirection(new THREE.Vector3()); // local +Z in world space
  return { pos, yaw: Math.atan2(dir.x, dir.z), pitch: 0 };
}

function meshProps(mesh, root) {
  const out = {};
  const parent = mesh.parent;
  if (parent && parent !== root && parent.isGroup) Object.assign(out, parent.userData);
  for (const m of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) if (m?.userData) Object.assign(out, m.userData);
  return Object.assign(out, mesh.userData);
}

function hasOwnProps(ud) {
  return Object.keys(ud).some((k) => k !== 'name' && k !== 'gltfExtensions');
}

function sideOf(mesh) {
  const m = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  return m?.side ?? THREE.FrontSide;
}

function taggedUp(obj, test) {
  // Multi-material Blender objects arrive as a group of meshes, so check parents too.
  for (let o = obj; o; o = o.parent) if (test(o.name || '')) return true;
  return false;
}

function makeSky(mesh) {
  const old = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
  const map = old.map ?? old.emissiveMap ?? null;
  if (map) {
    map.magFilter = THREE.LinearFilter; // keep the sky smooth even in pixel mode
    map.needsUpdate = true;
  }
  mesh.material = new THREE.MeshBasicMaterial({
    map,
    color: map ? 0xffffff : (old.color ?? 0xffffff),
    vertexColors: old.vertexColors,
    side: THREE.DoubleSide,
    fog: false,
    depthWrite: false,
  });
  mesh.renderOrder = -1;
  mesh.frustumCulled = false;
}

// Collision follows the mesh's real shape. Every steep face (a wall, a column's side, a
// plinth's side, glass) becomes a wall segment seen from above, with its height range.
// Floors, ramps, stair treads and tops are ignored, so one joined mesh of curved walls,
// doorways and all, blocks exactly where its walls are.
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _e1 = new THREE.Vector3();
const _e2 = new THREE.Vector3();
function addCollider(list, obj) {
  const geo = obj.geometry;
  const pos = geo?.attributes?.position;
  if (!pos) return;
  const index = geo.index;
  const count = index ? index.count : pos.count;
  const vert = (i) => (index ? index.getX(i) : i);
  const seen = new Set();
  for (let i = 0; i + 2 < count; i += 3) {
    _a.fromBufferAttribute(pos, vert(i)).applyMatrix4(obj.matrixWorld);
    _b.fromBufferAttribute(pos, vert(i + 1)).applyMatrix4(obj.matrixWorld);
    _c.fromBufferAttribute(pos, vert(i + 2)).applyMatrix4(obj.matrixWorld);
    _e1.subVectors(_b, _a).cross(_e2.subVectors(_c, _a));
    const area = _e1.length();
    if (area < 1e-9 || Math.abs(_e1.y) / area > 0.5) continue; // flatter than 60 degrees: not a wall
    // The face seen from above is (nearly) a line: take its two furthest-apart points.
    let p = _a, q = _b;
    let best = dist2(_a, _b);
    if (dist2(_b, _c) > best) { p = _b; q = _c; best = dist2(_b, _c); }
    if (dist2(_a, _c) > best) { p = _a; q = _c; best = dist2(_a, _c); }
    if (best < 1e-8) continue;
    const seg = {
      x1: p.x, z1: p.z, x2: q.x, z2: q.z,
      minY: Math.min(_a.y, _b.y, _c.y), maxY: Math.max(_a.y, _b.y, _c.y),
    };
    // The two triangles of a quad usually give the same segment: keep one.
    const key = [seg.x1, seg.z1, seg.x2, seg.z2, seg.minY, seg.maxY].map((n) => Math.round(n * 1000)).join();
    if (seen.has(key)) continue;
    seen.add(key);
    list.push(seg);
  }
}

function dist2(p, q) {
  return (p.x - q.x) ** 2 + (p.z - q.z) ** 2;
}

// A 2 m grid over the wall segments, so each step only checks the walls nearby,
// however detailed the collision meshes are.
export function collisionIndex(segments, cell = 2) {
  const grid = new Map();
  const at = (i, j) => `${i},${j}`;
  for (const s of segments) {
    const i0 = Math.floor(Math.min(s.x1, s.x2) / cell);
    const i1 = Math.floor(Math.max(s.x1, s.x2) / cell);
    const j0 = Math.floor(Math.min(s.z1, s.z2) / cell);
    const j1 = Math.floor(Math.max(s.z1, s.z2) / cell);
    for (let i = i0; i <= i1; i++) {
      for (let j = j0; j <= j1; j++) {
        const k = at(i, j);
        if (!grid.has(k)) grid.set(k, []);
        grid.get(k).push(s);
      }
    }
  }
  let stamp = 0;
  const out = [];
  return {
    count: segments.length,
    near(x, z, reach) {
      stamp++;
      out.length = 0;
      for (let i = Math.floor((x - reach) / cell); i <= Math.floor((x + reach) / cell); i++) {
        for (let j = Math.floor((z - reach) / cell); j <= Math.floor((z + reach) / cell); j++) {
          const list = grid.get(at(i, j));
          if (!list) continue;
          for (const s of list) {
            if (s._stamp === stamp) continue;
            s._stamp = stamp;
            out.push(s);
          }
        }
      }
      return out;
    },
  };
}

function prepareMaterials(mesh, cfg, toUnlit) {
  const swap = (m) => {
    if (cfg.pixelTextures) {
      for (const key of ['map', 'emissiveMap']) {
        const t = m[key];
        if (t && !t.isCanvasTexture) {
          t.magFilter = THREE.NearestFilter;
          t.minFilter = THREE.NearestMipmapLinearFilter;
          t.needsUpdate = true;
        }
      }
    }
    if (m.transparent) m.depthWrite = false; // glass: don't hide what's behind it
    if (!toUnlit || m.isMeshBasicMaterial) return m;
    // Baked lighting is already in the texture, so show it as-is with no lights.
    // A material with only an emission texture (a screen, a sign) uses that instead.
    const map = m.map ?? m.emissiveMap ?? null;
    return new THREE.MeshBasicMaterial({
      name: m.name,
      map,
      // Texture: tinted by the base colour. Emission-only (screens): shown as-is. No texture: flat base colour.
      color: m.map || !m.emissiveMap ? m.color : 0xffffff,
      transparent: m.transparent,
      opacity: m.opacity,
      alphaTest: m.alphaTest,
      depthWrite: !m.transparent,
      side: m.side,
      vertexColors: m.vertexColors,
    });
  };
  mesh.material = Array.isArray(mesh.material) ? mesh.material.map(swap) : swap(mesh.material);
}

// Spin and swing turn around the object's OWN axes, as shown in Blender with the
// transform orientation set to Local, whatever the object's rotation. Axis letters are
// Blender's; glTF export turns Blender local Z into three.js local Y, and Y into -Z.
const BLENDER_AXES = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 0, -1), z: new THREE.Vector3(0, 1, 0) };

function localAxis(letter, fallback) {
  const text = String(letter ?? fallback).trim().toLowerCase();
  const axis = (BLENDER_AXES[text.replace('-', '')] ?? BLENDER_AXES[fallback]).clone();
  return text.startsWith('-') ? axis.negate() : axis;
}

function animator(obj, ud) {
  const baseQ = obj.quaternion.clone();
  const baseY = obj.position.y;
  const spin = num(ud.spin, 0);
  const spinAxis = localAxis(ud.spin_axis, 'z');
  const amp = num(ud.swing_amp, 0);
  const speed = num(ud.swing_speed, 1);
  const swingAxis = localAxis(ud.swing_axis, 'z');
  const bob = num(ud.bob, 0);
  const update = typeof ud.update === 'function' ? ud.update : null;
  const q = new THREE.Quaternion();
  let angle = 0;
  return (t, dt) => {
    if (spin || amp) {
      obj.quaternion.copy(baseQ);
      if (spin) {
        angle = (angle + spin * dt) % (Math.PI * 2);
        obj.quaternion.multiply(q.setFromAxisAngle(spinAxis, angle));
      }
      if (amp) obj.quaternion.multiply(q.setFromAxisAngle(swingAxis, amp * Math.sin(t * speed)));
    }
    if (bob) obj.position.y = baseY + bob * Math.sin(t * 1.6);
    if (update) update(t, dt, obj);
  };
}

function num(v, fallback) {
  const n = Number(v);
  return Number.isFinite(n) && v !== '' && v != null ? n : fallback;
}
