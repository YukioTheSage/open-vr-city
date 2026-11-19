import { createWorld } from './scene.js';
import { createControls } from './controls.js';
import { createNetworkClient } from './network.js';

const world = createWorld();
const controls = createControls({
  rig: world.rig,
  camera: world.camera,
  renderer: world.renderer,
});
const network = createNetworkClient({
  statusEl: document.getElementById('status'),
  rig: world.rig,
  renderer: world.renderer,
  controls,
  world,
});

let lastTime = 0;

world.renderer.setAnimationLoop((time) => {
  const dt = lastTime ? Math.min((time - lastTime) / 1000, 0.1) : 1 / 60;
  lastTime = time;

  world.updateMonument(dt);
  controls.update(dt);
  world.interpolateAvatars(network.avatars, dt);
  network.sync(time);

  world.renderer.render(world.scene, world.camera);
});
