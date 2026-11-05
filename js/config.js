// Everything you are likely to tweak lives here.
export const CONFIG = {
  // Your Blender export. If this file is missing, the placeholder museum is built instead,
  // so the site always works while you are still modelling.
  modelUrl: 'models/museum.glb',

  // Text, photos and links for every exhibit, plus your name and contact details.
  dataUrl: 'exhibits.json',

  // Look
  mood: 'afternoon',     // placeholder museum lighting: 'afternoon' (4pm), 'sunset' or 'night'
  pixelScale: 0.5,       // render resolution: 1 = sharp, 0.5 = chunky, 0.33 = very retro
  pixelTextures: true,   // nearest-neighbour texture filtering for the crunchy low-res look
  bakedLighting: 'auto', // 'auto' = unlit baked textures for your .glb, real lights for the placeholder
  fov: 70,               // vertical field of view in degrees (match it on a Blender camera to preview shots)
  startPitch: -0.04,     // tilt of the camera inside the Enter button (negative = look down, sign sits higher)
  debug: true,           // the readout on the ` key (left of 1): fps, triangles, position, which export is live, warnings

  // Sky colour and fog used with your .glb. Set the fog colour to your sky's horizon colour
  // so distant scenery fades into it, or set fog to null for none.
  modelEnvironment: {
    background: '#d1d1c9',
    fog: ['#d1d1c9', 80, 380], // colour, start distance, fully-fogged distance (metres)
  },

  // Player
  eyeHeight: 1.6,        // metres above the floor
  playerRadius: 0.35,    // metres, used for collision
  stepUp: 0.45,          // highest ledge you can step onto without a ramp
  stepDown: 0.6,         // biggest drop you'll walk off; deeper edges act as barriers
  walkSpeed: 3.2,        // metres per second
  runSpeed: 5.6,         // with Shift held
  lookSpeed: 0.0022,     // mouse
  touchLookSpeed: 0.0045,

  // Exhibits
  defaultRadius: 2.8,    // how close you must be for the prompt (per-exhibit "radius" custom property overrides it)
  viewDistance: 2.2,     // where "Walk there" puts you, in metres in front of the exhibit
};
