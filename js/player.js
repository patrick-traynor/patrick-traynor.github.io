// First-person walking: keyboard + mouse (pointer lock, with drag-to-look as a fallback)
// and a touch joystick on phones. The player stands on walk_ surfaces (or y = 0 if there
// are none), can't step off edges deeper than stepDown, and is pushed away from walls.
import * as THREE from 'three';

export class Player {
  constructor(camera, canvas, cfg) {
    this.camera = camera;
    this.canvas = canvas;
    this.cfg = cfg;
    this.pos = new THREE.Vector3();
    this.yaw = 0;
    this.pitch = 0;
    this.enabled = false;
    this.locked = false;
    this.keys = new Set();
    this.stick = { x: 0, y: 0 };
    this.bobT = 0;
    this.groundY = 0;
    this.bobAmp = 0;
    this.onLockChange = null;
    camera.rotation.order = 'YXZ';
    this.#bind();
  }

  #bind() {
    addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (this.enabled && e.code.startsWith('Arrow')) e.preventDefault();
    });
    addEventListener('keyup', (e) => this.keys.delete(e.code));
    addEventListener('blur', () => this.keys.clear());

    document.addEventListener('pointerlockchange', () => {
      this.locked = document.pointerLockElement === this.canvas;
      this.onLockChange?.(this.locked);
    });
    document.addEventListener('mousemove', (e) => {
      if (this.locked && this.enabled) this.look(e.movementX, e.movementY, this.cfg.lookSpeed);
    });

    // Drag to look, for browsers or frames where pointer lock is refused.
    let drag = null;
    this.canvas.addEventListener('pointerdown', (e) => {
      if (e.pointerType === 'mouse' && this.enabled && !this.locked) drag = { x: e.clientX, y: e.clientY };
    });
    addEventListener('pointermove', (e) => {
      if (!drag || this.locked) return;
      this.look(e.clientX - drag.x, e.clientY - drag.y, this.cfg.lookSpeed * 1.4);
      drag.x = e.clientX;
      drag.y = e.clientY;
    });
    addEventListener('pointerup', () => { drag = null; });
  }

  attachTouch(stickEl, knobEl, lookEl) {
    const R = 46;
    let stickId = null;
    let origin = null;
    const move = (e) => {
      if (e.pointerId !== stickId) return;
      let dx = e.clientX - origin.x;
      let dy = e.clientY - origin.y;
      const len = Math.hypot(dx, dy);
      if (len > R) { dx *= R / len; dy *= R / len; }
      this.stick.x = dx / R;
      this.stick.y = dy / R;
      knobEl.style.transform = `translate(${dx}px, ${dy}px)`;
    };
    const end = (e) => {
      if (e.pointerId !== stickId) return;
      stickId = null;
      this.stick.x = this.stick.y = 0;
      knobEl.style.transform = '';
    };
    stickEl.addEventListener('pointerdown', (e) => {
      stickId = e.pointerId;
      stickEl.setPointerCapture(e.pointerId);
      const r = stickEl.getBoundingClientRect();
      origin = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      move(e);
    });
    stickEl.addEventListener('pointermove', move);
    stickEl.addEventListener('pointerup', end);
    stickEl.addEventListener('pointercancel', end);

    let lookId = null;
    let last = null;
    lookEl.addEventListener('pointerdown', (e) => {
      lookId = e.pointerId;
      lookEl.setPointerCapture(e.pointerId);
      last = { x: e.clientX, y: e.clientY };
    });
    lookEl.addEventListener('pointermove', (e) => {
      if (e.pointerId !== lookId || !this.enabled) return;
      this.look(e.clientX - last.x, e.clientY - last.y, this.cfg.touchLookSpeed);
      last = { x: e.clientX, y: e.clientY };
    });
    const lookEnd = (e) => { if (e.pointerId === lookId) lookId = null; };
    lookEl.addEventListener('pointerup', lookEnd);
    lookEl.addEventListener('pointercancel', lookEnd);
  }

  lock() {
    if (!this.canvas.requestPointerLock || this.locked) return;
    try {
      const p = this.canvas.requestPointerLock();
      if (p?.catch) p.catch(() => {}); // refused: drag-to-look still works
    } catch { /* same */ }
  }

  unlock() {
    if (document.pointerLockElement) document.exitPointerLock();
  }

  place({ pos, yaw = 0, pitch = 0 }) {
    this.pos.set(pos.x, pos.y ?? 0, pos.z);
    this.groundY = this.pos.y;
    this.yaw = yaw;
    this.pitch = pitch;
    this.apply();
  }

  look(dx, dy, speed) {
    this.yaw -= dx * speed;
    this.pitch = Math.max(-1.35, Math.min(1.35, this.pitch - dy * speed));
  }

  update(dt, world) {
    let moving = false;
    if (this.enabled) {
      const k = this.keys;
      let f = (k.has('KeyW') || k.has('ArrowUp') ? 1 : 0) - (k.has('KeyS') || k.has('ArrowDown') ? 1 : 0) - this.stick.y;
      let r = (k.has('KeyD') || k.has('ArrowRight') ? 1 : 0) - (k.has('KeyA') || k.has('ArrowLeft') ? 1 : 0) + this.stick.x;
      const mag = Math.hypot(f, r);
      if (mag > 1) { f /= mag; r /= mag; }
      const run = k.has('ShiftLeft') || k.has('ShiftRight');
      const speed = run ? this.cfg.runSpeed : this.cfg.walkSpeed;
      const s = Math.sin(this.yaw);
      const c = Math.cos(this.yaw);
      const mx = (-s * f + c * r) * speed * dt;
      const mz = (-c * f - s * r) * speed * dt;
      // Small sub-steps so fast movement can't tunnel through thin walls.
      const steps = Math.max(1, Math.ceil(Math.hypot(mx, mz) / (this.cfg.playerRadius * 0.5)));
      for (let i = 0; i < steps; i++) this.#step(mx / steps, mz / steps, world);
      moving = mag > 0.05;
      if (moving) this.bobT += dt * speed * 2.4;
    }
    // Ease the feet onto the floor height so stairs and ramps feel smooth.
    this.pos.y += (this.groundY - this.pos.y) * Math.min(1, dt * 14);
    this.bobAmp += ((moving ? 1 : 0) - this.bobAmp) * Math.min(1, dt * 8);
    this.apply();
  }

  // One small move: only onto ground you could step to, sliding along edges,
  // then away from any walls at this height.
  #step(dx, dz, world) {
    const { stepUp, stepDown, playerRadius, eyeHeight } = this.cfg;
    const ground = (x, z) => world.groundAt(x, z, this.pos.y + stepUp, stepUp + stepDown);
    const px = this.pos.x;
    const pz = this.pos.z;
    let g = ground(px + dx, pz + dz);
    if (g !== null) { this.pos.x += dx; this.pos.z += dz; }
    else if ((g = ground(px + dx, pz)) !== null) this.pos.x += dx;
    else if ((g = ground(px, pz + dz)) !== null) this.pos.z += dz;
    else return; // floor edge: stay put
    resolveCircle(this.pos, playerRadius, world.collision ?? world.colliders, g, eyeHeight + 0.2);
    const after = ground(this.pos.x, this.pos.z);
    if (after === null) { this.pos.x = px; this.pos.z = pz; return; } // pushed off an edge
    this.groundY = after;
  }

  apply() {
    const bob = Math.sin(this.bobT) * 0.035 * this.bobAmp;
    this.camera.position.set(this.pos.x, this.pos.y + this.cfg.eyeHeight + bob, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0);
  }
}

// Push a circle (the player) away from any wall segments it overlaps. Only walls that
// reach above the knees (feet + 0.25 m) and start below the head (feet + height) count,
// so low kerbs are stepped over and each floor only collides with its own walls.
// walls: an array of segments, or a collision index with near(x, z, reach).
export function resolveCircle(p, r, walls, feet = 0, height = 1.8) {
  const near = Array.isArray(walls) ? walls : walls.near(p.x, p.z, r * 4);
  for (let pass = 0; pass < 4; pass++) {
    let moved = false;
    for (const s of near) {
      if (s.maxY < feet + 0.25 || s.minY > feet + height) continue;
      const dx = s.x2 - s.x1;
      const dz = s.z2 - s.z1;
      const len2 = dx * dx + dz * dz;
      const t = Math.max(0, Math.min(1, ((p.x - s.x1) * dx + (p.z - s.z1) * dz) / len2));
      const cx = s.x1 + t * dx;
      const cz = s.z1 + t * dz;
      const ox = p.x - cx;
      const oz = p.z - cz;
      const d2 = ox * ox + oz * oz;
      if (d2 >= r * r) continue;
      if (d2 > 1e-12) {
        const d = Math.sqrt(d2);
        p.x = cx + (ox / d) * r;
        p.z = cz + (oz / d) * r;
      } else {
        const len = Math.sqrt(len2); // exactly on the wall: step off to one side
        p.x = cx - (dz / len) * r;
        p.z = cz + (dx / len) * r;
      }
      moved = true;
    }
    if (!moved) break;
  }
}
