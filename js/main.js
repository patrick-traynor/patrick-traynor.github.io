// Wires it all together: data, renderer, world, player, UI and the frame loop.
// On the landing page the canvas lives inside the "Enter the museum" button;
// in play mode it moves to a full-screen stage. Same renderer, same world.
import * as THREE from 'three';
import { CONFIG } from './config.js';
import { loadWorld, findTarget, animateWorld, updateApproach, updateVideos, unblockVideos } from './world.js';
import { Player } from './player.js';
import { createUI } from './ui.js';

const PREVIEW = Boolean(window.__MUSEUM_PREVIEW__);
const isTouch = matchMedia('(pointer: coarse)').matches;
document.documentElement.classList.toggle('touch', isTouch);

const canvas = document.getElementById('scene');
const enterView = document.getElementById('enter-view');
const enterButton = document.getElementById('btn-enter');
const stage = document.getElementById('stage');

let data;
try {
  // no-cache: always check for a newer exhibits.json (an unchanged one still comes from the cache)
  data = window.__MUSEUM_DATA__ ?? (await (await fetch(CONFIG.dataUrl, { cache: 'no-cache' })).json());
} catch (err) {
  document.getElementById('start-status').textContent =
    location.protocol === 'file:'
      ? 'Open this through a local web server, not by double-clicking the file (see README).'
      : `Couldn't read ${CONFIG.dataUrl}: ${err.message}`;
  throw err;
}

let mode = 'start';
let world = null;
let player = null;
let target = null;
let renderer = null;
let camera = null;
let landingScroll = 0;
let buttonVisible = true;

const ui = createUI(data, {
  touch: isTouch,
  onEnter: enter,
  onExit: leave,
  onVisit: visit,
  onInteract: interact,
  onResume: () => player?.lock(),
  onOverlay(open, viaClick) {
    if (open) player?.unlock();
    else if (mode === 'play' && !isTouch && viaClick) player?.lock();
  },
});

// A shareable link straight to the guide: yoursite/#guide
if (location.hash === '#guide') ui.openGuide();
addEventListener('hashchange', () => { if (location.hash === '#guide') ui.openGuide(); });

// ---------- Renderer ----------
try {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
} catch (err) {
  console.error(err);
}

if (!renderer) {
  ui.noWebGL('3D isn’t available in this browser, so everything is listed in the guide below.');
} else {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#000000');
  scene.fog = new THREE.Fog('#020406', 40, 210);
  camera = new THREE.PerspectiveCamera(CONFIG.fov, 16 / 9, 0.05, 900);

  resize();
  addEventListener('resize', resize);
  new ResizeObserver(() => { if (mode === 'start') resize(); }).observe(enterView);
  // Don't spend battery rendering the button while it's scrolled out of view.
  new IntersectionObserver(([e]) => { buttonVisible = e.isIntersecting; }).observe(enterButton);

  await fontsReady(); // signs are drawn with the web fonts, so wait for them briefly
  ui.setStatus('Building the gallery...');
  world = await loadWorld({ cfg: CONFIG, data, tryModel: !PREVIEW });
  scene.add(world.root);

  // Sky colour and fog: the placeholder brings its own; your .glb uses CONFIG.modelEnvironment.
  const env = world.root.userData.environment ?? (world.source === 'model' ? CONFIG.modelEnvironment : null);
  if (env) {
    if (env.background) scene.background.set(env.background);
    if (env.fog) {
      scene.fog.color.set(env.fog[0]);
      scene.fog.near = env.fog[1];
      scene.fog.far = env.fog[2];
    } else scene.fog = null;
    if (env.shadows) {
      renderer.shadowMap.enabled = true;
      renderer.shadowMap.type = THREE.BasicShadowMap; // hard-edged, matches the pixel look
      renderer.shadowMap.autoUpdate = false; // the building doesn't move, so draw shadows once
      renderer.shadowMap.needsUpdate = true;
    }
  }

  player = new Player(camera, canvas, CONFIG);
  if (isTouch) player.attachTouch(document.getElementById('stick'), document.getElementById('stick-knob'), document.getElementById('look-zone'));
  player.onLockChange = (locked) => {
    if (locked) ui.showPaused(false);
    else if (mode === 'play' && !ui.isOpen()) ui.showPaused(true);
  };
  canvas.addEventListener('click', () => {
    if (mode === 'play' && !isTouch && !ui.isOpen()) player.lock();
  });

  player.place(world.spawn);
  ui.ready(new Set(world.exhibits.map((e) => e.id)));

  const clock = new THREE.Clock();
  const p = new THREE.Vector3();
  let videoTimer = 1; // check video distances a few times a second, not every frame
  renderer.setAnimationLoop(() => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    if (mode === 'start' && !buttonVisible) return;
    animateWorld(world, t, dt);
    if ((videoTimer += dt) > 0.4) { videoTimer = 0; updateVideos(world, player.pos); }

    if (mode === 'start') {
      // Inside the button: an idle camera at the spawn, looking up at the facade.
      player.yaw = world.spawn.yaw + Math.sin(t * 0.22) * 0.05;
      player.pitch = CONFIG.startPitch + Math.sin(t * 0.17) * 0.015;
      player.apply();
    } else {
      player.enabled = !ui.isOpen() && !ui.isPaused();
      player.update(dt, world);
      updateApproach(world, player.pos);
    }

    target = mode === 'play' && player.enabled ? findTarget(world, player.pos, player.yaw) : null;
    if (target) {
      p.copy(target.anchor);
      p.y += target.kind === 'guide' ? 0.4 : 0.55;
      p.project(camera);
      if (p.z < 1) ui.setPrompt(target, (p.x * 0.5 + 0.5) * innerWidth, (-p.y * 0.5 + 0.5) * innerHeight);
      else ui.setPrompt(null);
    } else ui.setPrompt(null);

    renderer.render(scene, camera);
    debug.tick(dt);
  });
}

// ---------- Debug readout: press ` (the key left of 1) ----------
// Frame rate, triangles, draw calls and your position in both three.js and Blender
// coordinates, handy for placing spawn points and checking budgets.
const debug = (() => {
  const box = document.createElement('pre');
  box.id = 'debug';
  box.hidden = true;
  document.body.append(box);
  let acc = 0;
  let frames = 0;
  addEventListener('keydown', (e) => { if (e.code === 'Backquote' && CONFIG.debug) box.hidden = !box.hidden; });
  const f = (n) => n.toFixed(2).padStart(7);
  return {
    tick(dt) {
      frames++;
      acc += dt;
      if (box.hidden || acc < 0.25) return;
      const info = renderer.info.render;
      const p = player.pos;
      const yaw = (((-player.yaw * 180) / Math.PI) % 360 + 360) % 360;
      box.textContent = [
        `fps        ${Math.round(frames / acc)}`,
        `triangles  ${info.triangles.toLocaleString()}`,
        `draw calls ${info.calls}`,
        `source     ${world.source}${world.saved ? `, exported ${world.saved.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} ${world.saved.toLocaleDateString([], { day: 'numeric', month: 'short' })}` : ''}`,
        `three   x${f(p.x)} y${f(p.y)} z${f(p.z)}`,
        `blender x${f(p.x)} y${f(-p.z)} z${f(p.y)}`,
        `heading    ${yaw.toFixed(0)} deg`,
        world.warnings.length ? `warnings   ${world.warnings.length} (F12 console)` : 'warnings   none',
      ].join('\n');
      acc = 0;
      frames = 0;
    },
  };
})();

function resize() {
  if (!renderer) return;
  const play = mode === 'play';
  const w = play ? innerWidth : enterView.clientWidth;
  const h = play ? innerHeight : enterView.clientHeight;
  if (!w || !h) return;
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * CONFIG.pixelScale);
  renderer.setSize(w, h);
  camera.aspect = w / h;
  // On tall, narrow screens keep at least ~62 degrees of horizontal view so nothing gets cropped.
  const minVertical = (2 * Math.atan(Math.tan((62 * Math.PI) / 360) / camera.aspect) * 180) / Math.PI;
  camera.fov = Math.max(CONFIG.fov, Math.min(minVertical, 95));
  camera.updateProjectionMatrix();
}

// Move the one canvas between the button and the full-screen stage.
function mount(play) {
  (play ? stage : enterView).appendChild(canvas);
  resize();
}

// ---------- Actions ----------
function startPlaying(pose) {
  if (!world) return;
  if (mode === 'start') landingScroll = scrollY;
  mode = 'play';
  ui.closeAll();
  ui.setMode('play');
  mount(true);
  player.place(pose);
  unblockVideos(world); // this click lets browsers that blocked autoplay start the videos
  updateVideos(world, player.pos);
  if (!isTouch) player.lock(); // called from a click, which pointer lock requires
}

function enter() {
  startPlaying(world?.spawn);
}

function visit(id) {
  const ex = world?.exhibits.find((e) => e.id === id);
  if (ex) startPlaying(ex.view);
}

function leave() {
  mode = 'start';
  player?.unlock();
  ui.closeAll();
  ui.setMode('start');
  mount(false);
  if (world) player.place(world.spawn);
  scrollTo(0, landingScroll);
}

function interact() {
  if (!target) return;
  if (target.kind === 'guide') ui.openGuide();
  else ui.openPanel(target.id);
}

addEventListener('keydown', (e) => {
  if (e.code === 'Escape') {
    if (ui.isOpen()) { ui.closeTop(); e.preventDefault(); }
    return;
  }
  if (e.repeat) return;
  if (e.code === 'KeyE' && mode === 'play' && !ui.isOpen()) interact();
  if (e.code === 'KeyG') {
    if (ui.isOpen()) {
      ui.closeAll();
      if (mode === 'play' && !isTouch) player?.lock();
    } else ui.openGuide();
  }
});

async function fontsReady() {
  if (!document.fonts?.load) return;
  const wait = Promise.all([
    document.fonts.load('700 40px "Barlow Condensed"'),
    document.fonts.load('600 12px "IBM Plex Mono"'),
  ]);
  await Promise.race([wait, new Promise((r) => setTimeout(r, 2500))]).catch(() => {});
}
