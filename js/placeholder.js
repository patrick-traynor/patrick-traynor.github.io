// The placeholder museum, built in code.
//
// It uses exactly the same naming conventions as a Blender export
// (spawn, exhibit_<id>, plaque_<id>, guide, collision*, and the spin / swing / bob
// custom properties), so world.js treats it identically to your real model.
// Once models/museum.glb exists, this file is never used.
import * as THREE from 'three';
import { noiseTexture, signTexture, makeCanvas, canvasTexture, rng, FONTS } from './textures.js';

// Three moods for the placeholder. Pick one with `mood` in config.js.
// Signs are slate with stone lettering, to match the site's UI in every mood.
const SHARED = { sign: '#2c3135', paper: '#f0ede7', ink: '#f0ede7', teal: '#2fb3a4', copper: '#c9814f' };

const MOODS = {
  // 4pm: warm afternoon sun well above the horizon, hazy blue sky, soft shadows through the windows.
  afternoon: {
    ...SHARED,
    wall: '#c4b6a5', trim: '#7d6e61', floor: '#8f8276', grout: '#76695e', ceiling: '#978c81',
    plinth: '#ddd2c5', grass: '#6c7a4b', path: '#b3a693', hedge: '#465a3a',
    hills: ['#7f8b79', '#879281', '#909a89', '#99a291'], trunk: '#5a4433', leaf: '#4e6640',
    glass: '#e3eef4', glassOpacity: 0.1, tarmac: '#5b5957', dash: '#dcd7cf',
    skyZenith: '#4c7cb2', skyMid: '#8eb0cf', skyHorizon: '#d4d2c8', skyGlow: '#f1e2c6',
    sunColor: '#ffe3c2', sunIntensity: 1.9, sunDir: [-0.72, 0.53, 0.45],
    hemiSky: '#bcd0e2', hemiGround: '#7a6a5a', hemiIntensity: 1.25,
    fog: ['#d1d1c9', 80, 380],
    doorLamp: 3, foyerLamp: 3, spot: 7,
    stars: false, sunDisc: true, shadows: true,
  },
  // Golden hour: warm, a little darker than day, low sun raking through the windows.
  sunset: {
    ...SHARED,
    wall: '#a99585', trim: '#5e4a3f', floor: '#73625a', grout: '#574941', ceiling: '#4f423b',
    plinth: '#c4b3a4', grass: '#4a5636', path: '#8c7a6b', hedge: '#2c3a24',
    hills: ['#4b4650', '#544d59', '#5d5462', '#665a69'], trunk: '#47342a', leaf: '#37492b',
    glass: '#ffd2a6', glassOpacity: 0.08, tarmac: '#3a3533', dash: '#948a83',
    skyZenith: '#272a4f', skyMid: '#7c5776', skyHorizon: '#a26a6e', skyGlow: '#f0975a',
    sunColor: '#ffb27a', sunIntensity: 1.5, sunDir: [-0.86, 0.2, 0.25],
    hemiSky: '#c39686', hemiGround: '#35271f', hemiIntensity: 1.1,
    fog: ['#6f5465', 60, 260],
    doorLamp: 6, foyerLamp: 5, spot: 9,
    stars: false, sunDisc: true, shadows: true,
  },
  // Midnight: a gallery after hours, lit by exhibit spotlights and the moon.
  night: {
    ...SHARED,
    wall: '#2c3134', trim: '#15191b', floor: '#23292b', grout: '#131719', ceiling: '#0b0d0e',
    plinth: '#2a3033', grass: '#0f1a13', path: '#1d2123', hedge: '#0b150e',
    hills: ['#070d0a', '#09110d', '#0b1410', '#0d1712'], trunk: '#1a1410', leaf: '#0d1b11',
    glass: '#6fa3b8', glassOpacity: 0.07, tarmac: '#0b0d0e', dash: '#3d4344',
    skyZenith: '#000000', skyMid: '#04080d', skyHorizon: '#0a141e', skyGlow: '#0a141e',
    sunColor: '#9db8dc', sunIntensity: 0.5, sunDir: [-0.56, 0.74, 0.37],
    hemiSky: '#1f2e40', hemiGround: '#020303', hemiIntensity: 1.0,
    fog: ['#020406', 40, 210],
    doorLamp: 14, foyerLamp: 10, spot: 16,
    stars: true, sunDisc: false, shadows: false,
  },
};

let PAL = MOODS.afternoon;

const lambert = (color, extra = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });

export function buildPlaceholder(data, cfg = {}) {
  PAL = MOODS[cfg.mood] ?? MOODS.afternoon;
  const root = new THREE.Group();
  root.name = 'museum';

  const box = (w, h, d, mat, x, y, z, name = '') => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
    m.position.set(x, y, z);
    m.name = name;
    return m;
  };
  const solid = (obj) => { obj.userData.collide = true; return obj; };

  // Invisible walls for collision, named the way you would in Blender.
  const colMat = new THREE.MeshBasicMaterial();
  let colCount = 0;
  const collider = (minX, maxX, minZ, maxZ, h = 3) =>
    root.add(box(maxX - minX, h, maxZ - minZ, colMat, (minX + maxX) / 2, h / 2, (minZ + maxZ) / 2, `collision_${colCount++}`));

  // ---------- Sky, ground, lighting ----------
  root.add(makeSky());

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(500, 500),
    lambert('#ffffff', { map: noiseTexture({ base: PAL.grass, spread: 8, seed: 7, repeat: [140, 140] }) }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -0.01;
  root.add(ground);

  const path = new THREE.Mesh(new THREE.PlaneGeometry(3, 11.6), lambert(PAL.path));
  path.rotation.x = -Math.PI / 2;
  path.position.set(0, 0.005, 6);
  root.add(path);

  if (PAL.stars) root.add(makeStars());
  root.add(new THREE.HemisphereLight(PAL.hemiSky, PAL.hemiGround, PAL.hemiIntensity));
  const sunDir = new THREE.Vector3(...PAL.sunDir).normalize();
  const sun = new THREE.DirectionalLight(PAL.sunColor, PAL.sunIntensity);
  sun.target.position.set(0, 0, -6);
  sun.position.copy(sun.target.position).addScaledVector(sunDir, 120);
  if (PAL.shadows) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(1024, 1024); // coarse on purpose: crisp pixel shadows, cheap on phones
    Object.assign(sun.shadow.camera, { left: -26, right: 26, top: 26, bottom: -26, near: 1, far: 260 });
    sun.shadow.bias = -0.0008;
    sun.shadow.normalBias = 0.03;
  }
  root.add(sun, sun.target);
  // A lamp over the doors so the facade and path read in low light, and one in the foyer.
  const doorLamp = new THREE.PointLight('#ffe2bd', PAL.doorLamp, 11, 2);
  doorLamp.position.set(0, 3.4, 1.6);
  root.add(doorLamp);
  const foyerLamp = new THREE.PointLight('#ffe2bd', PAL.foyerLamp, 10, 2);
  foyerLamp.position.set(1.5, 4.4, -2.5);
  root.add(foyerLamp);

  // ---------- The building: 24 m wide, 18 m deep, 5 m tall, doors facing +Z ----------
  const H = 5;
  const wallMat = lambert('#ffffff', { map: noiseTexture({ base: PAL.wall, spread: 5, seed: 2, repeat: [4, 2] }) });
  const trimMat = lambert(PAL.trim);
  const glassMat = new THREE.MeshBasicMaterial({ color: PAL.glass, transparent: true, opacity: PAL.glassOpacity, depthWrite: false, side: THREE.DoubleSide });

  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(24, 18),
    lambert('#ffffff', { map: noiseTexture({ base: PAL.floor, spread: 6, seed: 3, grout: PAL.grout, repeat: [12, 9] }) }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.set(0, 0.01, -9);
  root.add(floor);

  root.add(box(24.4, 0.3, 18.4, new THREE.MeshBasicMaterial({ color: PAL.ceiling }), 0, H + 0.15, -9)); // unlit: a flat, even ceiling tone
  root.add(box(25.2, 0.5, 0.9, trimMat, 0, H + 0.25, 0.2)); // cornice over the entrance

  // Front wall with a doorway
  root.add(box(10.6, H, 0.4, wallMat, -6.9, H / 2, 0));
  root.add(box(10.6, H, 0.4, wallMat, 6.9, H / 2, 0));
  root.add(box(3.2, H - 3.2, 0.4, wallMat, 0, 3.2 + (H - 3.2) / 2, 0));
  collider(-12.2, -1.6, -0.2, 0.2);
  collider(1.6, 12.2, -0.2, 0.2);

  // Side walls with three windows each
  for (const x of [-12, 12]) {
    root.add(box(0.4, 1, 18.4, wallMat, x, 0.5, -9));
    root.add(box(0.4, H - 3.4, 18.4, wallMat, x, 3.4 + (H - 3.4) / 2, -9));
    for (const [z0, z1] of [[0.2, -2.4], [-5.6, -7.4], [-10.6, -12.4], [-15.6, -18.2]]) {
      root.add(box(0.4, 2.4, Math.abs(z1 - z0), wallMat, x, 2.2, (z0 + z1) / 2));
    }
    for (const z of [-4, -9, -14]) {
      const g = new THREE.Mesh(new THREE.PlaneGeometry(3.2, 2.4), glassMat);
      g.rotation.y = Math.PI / 2;
      g.position.set(x, 2.2, z);
      root.add(g);
    }
    collider(x - 0.2, x + 0.2, -18.2, 0.2);
  }

  // Back wall with one wide window
  root.add(box(24.4, 1.2, 0.4, wallMat, 0, 0.6, -18));
  root.add(box(24.4, H - 3.8, 0.4, wallMat, 0, 3.8 + (H - 3.8) / 2, -18));
  root.add(box(6.2, 2.6, 0.4, wallMat, -9.1, 2.5, -18));
  root.add(box(6.2, 2.6, 0.4, wallMat, 9.1, 2.5, -18));
  const backGlass = new THREE.Mesh(new THREE.PlaneGeometry(12, 2.6), glassMat);
  backGlass.position.set(0, 2.5, -18);
  root.add(backGlass);
  collider(-12.2, 12.2, -18.2, -17.8);

  // Divider between the two wings, with a wayfinding sign
  const wings = uniqueWings(data.exhibits);
  root.add(solid(box(0.4, 3.2, 8, wallMat, 0, 1.6, -10)));
  const wingSign = new THREE.Mesh(new THREE.PlaneGeometry(3.6, 0.6), new THREE.MeshBasicMaterial({ map: wayfindingTexture(wings[0], wings[1]) }));
  wingSign.position.set(0, 2.55, -5.79);
  root.add(wingSign);

  // Facade sign: the site's "header" lives on the building.
  const facade = new THREE.Mesh(
    new THREE.PlaneGeometry(7.2, 1.5),
    new THREE.MeshBasicMaterial({
      map: signTexture({
        w: 336, h: 70, bg: PAL.sign, border: PAL.teal,
        lines: [
          { text: data.site.name.toUpperCase(), size: 36, weight: 700, color: PAL.ink, tracking: 4, gap: 1.05 },
          { text: data.site.role.toUpperCase(), size: 11, font: 'mono', weight: 600, color: PAL.teal, tracking: 2 },
        ],
      }),
    }),
  );
  facade.position.set(0, 4.15, 0.22);
  root.add(facade);

  // A bench in the foyer
  root.add(solid(box(2.4, 0.45, 0.6, lambert('#3a2a1e'), 0, 0.225, -3.2)));

  // ---------- Visitor guide lectern (the skimmer's shortcut, inside the world) ----------
  const lectern = new THREE.Group();
  lectern.position.set(2.6, 0, -1.7);
  lectern.rotation.y = -0.5;
  lectern.add(solid(box(0.24, 1, 0.24, lambert(PAL.sign), 0, 0.5, 0)));
  const top = box(0.75, 0.05, 0.55, lambert(PAL.sign), 0, 1.05, 0);
  top.rotation.x = 0.45; // slopes down towards the reader
  lectern.add(top);
  const pamphlet = new THREE.Mesh(
    new THREE.PlaneGeometry(0.6, 0.42),
    new THREE.MeshBasicMaterial({
      map: signTexture({ w: 96, h: 64, bg: PAL.teal, lines: [
        { text: 'VISITOR', size: 18, color: PAL.paper, gap: 1 }, { text: 'GUIDE', size: 18, color: PAL.paper, gap: 1 },
      ] }),
    }),
  );
  pamphlet.rotation.x = -Math.PI / 2 + 0.45; // lie flat, then match the slope
  pamphlet.position.set(0, 1.078, 0.014);
  lectern.add(pamphlet);
  const guideMarker = new THREE.Object3D();
  guideMarker.name = 'guide';
  guideMarker.position.set(0, 1.1, 0);
  lectern.add(guideMarker);
  root.add(lectern);

  // ---------- Exhibits ----------
  const slots = {
    left: [[-7.5, -3.8], [-7.5, -9.4], [-7.5, -15]],
    right: [[7.5, -3.8], [7.5, -9.4], [7.5, -15]],
  };
  const free = [...slots.left.map((s) => [...s, 'left']), ...slots.right.map((s) => [...s, 'right'])];
  const take = (side) => {
    const i = free.findIndex((s) => s[2] === side);
    return i >= 0 ? free.splice(i, 1)[0] : free.shift();
  };
  for (const entry of data.exhibits) {
    const side = entry.wing === wings[1] ? 'right' : 'left';
    const slot = take(side);
    if (!slot) break; // more exhibits than slots: they still appear in the guide
    root.add(buildExhibit(entry, slot));
  }

  // ---------- The yard and the world beyond the windows ----------
  const hedgeMat = lambert(PAL.hedge);
  root.add(solid(box(0.8, 1.1, 36, hedgeMat, -20, 0.55, -6)));
  root.add(solid(box(0.8, 1.1, 36, hedgeMat, 20, 0.55, -6)));
  root.add(solid(box(40.8, 1.1, 0.8, hedgeMat, 0, 0.55, 12)));
  root.add(solid(box(40.8, 1.1, 0.8, hedgeMat, 0, 0.55, -24)));
  for (const [x, z] of [[-15, 8], [15, 8], [-16, -21], [16, -21], [-8, 9], [9, 9.5]]) root.add(tree(x, z));

  const r = rng(11);
  for (let i = 0; i < 34; i++) {
    const a = r() * Math.PI * 2;
    const d = 70 + r() * 110;
    const x = Math.cos(a) * d;
    const z = Math.sin(a) * d;
    if (Math.abs(x + 46) < 14) continue; // keep the runway clear
    const h = 8 + r() * 22;
    const hill = new THREE.Mesh(
      new THREE.ConeGeometry(10 + r() * 18, h, 5 + Math.floor(r() * 3)),
      lambert(PAL.hills[Math.floor(r() * PAL.hills.length)]),
    );
    hill.position.set(x, h / 2 - 0.5, z);
    hill.rotation.y = r() * Math.PI;
    root.add(hill);
  }
  root.add(runway());

  // ---------- Where the player starts: outside, looking at the facade ----------
  const spawn = new THREE.Object3D();
  spawn.name = 'spawn';
  spawn.position.set(0, 0, 8);
  root.add(spawn);

  if (PAL.shadows) setupShadows(root);
  // main.js reads this to set the fog and background to match.
  root.userData.environment = { fog: PAL.fog, background: PAL.fog[0], shadows: PAL.shadows };
  return root;
}

// ---------------------------------------------------------------------------

function buildExhibit(entry, [x, z, side]) {
  // The group's local +Z is the exhibit's front: the side visitors stand on.
  const g = new THREE.Group();
  g.name = `display_${entry.id}`;
  g.position.set(x, 0, z);
  g.rotation.y = side === 'left' ? Math.PI / 2 : -Math.PI / 2;

  const build = BUILDERS[entry.id] ?? BUILDERS.generic;
  const spec = build(entry);

  if (spec.plinth !== false) {
    const plinth = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.9, 1.3), lambert(PAL.plinth));
    plinth.position.y = 0.45;
    plinth.userData.collide = true;
    g.add(plinth);
    spec.object.position.y += 0.9;
  }
  g.add(spec.object);

  // Plaque: world.js paints the title from exhibits.json onto anything named plaque_<id>.
  const plaque = new THREE.Mesh(new THREE.PlaneGeometry(1.05, 0.34), new THREE.MeshBasicMaterial({ color: PAL.paper }));
  plaque.name = `plaque_${entry.id}`;
  const [py, pz] = spec.plaque ?? [0.55, 0.656];
  plaque.position.set(0, py, pz);
  if (spec.plaqueStand) {
    const stand = new THREE.Mesh(new THREE.BoxGeometry(1.15, py * 2, 0.12), lambert(PAL.plinth));
    stand.position.set(0, py, pz - 0.065);
    stand.userData.collide = true;
    g.add(stand);
  }
  g.add(plaque);

  // The marker world.js looks for. Prompts float above it; "Walk there" stands in front of it.
  const marker = new THREE.Object3D();
  marker.name = `exhibit_${entry.id}`;
  marker.position.y = spec.markerY ?? 1.45;
  // Same as setting the Blender custom properties on the empty:
  if (spec.viewDistance) marker.userData.view_distance = spec.viewDistance;
  if (spec.radius) marker.userData.radius = spec.radius;
  g.add(marker);

  const light = new THREE.PointLight('#ffe6c4', PAL.spot, 8, 2);
  light.position.set(0, 3.6, 1.1);
  g.add(light);
  return g;
}

const BUILDERS = {
  // Wing section with an oscillating flap. Seen side-on, you get the aerofoil profile.
  activeaero() {
    const obj = new THREE.Group();
    const chord = 0.9;
    const mat = lambert('#cdd5dc');
    const main = new THREE.Mesh(aerofoil(chord, 0.13, 0.05, 1.0), mat);
    obj.add(main);
    const flapPivot = new THREE.Group();
    flapPivot.position.set(chord / 2 + 0.03, -0.015, 0);
    flapPivot.rotation.z = -0.25;
    flapPivot.userData = { swing_axis: 'y', swing_amp: 0.3, swing_speed: 1.3 }; // the hinge runs along the span
    const flap = new THREE.Mesh(aerofoil(0.32, 0.12, 0.03, 1.0), lambert(PAL.teal));
    flap.position.x = 0.16;
    flapPivot.add(flap);
    obj.add(flapPivot);
    obj.rotation.z = 0.06;
    obj.position.y = 0.55;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.03, 0.03, 0.55, 6), lambert(PAL.sign));
    rod.position.y = -0.275;
    const holder = new THREE.Group();
    holder.add(rod);
    holder.add(obj);
    return { object: holder, markerY: 1.45 };
  },

  // Dashboard with a live pixel screen.
  dashboard() {
    const obj = new THREE.Group();
    const bezel = new THREE.Mesh(new THREE.BoxGeometry(1.05, 0.5, 0.22), lambert('#23292c'));
    obj.add(bezel);
    const { texture, draw } = dashScreen();
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.92, 0.38), new THREE.MeshBasicMaterial({ map: texture ?? null, color: texture ? '#ffffff' : '#0d1a1f' }));
    screen.position.z = 0.115;
    obj.add(screen);
    obj.rotation.x = -0.28;
    obj.position.y = 0.42;
    let last = -1;
    obj.userData.update = (t) => {
      if (t - last < 0.08) return; // redraw ~12 times a second, enough for a pixel gauge
      last = t;
      draw(t);
    };
    const neck = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.2), lambert(PAL.sign));
    neck.position.y = 0.15;
    const holder = new THREE.Group();
    holder.add(neck, obj);
    return { object: holder, markerY: 1.3 };
  },

  // Low-poly car on a turntable.
  mazda2() {
    const holder = new THREE.Group();
    const table = new THREE.Mesh(new THREE.CylinderGeometry(1.25, 1.3, 0.3, 14), lambert(PAL.plinth));
    table.position.y = 0.15;
    table.userData.collide = true;
    holder.add(table);
    const turn = new THREE.Group();
    turn.position.y = 0.3;
    turn.userData.spin = 0.35;
    const paint = lambert('#a51d27');
    const body = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.36, 0.86), paint);
    body.position.y = 0.32;
    const cabin = new THREE.Mesh(new THREE.BoxGeometry(1.0, 0.32, 0.78), lambert('#2a3238'));
    cabin.position.set(-0.12, 0.66, 0);
    const roof = new THREE.Mesh(new THREE.BoxGeometry(0.9, 0.05, 0.8), paint);
    roof.position.set(-0.14, 0.84, 0);
    turn.add(body, cabin, roof);
    const wheelGeo = new THREE.CylinderGeometry(0.19, 0.19, 0.14, 10);
    wheelGeo.rotateX(Math.PI / 2);
    for (const [wx, wz] of [[0.62, 0.42], [-0.62, 0.42], [0.62, -0.42], [-0.62, -0.42]]) {
      const w = new THREE.Mesh(wheelGeo, lambert('#1b1e20'));
      w.position.set(wx, 0.19, wz);
      turn.add(w);
    }
    holder.add(turn);
    return { object: holder, plinth: false, markerY: 0.95, plaque: [0.4, 1.42], plaqueStand: true, viewDistance: 3.6, radius: 4.2 };
  },

  // Arcade cabinet for a game.
  racing(entry) {
    const holder = new THREE.Group();
    const cab = new THREE.Mesh(new THREE.BoxGeometry(0.8, 1.9, 0.7), lambert('#0d3330'));
    cab.position.y = 0.95;
    cab.userData.collide = true;
    holder.add(cab);
    // A two-frame sprite sheet (frames stacked top to bottom), animated with the same
    // flipbook custom properties you'd set in Blender.
    const sheet = spriteSheet(96, 72, [
      [{ text: 'PRESS', size: 16, color: PAL.teal, gap: 1 }, { text: 'START', size: 16, color: PAL.teal, gap: 1 }],
      [{ text: 'INSERT', size: 16, color: PAL.copper, gap: 1 }, { text: 'COIN', size: 16, color: PAL.copper, gap: 1 }],
    ]);
    const screen = new THREE.Mesh(new THREE.PlaneGeometry(0.62, 0.48), new THREE.MeshBasicMaterial({ map: sheet }));
    if (sheet) screen.userData = { flipbook_cols: 1, flipbook_rows: 2, flipbook_fps: 1.2 };
    screen.position.set(0, 1.45, 0.385); // far enough forward that the tilt stays outside the cabinet
    screen.rotation.x = -0.12;
    holder.add(screen);
    const marquee = new THREE.Mesh(
      new THREE.PlaneGeometry(0.76, 0.2),
      new THREE.MeshBasicMaterial({ map: signTexture({ w: 128, h: 32, bg: PAL.copper, lines: [
        { text: entry.title.toUpperCase(), size: 18, color: '#000000' },
      ] }) }),
    );
    marquee.position.set(0, 1.8, 0.352);
    holder.add(marquee);
    const deck = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.08, 0.3), lambert('#111517'));
    deck.position.set(0, 1.08, 0.46);
    deck.rotation.x = 0.25;
    holder.add(deck);
    return { object: holder, plinth: false, markerY: 1.45, plaque: [0.55, 0.356] };
  },

  // A small sun with an orbiting planet.
  sun() {
    const holder = new THREE.Group();
    const star = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 1), lambert('#e98a3a', { emissive: '#b8461a', emissiveIntensity: 0.7 }));
    star.position.y = 0.62;
    star.userData = { spin: 0.25, bob: 0.05 };
    holder.add(star);
    const orbit = new THREE.Group();
    orbit.position.y = 0.62;
    orbit.rotation.x = 0.35;
    orbit.userData.spin = 0.7;
    const planet = new THREE.Mesh(new THREE.IcosahedronGeometry(0.09, 0), lambert('#6d8fb8'));
    planet.position.x = 0.62;
    orbit.add(planet);
    holder.add(orbit);
    return { object: holder, markerY: 1.52 };
  },

  generic() {
    const cube = new THREE.Mesh(new THREE.BoxGeometry(0.45, 0.45, 0.45), lambert('#b9c0b6'));
    cube.position.y = 0.45;
    cube.userData.spin = 0.4;
    return { object: cube, markerY: 1.35 };
  },
};

// NACA 4-digit style aerofoil, extruded along Z and centred on the origin.
function aerofoil(chord, thickness, camber, span) {
  const p = 0.4;
  const n = 18;
  const upper = [];
  const lower = [];
  for (let i = 0; i <= n; i++) {
    const x = (1 - Math.cos((i / n) * Math.PI)) / 2;
    const yt = 5 * thickness * (0.2969 * Math.sqrt(x) - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4);
    const yc = x < p ? (camber / p ** 2) * (2 * p * x - x * x) : (camber / (1 - p) ** 2) * (1 - 2 * p + 2 * p * x - x * x);
    upper.push(new THREE.Vector2(x * chord, (yc + yt) * chord));
    lower.push(new THREE.Vector2(x * chord, (yc - yt) * chord));
  }
  const shape = new THREE.Shape([...upper, ...lower.reverse().slice(1)]);
  const geo = new THREE.ExtrudeGeometry(shape, { depth: span, bevelEnabled: false });
  geo.translate(-chord / 2, 0, -span / 2);
  return geo;
}

function dashScreen() {
  const c = makeCanvas(120, 50);
  if (!c) return { texture: null, draw: () => {} };
  const g = c.getContext('2d');
  const texture = canvasTexture(c);
  const draw = (t) => {
    const rpm = 0.55 + 0.4 * Math.sin(t * 1.7) * Math.sin(t * 0.6 + 1);
    g.fillStyle = '#0b1418';
    g.fillRect(0, 0, 120, 50);
    const segs = 24;
    for (let i = 0; i < segs; i++) {
      const on = i / segs < rpm;
      g.fillStyle = on ? (i > 19 ? '#ff5a4e' : i > 15 ? '#f1c94a' : '#5fd3a0') : '#1e2a2f';
      g.fillRect(6 + i * 4.5, 6, 3, 8);
    }
    g.fillStyle = '#e8f1ef';
    g.font = `700 22px ${FONTS.display}`;
    g.textBaseline = 'top';
    g.fillText(String(Math.round(40 + rpm * 90)).padStart(3, '0'), 8, 19);
    g.font = `600 7px ${FONTS.mono}`;
    g.fillStyle = '#8fa3a8';
    g.fillText('KM/H', 46, 34);
    g.font = `700 24px ${FONTS.display}`;
    g.fillStyle = '#f1c94a';
    g.fillText(String(2 + Math.floor(rpm * 3)), 96, 18);
    g.font = `600 7px ${FONTS.mono}`;
    g.fillStyle = '#8fa3a8';
    g.fillText('GEAR', 90, 41);
    texture.needsUpdate = true;
  };
  draw(0);
  return { texture, draw };
}

function wayfindingTexture(left, right) {
  const c = makeCanvas(256, 42);
  if (!c) return null;
  const g = c.getContext('2d');
  g.fillStyle = PAL.sign;
  g.fillRect(0, 0, 256, 42);
  g.fillStyle = PAL.ink;
  g.font = `700 20px ${FONTS.display}`;
  g.textBaseline = 'middle';
  if ('letterSpacing' in g) g.letterSpacing = '2px';
  const arrow = (x, dir) => {
    g.beginPath();
    g.moveTo(x, 21);
    g.lineTo(x - dir * 9, 13);
    g.lineTo(x - dir * 9, 29);
    g.closePath();
    g.fill();
  };
  const text = g.fillStyle;
  g.fillStyle = '#2fb3a4';
  if (left) arrow(10, -1);
  if (right) arrow(246, 1);
  g.fillStyle = text;
  if (left) { g.textAlign = 'left'; g.fillText(left.toUpperCase(), 26, 22, 98); }
  if (right) { g.textAlign = 'right'; g.fillText(right.toUpperCase(), 230, 22, 98); }
  return canvasTexture(c);
}

function makeSky() {
  const group = new THREE.Group();
  const R = 420;
  const geo = new THREE.SphereGeometry(R, 32, 16);
  const zenith = new THREE.Color(PAL.skyZenith);
  const mid = new THREE.Color(PAL.skyMid);
  const horizon = new THREE.Color(PAL.skyHorizon);
  const glow = new THREE.Color(PAL.skyGlow);
  const sun = new THREE.Vector3(...PAL.sunDir).normalize();
  const sunFlat = new THREE.Vector2(sun.x, sun.z).normalize();
  const d = new THREE.Vector3();
  const colors = [];
  const pos = geo.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    d.fromBufferAttribute(pos, i).normalize();
    const h = Math.max(0, d.y);
    // Warmer towards the sun, along the horizon.
    const flat = new THREE.Vector2(d.x, d.z);
    const toward = flat.lengthSq() > 1e-6 ? Math.max(0, flat.normalize().dot(sunFlat)) : 0;
    const base = horizon.clone().lerp(glow, Math.pow(toward, 3));
    const c = h < 0.22
      ? base.lerp(mid, h / 0.22)
      : mid.clone().lerp(zenith, Math.pow((h - 0.22) / 0.78, 0.6));
    colors.push(c.r, c.g, c.b);
  }
  geo.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3));
  const sky = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
  sky.name = 'sky';
  sky.renderOrder = -1;
  group.add(sky);

  if (PAL.sunDisc) {
    const at = sun.clone().multiplyScalar(R - 30);
    const halo = new THREE.Sprite(new THREE.SpriteMaterial({
      map: radialTexture(), color: PAL.skyGlow, blending: THREE.AdditiveBlending,
      transparent: true, opacity: 0.55, depthWrite: false, fog: false,
    }));
    halo.position.copy(at);
    halo.scale.setScalar(150);
    const disc = new THREE.Mesh(new THREE.CircleGeometry(13, 20), new THREE.MeshBasicMaterial({ color: '#ffe0b4', fog: false }));
    disc.position.copy(at);
    disc.lookAt(0, 0, 0);
    group.add(halo, disc);
  }
  return group;
}

function radialTexture() {
  const c = makeCanvas(64, 64);
  if (!c) return null;
  const g = c.getContext('2d');
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, 'rgba(255,255,255,1)');
  grad.addColorStop(0.25, 'rgba(255,255,255,0.45)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  return canvasTexture(c, { pixel: false });
}

// Real-time sun shadows for the sunset mood. Everything in and around the building
// receives; solid, still things cast. Moving exhibits don't cast, because main.js
// renders the shadow map once rather than every frame.
function setupShadows(root) {
  root.updateMatrixWorld(true);
  const moving = new Set();
  root.traverse((o) => {
    const ud = o.userData;
    if (ud.spin || ud.swing_amp || ud.bob || typeof ud.update === 'function') o.traverse((c) => moving.add(c));
  });
  const p = new THREE.Vector3();
  root.traverse((o) => {
    if (!o.isMesh) return;
    const m = o.material;
    if (m.transparent || o.name === 'sky') return;
    o.getWorldPosition(p);
    const near = Math.abs(p.x) < 24 && p.z > -28 && p.z < 16;
    o.receiveShadow = near && !m.isMeshBasicMaterial;
    o.castShadow = near && !moving.has(o);
  });
}

function tree(x, z) {
  const t = new THREE.Group();
  t.position.set(x, 0, z);
  const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.15, 0.2, 1.4, 6), lambert(PAL.trunk));
  trunk.position.y = 0.7;
  trunk.userData.collide = true;
  const crown = new THREE.Mesh(new THREE.ConeGeometry(1.2, 3, 6), lambert(PAL.leaf));
  crown.position.y = 2.8;
  t.add(trunk, crown);
  return t;
}

// A runway and a parked aircraft out past the left windows.
function runway() {
  const g = new THREE.Group();
  g.position.x = -46;
  const strip = new THREE.Mesh(new THREE.PlaneGeometry(12, 320), lambert(PAL.tarmac));
  strip.rotation.x = -Math.PI / 2;
  strip.position.y = 0.02;
  g.add(strip);
  const dashMat = new THREE.MeshBasicMaterial({ color: PAL.dash });
  for (let z = -150; z <= 150; z += 14) {
    const d = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 5), dashMat);
    d.rotation.x = -Math.PI / 2;
    d.position.set(0, 0.03, z);
    g.add(d);
  }
  // Edge lights: the brightest things outside, visible through the left windows.
  const lampGeo = new THREE.BoxGeometry(0.25, 0.25, 0.25);
  const lampMat = new THREE.MeshBasicMaterial({ color: '#f3e7c4', fog: false });
  for (let z = -150; z <= 150; z += 10) {
    for (const x of [-6.3, 6.3]) {
      const l = new THREE.Mesh(lampGeo, lampMat);
      l.position.set(x, 0.15, z);
      g.add(l);
    }
  }
  const plane = new THREE.Group();
  plane.position.set(0, 1.1, -24);
  const white = lambert('#9ea6aa');
  const fuselage = new THREE.Mesh(new THREE.CylinderGeometry(0.75, 0.55, 11, 8), white);
  fuselage.rotation.x = Math.PI / 2;
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.75, 1.8, 8), white);
  nose.rotation.x = -Math.PI / 2;
  nose.position.z = -6.4;
  const wing = new THREE.Mesh(new THREE.BoxGeometry(13, 0.2, 2.2), lambert('#8a9296'));
  wing.position.set(0, -0.2, -0.6);
  const tailplane = new THREE.Mesh(new THREE.BoxGeometry(4.4, 0.15, 1.2), lambert('#8a9296'));
  tailplane.position.set(0, 0.2, 4.8);
  const fin = new THREE.Mesh(new THREE.BoxGeometry(0.15, 2, 1.6), lambert(PAL.copper));
  fin.position.set(0, 1.2, 4.7);
  const navLight = (color, x, y, z) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshBasicMaterial({ color, fog: false }));
    m.position.set(x, y, z);
    return m;
  };
  plane.add(fuselage, nose, wing, tailplane, fin,
    navLight('#ff3b30', -6.5, -0.2, -0.6), navLight('#3dff7a', 6.5, -0.2, -0.6), navLight('#ffffff', 0, 2.25, 5.4));
  g.add(plane);
  return g;
}

function uniqueWings(exhibits) {
  const out = [];
  for (const e of exhibits) if (e.wing && !out.includes(e.wing)) out.push(e.wing);
  return out;
}

// A dome of single-pixel stars.
function makeStars() {
  const r = rng(5);
  const pos = [];
  for (let i = 0; i < 600; i++) {
    const theta = r() * Math.PI * 2;
    const y = 0.06 + r() * 0.94;
    const ring = Math.sqrt(1 - y * y);
    pos.push(Math.cos(theta) * ring * 400, y * 400, Math.sin(theta) * ring * 400);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  const stars = new THREE.Points(geo, new THREE.PointsMaterial({ color: '#c3cfdb', size: 1, sizeAttenuation: false, fog: false }));
  stars.name = 'stars';
  return stars;
}

// Several sign frames drawn into one tall image, top to bottom: a sprite sheet.
function spriteSheet(w, h, frames) {
  const c = makeCanvas(w, h * frames.length);
  if (!c) return null;
  const g = c.getContext('2d');
  frames.forEach((lines, i) => {
    const frame = signTexture({ w, h, bg: '#000000', lines });
    g.drawImage(frame.image, 0, i * h);
  });
  return canvasTexture(c);
}
