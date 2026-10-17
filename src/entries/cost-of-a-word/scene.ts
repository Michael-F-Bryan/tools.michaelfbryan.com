import * as THREE from "three";

import { DAWN, PLACE_ORDER, arrival, decoyActive, vaelAwake, type GameState, type PlaceId, type Verb } from "./model";

export type TowerScene = {
  update(state: GameState): void;
  cast(verb: Verb): void;
  roar(): void;
  dispose(): void;
};

type Options = {
  onSelect(place: PlaceId): void;
  reducedMotion(): boolean;
};

const HALL = 1.2;
const ROOF = 4.9;
const R = 3.4;
const WALL_START = 1.85;
const WALL_END = Math.PI * 2 - 0.5;
const BREACH: [number, number] = [3.85, 4.75];
const DOOR_T = 2.2;
/** Internal resolution as a fraction of CSS pixels: the chunky pixels are the look. */
const PIXEL = 0.42;

const polar = (theta: number, r: number, y: number) => new THREE.Vector3(r * Math.sin(theta), y, r * Math.cos(theta));

const STAND: Record<PlaceId, THREE.Vector3> = {
  hearth: new THREE.Vector3(1.15, HALL, 1.5),
  nest: new THREE.Vector3(-0.2, HALL, 1.6),
  cistern: new THREE.Vector3(0.9, HALL, -0.9),
  door: polar(DOOR_T, R - 0.7, HALL),
  parapet: new THREE.Vector3(-0.4, ROOF, -2.1),
};
const HOTSPOT: Record<PlaceId, THREE.Vector3> = {
  hearth: new THREE.Vector3(0.45, HALL + 0.4, 0.8),
  nest: new THREE.Vector3(-1.5, HALL + 0.8, -0.4),
  cistern: new THREE.Vector3(1.6, HALL + 0.4, -1.6),
  door: polar(DOOR_T, R, HALL + 0.9),
  parapet: new THREE.Vector3(0.8, ROOF + 0.6, -2.2),
};

const SPELL_COLOUR: Record<Verb, string> = { move: "#ffc46b", hide: "#a993ff", mend: "#7ff0c0", still: "#bfe3ff" };

const SKY = [new THREE.Color("#090e1c"), new THREE.Color("#25233f"), new THREE.Color("#b47a63")];

export function mountTowerScene(host: HTMLElement, options: Options): TowerScene | null {
  let renderer: THREE.WebGLRenderer;
  try {
    renderer = new THREE.WebGLRenderer({ antialias: false, powerPreference: "low-power" });
  } catch {
    return null;
  }
  const canvas = renderer.domElement;
  canvas.setAttribute("aria-hidden", "true");
  host.appendChild(canvas);
  renderer.setClearColor(SKY[0]);

  const scene = new THREE.Scene();
  scene.background = SKY[0].clone();
  scene.fog = new THREE.Fog(SKY[0].clone(), 26, 80);
  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 300);
  const target = new THREE.Vector3(0, 2.6, 0);
  const focus = target.clone();

  const mat = (color: string, extra: THREE.MeshLambertMaterialParameters = {}) => new THREE.MeshLambertMaterial({ color, flatShading: true, ...extra });
  const glow = (color: string, extra: THREE.MeshBasicMaterialParameters = {}) => new THREE.MeshBasicMaterial({ color, ...extra });
  const stone = mat("#787a88");
  const stoneDark = mat("#555765");
  const floorMat = mat("#4a4549");
  const wood = mat("#6b4f35");
  const add = <T extends THREE.Object3D>(object: T, parent: THREE.Object3D = scene) => { parent.add(object); return object; };
  const mesh = (geometry: THREE.BufferGeometry, material: THREE.Material, parent?: THREE.Object3D) => add(new THREE.Mesh(geometry, material), parent);

  // Light
  const hemi = add(new THREE.HemisphereLight("#7b8fc8", "#1c1612", 1.1));
  const moon = add(new THREE.DirectionalLight("#a6b8ff", 1.3));
  moon.position.set(-12, 16, 8);
  const sun = add(new THREE.DirectionalLight("#ffb07a", 0));
  sun.position.set(22, 5, -12);

  // Hill and valley
  const hill = mesh(new THREE.CylinderGeometry(9, 15, 7, 11, 2), mat("#3d3f3a"));
  hill.position.set(-1, -3.5, -1);
  jitter(hill.geometry as THREE.BufferGeometry, 0.6, 7);
  const valley = mesh(new THREE.PlaneGeometry(260, 260, 1, 1), mat("#1d221f"));
  valley.rotation.x = -Math.PI / 2;
  valley.position.y = -7;
  const roadPath = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-70, -6.9, -90), new THREE.Vector3(-38, -6.9, -50), new THREE.Vector3(-8, -6.9, -36),
    new THREE.Vector3(18, -6.9, -24), new THREE.Vector3(22, -6.9, -4), new THREE.Vector3(14, -6.9, 14), new THREE.Vector3(30, -6.9, 40),
  ]);
  mesh(new THREE.TubeGeometry(roadPath, 80, 0.7, 3, false), mat("#3b3a33"));
  const rocks = new THREE.DodecahedronGeometry(1, 0);
  for (let i = 0; i < 18; i++) {
    const a = i * 2.39, r = 6 + (i * 37 % 7);
    const rock = mesh(rocks, stoneDark);
    rock.position.set(Math.sin(a) * r - 1, -0.2 - (i % 3) * 0.4, Math.cos(a) * r - 1);
    rock.scale.setScalar(0.3 + (i % 5) * 0.15);
    rock.rotation.set(i, i * 2, 0);
  }

  // Tower
  mesh(new THREE.CylinderGeometry(R + 0.15, R + 0.5, HALL, 10), stoneDark).position.y = HALL / 2;
  const floor = mesh(new THREE.CircleGeometry(R - 0.05, 10), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = HALL + 0.01;
  const wallHeight = ROOF - HALL + 0.25;
  const arcs: [number, number][] = [[WALL_START, BREACH[0]], [BREACH[1], WALL_END]];
  for (const [from, to] of arcs) {
    for (const radius of [R, R - 0.4]) {
      const wall = mesh(new THREE.CylinderGeometry(radius, radius, wallHeight, Math.ceil((to - from) * 3), 3, true, from, to - from), stone);
      (wall.material as THREE.Material).side = THREE.DoubleSide;
      wall.position.y = HALL + wallHeight / 2;
    }
    for (let t = from + 0.12; t < to - 0.05; t += 0.34) {
      const n = Math.floor(t * 100);
      if (n % 5 === 0) continue;
      const merlon = mesh(new THREE.BoxGeometry(0.62, 0.5 + (n % 3) * 0.18, 0.45), stone);
      merlon.position.copy(polar(t, R - 0.2, HALL + wallHeight + 0.25));
      merlon.rotation.y = t;
    }
  }
  // Broken edge at the open cutaway and breach, so the walls read as ruined rather than sliced.
  for (const [t, height] of [[WALL_START, 2.6], [BREACH[0], 1.6], [BREACH[1], 2.1], [WALL_END, 3.2]] as const) {
    for (let y = 0; y < height; y += 0.55) {
      const block = mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), stoneDark);
      block.position.copy(polar(t + (y % 1.1 > 0.5 ? 0.04 : -0.04), R - 0.2, HALL + wallHeight - y));
      block.rotation.y = t;
    }
  }
  const mendedWall = new THREE.Group();
  add(mendedWall);
  const mendedMat = mat("#8d8478", { transparent: true });
  for (const radius of [R, R - 0.4]) {
    const wall = mesh(new THREE.CylinderGeometry(radius, radius, wallHeight - 0.6, 4, 2, true, BREACH[0], BREACH[1] - BREACH[0]), mendedMat, mendedWall);
    mendedMat.side = THREE.DoubleSide;
    wall.position.y = HALL + (wallHeight - 0.6) / 2;
  }
  const fallen = new THREE.Group();
  add(fallen);
  for (let i = 0; i < 9; i++) {
    const block = mesh(new THREE.BoxGeometry(0.55, 0.4, 0.45), stoneDark, fallen);
    block.position.copy(polar(BREACH[0] + 0.1 * i, R + 0.8 + (i % 3) * 0.5, HALL - 0.2 - (i % 2) * 0.3));
    block.rotation.set(i * 0.7, i, i * 0.3);
  }

  // Roof platform at the back, with a ladder up to it.
  const roof = mesh(new THREE.CylinderGeometry(R - 0.1, R - 0.1, 0.25, 10, 1, false, 2.5, 2.6), floorMat);
  roof.position.y = ROOF - 0.12;
  for (const x of [-0.35, 0.35]) mesh(new THREE.BoxGeometry(0.08, ROOF - HALL, 0.08), wood).position.set(x, (ROOF + HALL) / 2, -1.25);
  for (let y = HALL + 0.3; y < ROOF; y += 0.42) mesh(new THREE.BoxGeometry(0.7, 0.06, 0.06), wood).position.set(0, y, -1.25);
  const wardMat = glow("#3b3554");
  const ward = mesh(new THREE.BoxGeometry(0.4, 0.8, 0.25), stone);
  ward.position.set(0.9, ROOF + 0.4, -2.4);
  const rune = mesh(new THREE.PlaneGeometry(0.22, 0.3), wardMat);
  rune.position.set(0.9, ROOF + 0.45, -2.27);

  // Doorway, stair, and its two possible seals.
  const doorway = mesh(new THREE.BoxGeometry(0.95, 1.7, 0.2), glow("#06080d"));
  doorway.position.copy(polar(DOOR_T, R + 0.05, HALL + 0.85));
  doorway.rotation.y = DOOR_T;
  const lintel = mesh(new THREE.BoxGeometry(1.3, 0.25, 0.5), stoneDark);
  lintel.position.copy(polar(DOOR_T, R + 0.05, HALL + 1.82));
  lintel.rotation.y = DOOR_T;
  const glamourMat = mat("#7c7d8b", { transparent: true, opacity: 0.96, emissive: new THREE.Color("#2a2340") });
  const glamour = mesh(new THREE.BoxGeometry(1.05, 1.8, 0.45), glamourMat);
  glamour.position.copy(polar(DOOR_T, R + 0.05, HALL + 0.9));
  glamour.rotation.y = DOOR_T;
  const steps = 9;
  const rubbleBlock = new THREE.BoxGeometry(0.34, 0.26, 0.3);
  const stairGroup = new THREE.Group();
  const rubble = new THREE.Group();
  const ice = new THREE.Group();
  add(stairGroup); add(rubble); add(ice);
  const iceMat = new THREE.MeshLambertMaterial({ color: "#c4e8ff", transparent: true, opacity: 0.62, emissive: new THREE.Color("#1d3a52"), flatShading: true });
  for (let i = 0; i < steps; i++) {
    const t = DOOR_T - 0.22 - i * 0.13;
    const y = HALL - (i + 1) * (HALL / steps);
    const step = mesh(new THREE.BoxGeometry(0.85, 0.16, 0.7), stone, stairGroup);
    step.position.copy(polar(t, R + 0.6, y + 0.08));
    step.rotation.y = t;
    const sheet = mesh(new THREE.BoxGeometry(0.9, 0.1, 0.75), iceMat, ice);
    sheet.position.copy(polar(t, R + 0.6, y + 0.2));
    sheet.rotation.set(0.05, t, 0.08);
    for (let k = 0; k < 3; k++) {
      const chunk = mesh(rubbleBlock, stoneDark, rubble);
      chunk.position.copy(polar(t + (k - 1) * 0.05, R + 0.45 + (k % 2) * 0.3, y + 0.28 + k * 0.16));
      chunk.scale.setScalar(0.8 + ((i + k) % 3) * 0.25);
      chunk.rotation.set(i + k, k * 1.3, i * 0.7);
    }
  }

  // Cistern and the dead Rider's chamber.
  const cistern = new THREE.Vector3(1.6, HALL, -1.6);
  const rim = mesh(new THREE.CylinderGeometry(0.75, 0.8, 0.5, 8, 1, true), stoneDark);
  (rim.material as THREE.Material).side = THREE.DoubleSide;
  rim.position.copy(cistern).y += 0.25;
  const waterMat = mat("#1b2422", { emissive: new THREE.Color("#050807") });
  const water = mesh(new THREE.CircleGeometry(0.72, 8), waterMat);
  water.rotation.x = -Math.PI / 2;
  water.position.copy(cistern).y += 0.38;
  const lid = mesh(new THREE.BoxGeometry(0.9, 0.16, 0.7), stone);
  const lidClosed = new THREE.Vector3(2.45, HALL + 0.08, -0.55);
  lid.position.copy(lidClosed);
  const bones = new THREE.Group();
  add(bones);
  const boneMat = mat("#d8d0bd");
  for (let i = 0; i < 4; i++) mesh(new THREE.CapsuleGeometry(0.03, 0.22, 1, 4), boneMat, bones).position.set(2.3 + i * 0.1, HALL + 0.05, -0.6 + (i % 2) * 0.1);
  mesh(new THREE.IcosahedronGeometry(0.09, 0), boneMat, bones).position.set(2.65, HALL + 0.08, -0.45);
  bones.children.forEach((bone, i) => (bone.rotation.z = Math.PI / 2 + i * 0.3));

  // Hearth
  const hearth = new THREE.Vector3(0.45, HALL, 0.8);
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2;
    const s = mesh(rocks, stoneDark);
    s.position.set(hearth.x + Math.sin(a) * 0.38, HALL + 0.06, hearth.z + Math.cos(a) * 0.38);
    s.scale.setScalar(0.11);
  }
  const coalsMat = glow("#5a1a0a");
  const coals = mesh(new THREE.CircleGeometry(0.3, 6), coalsMat);
  coals.position.set(hearth.x, HALL + 0.03, hearth.z);
  coals.rotation.x = -Math.PI / 2;
  const flames = new THREE.Group();
  flames.position.copy(hearth);
  add(flames);
  const flameMats = [glow("#ff7a2a", { transparent: true }), glow("#ffc65c", { transparent: true })];
  const flameMeshes = [0, 1, 2].map(i => {
    const f = mesh(new THREE.ConeGeometry(0.16 - i * 0.03, 0.55 - i * 0.12, 5), flameMats[i % 2], flames);
    f.position.set((i - 1) * 0.08, 0.28 - i * 0.03, (i % 2) * 0.06);
    return f;
  });
  const fireLight = add(new THREE.PointLight("#ff8a3d", 26, 18, 1.7));
  fireLight.position.copy(hearth).y += 0.7;
  const embers = makePoints(24, "#ffb15c", 2.5);
  add(embers.points);

  // Torches on the road, and the decoy light.
  const torches = makePoints(12, "#ffa64d", 3.5);
  add(torches.points);
  const decoy = mesh(new THREE.IcosahedronGeometry(0.28, 0), glow("#ffc56b"));
  const decoyLight = add(new THREE.PointLight("#ffaa55", 0, 22, 1.4));

  // Sky
  const stars = makePoints(320, "#f2f4ff", 1.6);
  for (let i = 0; i < 320; i++) {
    const a = rand(i) * Math.PI * 2, y = 0.12 + rand(i + 999) * 0.88;
    const r = Math.sqrt(1 - y * y);
    stars.positions.set([Math.cos(a) * r * 140, y * 140 - 10, Math.sin(a) * r * 140], i * 3);
  }
  stars.attribute.needsUpdate = true;
  (stars.points.material as THREE.PointsMaterial).transparent = true;
  (stars.points.material as THREE.PointsMaterial).fog = false;
  add(stars.points);
  const moonDisc = mesh(new THREE.CircleGeometry(4, 10), glow("#e9ecff", { fog: false, transparent: true }));
  moonDisc.position.set(-70, 60, -80);
  moonDisc.lookAt(0, 0, 0);

  // Vael
  const dragon = buildDragon(mat);
  dragon.group.position.set(-1.5, HALL, -0.45);
  dragon.group.rotation.y = -0.62;
  dragon.group.scale.setScalar(1.15);
  add(dragon.group);
  const mound = new THREE.Group();
  add(mound);
  const moundMat = mat("#6c6a74", { emissive: new THREE.Color("#1c1630") });
  for (let i = 0; i < 16; i++) {
    const r = mesh(rocks, moundMat, mound);
    r.position.set(-2.3 + (i % 4) * 0.6, HALL + 0.25 + (i % 3) * 0.25, -1.1 + Math.floor(i / 4) * 0.45);
    r.scale.setScalar(0.38 + (i % 3) * 0.12);
    r.rotation.set(i, i * 2, i * 3);
  }

  // You
  const rider = new THREE.Group();
  mesh(new THREE.ConeGeometry(0.2, 0.62, 6), mat("#7a2f2a"), rider).position.y = 0.31;
  mesh(new THREE.IcosahedronGeometry(0.12, 0), mat("#d6b08c"), rider).position.y = 0.7;
  rider.position.copy(STAND.hearth);
  add(rider);

  // The soldiers, who only climb the hill at dawn.
  const soldierBody = new THREE.ConeGeometry(0.17, 0.55, 5);
  const soldierHead = new THREE.IcosahedronGeometry(0.11, 0);
  const spear = new THREE.BoxGeometry(0.03, 0.9, 0.03);
  const tabard = mat("#c43a2a", { emissive: new THREE.Color("#3a0a06") });
  const steel = mat("#d5dae2", { emissive: new THREE.Color("#2a2d33") });
  const shaft = mat("#5e4630");
  const soldiers = Array.from({ length: 12 }, (_, i) => {
    const figure = new THREE.Group();
    mesh(soldierBody, tabard, figure).position.y = 0.27;
    mesh(soldierHead, steel, figure).position.y = 0.62;
    const s = mesh(spear, shaft, figure);
    s.position.set(0.16, 0.45, 0);
    s.rotation.z = -0.15 + (i % 3) * 0.1;
    figure.visible = false;
    figure.scale.setScalar(1.35);
    figure.position.copy(soldierPlace(i, 0, 0, 0, 1));
    add(figure);
    return figure;
  });
  const roarMat = glow("#ffe0a8", { transparent: true, opacity: 0, side: THREE.DoubleSide, depthWrite: false });
  const roarRing = mesh(new THREE.RingGeometry(0.85, 1, 28), roarMat);
  roarRing.rotation.x = -Math.PI / 2;
  roarRing.visible = false;
  let roarStart = -1;

  // Places you can click, with a faint ring under the current one.
  const hitMat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
  const hits = PLACE_ORDER.map(place => {
    const hit = mesh(new THREE.SphereGeometry(place === "nest" ? 1.4 : 0.9, 6, 4), hitMat);
    hit.position.copy(HOTSPOT[place]);
    hit.userData.place = place;
    return hit;
  });
  const ringMat = glow("#ffd59a", { transparent: true, opacity: 0.6, depthWrite: false });
  const ring = mesh(new THREE.RingGeometry(0.32, 0.42, 16), ringMat);
  ring.rotation.x = -Math.PI / 2;
  const hoverRing = mesh(new THREE.RingGeometry(0.32, 0.42, 16), glow("#ffffff", { transparent: true, opacity: 0.35, depthWrite: false }));
  hoverRing.rotation.x = -Math.PI / 2;
  hoverRing.visible = false;

  // Spell motes
  const motes = makePoints(90, "#ffffff", 3.5);
  const moteMat = motes.points.material as THREE.PointsMaterial;
  moteMat.transparent = true;
  moteMat.blending = THREE.AdditiveBlending;
  moteMat.depthWrite = false;
  motes.points.visible = false;
  add(motes.points);
  const moteVelocity = new Float32Array(90 * 3);
  let moteStart = -1;
  let moteOrigin = new THREE.Vector3();

  // State mirrored from the game.
  let state: GameState | null = null;
  let flightStart = -1;
  let hovered: PlaceId | null = null;
  let disposed = false;
  let frameId = 0;
  let castTime = 0;
  const clockStart = performance.now();

  function resize() {
    if (disposed) return;
    const { width, height } = host.getBoundingClientRect();
    const w = Math.max(1, Math.floor(width)), h = Math.max(1, Math.floor(height));
    renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2) * PIXEL);
    renderer.setSize(w, h);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(host);
  resize();

  const raycaster = new THREE.Raycaster();
  const pointer = new THREE.Vector2();
  function pick(event: PointerEvent | MouseEvent): PlaceId | null {
    const rect = canvas.getBoundingClientRect();
    pointer.set(((event.clientX - rect.left) / rect.width) * 2 - 1, -((event.clientY - rect.top) / rect.height) * 2 + 1);
    raycaster.setFromCamera(pointer, camera);
    const hit = raycaster.intersectObjects(hits, false)[0];
    return (hit?.object.userData.place as PlaceId | undefined) ?? null;
  }
  function pointerMove(event: PointerEvent) {
    hovered = event.pointerType === "mouse" ? pick(event) : null;
    canvas.style.cursor = hovered && !state?.ending ? "pointer" : "default";
  }
  function click(event: MouseEvent) {
    const place = pick(event);
    if (place && !state?.ending) options.onSelect(place);
  }
  function pointerLeave() { hovered = null; }
  canvas.addEventListener("pointermove", pointerMove);
  canvas.addEventListener("pointerleave", pointerLeave);
  canvas.addEventListener("click", click);

  function frame(now: number) {
    frameId = requestAnimationFrame(frame);
    if (document.hidden || !state) return;
    const t = (now - clockStart) / 1000;
    const still = options.reducedMotion();
    const s = state;

    // Night into dawn.
    const light = THREE.MathUtils.smoothstep(s.minutes, DAWN - 180, DAWN);
    const sky = light < 0.6 ? SKY[0].clone().lerp(SKY[1], light / 0.6) : SKY[1].clone().lerp(SKY[2], (light - 0.6) / 0.4);
    (scene.background as THREE.Color).copy(sky);
    (scene.fog as THREE.Fog).color.copy(sky);
    hemi.intensity = 1.1 + light * 1.4;
    sun.intensity = light * 2.2;
    moon.intensity = 1.3 * (1 - light * 0.7);
    (stars.points.material as THREE.PointsMaterial).opacity = 1 - light;
    (moonDisc.material as THREE.MeshBasicMaterial).opacity = 1 - light * 0.6;

    // Fire
    const flicker = still ? 1 : 0.85 + Math.sin(t * 13) * 0.08 + Math.sin(t * 7.3) * 0.07;
    const burning = s.fire === "lit" || s.fire === "hidden";
    flames.visible = burning;
    flameMats.forEach(m => (m.opacity = s.fire === "hidden" ? 0.35 : 1));
    flameMats[0].color.set(s.fire === "hidden" ? "#9a6bff" : "#ff7a2a");
    flameMeshes.forEach((f, i) => f.scale.set(1, flicker + i * 0.05, 1));
    fireLight.intensity = s.fire === "lit" ? 26 * flicker : s.fire === "hidden" ? 3 : 0;
    coalsMat.color.set(burning ? "#7a2a0e" : s.fire === "out" ? "#3a120a" : "#1a1513");
    embers.points.visible = s.fire === "lit" && !still;
    for (let i = 0; i < 24; i++) {
      const p = (t * 0.35 + rand(i)) % 1;
      embers.positions.set([hearth.x + Math.sin(i * 3 + t) * 0.18 * p, HALL + 0.3 + p * 2.6, hearth.z + Math.cos(i * 5 + t) * 0.18 * p], i * 3);
    }
    embers.attribute.needsUpdate = true;

    // Soldiers
    const due = arrival(s);
    const progress = THREE.MathUtils.clamp((s.minutes - 60) / (due - 60), 0, 1);
    torches.points.visible = s.minutes >= 90 && !s.torchesSnuffed && !s.dawn && s.ending !== "flight";
    for (let i = 0; i < 12; i++) {
      const u = THREE.MathUtils.clamp(0.06 + progress * 0.62 - i * 0.006, 0, 1);
      const p = roadPath.getPointAt(u);
      torches.positions.set([p.x + Math.sin(i * 2.1) * 0.9, p.y + 0.9 + (still ? 0 : Math.sin(t * 9 + i) * 0.05), p.z + Math.cos(i * 1.3) * 0.9], i * 3);
    }
    torches.attribute.needsUpdate = true;

    // Decoy
    const wandering = decoyActive(s) || (s.decoyAt !== null && s.ending === "decoy");
    decoy.visible = wandering;
    decoyLight.intensity = wandering ? 18 * flicker : 0;
    if (wandering) {
      const age = s.minutes - (s.decoyAt ?? 0);
      const leave = still ? 1 : THREE.MathUtils.clamp((now - castTime) / 4000, 0, 1);
      const out = new THREE.Vector3(-20 - age * 0.12 + (still ? 0 : Math.sin(t * 0.4) * 2), -5.5, 18 + age * 0.05);
      const pos = age > 0 || leave >= 1 ? out : hearth.clone().add(new THREE.Vector3(0, 1, 0)).lerp(out, leave);
      decoy.position.copy(pos);
      decoyLight.position.copy(pos);
    }

    // Stair, doorway, wall, cistern, ward-stone
    rubble.visible = s.stair === "blocked";
    ice.visible = s.stair === "iced";
    glamour.visible = s.doorHidden;
    glamourMat.opacity = still ? 0.96 : 0.9 + Math.sin(t * 2) * 0.06;
    mendedWall.visible = s.wallMended;
    fallen.visible = !s.wallMended;
    waterMat.color.set(s.stair === "iced" ? "#0d1214" : s.waterPure ? "#3e8aa3" : "#1b2422");
    lid.position.lerp(s.lidMoved ? new THREE.Vector3(2.9, HALL + 0.08, 0.3) : lidClosed, still ? 1 : 0.06);
    lid.rotation.y = s.lidMoved ? 0.8 : 0;
    bones.visible = s.lidMoved;
    wardMat.color.set(s.words.includes("hide") ? "#b8a6ff" : "#3b3554");
    (lintel.material as THREE.MeshLambertMaterial).emissive.set(s.words.includes("stone") ? "#2a2236" : "#000000");

    // Vael
    const asleep = !vaelAwake(s);
    const roarAge = roarStart < 0 ? -1 : (now - roarStart) / 1000;
    const roaring = roarAge >= 0 && roarAge < 1.6 ? Math.sin((roarAge / 1.6) * Math.PI) : 0;
    dragon.animate(t, still, { asleep, wing: s.wing, look: rider.position, roaring });
    roarRing.visible = roarAge >= 0 && roarAge < 1.4;
    if (roarRing.visible) {
      roarRing.position.set(-0.4, HALL + 1.2, 0.2);
      roarRing.scale.setScalar(1 + roarAge * 7);
      roarMat.opacity = 0.7 * (1 - roarAge / 1.4);
    } else if (roarAge >= 1.6) roarStart = -1;

    // Soldiers
    const dawn = s.dawn;
    soldiers.forEach((figure, i) => {
      figure.visible = Boolean(dawn) && i < (dawn?.soldiers ?? 0);
      if (!dawn || !figure.visible) return;
      const place = soldierTarget(i, s, t, still);
      const moving = figure.position.distanceTo(place) > 0.05;
      figure.position.lerp(place, still ? 1 : 0.08);
      figure.children[0].position.y = 0.27 + (moving && !still ? Math.abs(Math.sin(t * 11 + i)) * 0.06 : 0);
      figure.rotation.y = Math.atan2(-figure.position.x, -figure.position.z) + (s.ending === "stand" ? Math.PI : 0);
    });
    dragon.setGhost(s.vaelHidden ? 0.08 : 1);
    mound.visible = s.vaelHidden;
    if (s.ending === "flight") {
      if (flightStart < 0) flightStart = now;
      const k = still ? 1 : THREE.MathUtils.clamp((now - flightStart) / 6000, 0, 1);
      const path = new THREE.CatmullRomCurve3([new THREE.Vector3(-1.5, HALL, -0.45), polar(4.3, R + 3, HALL + 1.5), new THREE.Vector3(-18, 9, -12), new THREE.Vector3(-60, 22, -70)]);
      dragon.group.position.copy(path.getPointAt(k));
      dragon.group.rotation.y = -0.62 + k * 1.8;
      rider.visible = false;
    } else {
      flightStart = -1;
      dragon.group.position.set(-1.5, HALL, -0.45);
      dragon.group.rotation.y = -0.62;
      rider.visible = true;
    }

    // You, and the place markers
    const stand = STAND[s.place];
    rider.position.lerp(stand, still ? 1 : 0.08);
    rider.rotation.z = s.ending === "spent" ? Math.PI / 2 : 0;
    rider.position.y = s.ending === "spent" ? stand.y + 0.15 : rider.position.y;
    ring.position.set(stand.x, stand.y + 0.03, stand.z);
    ring.visible = !s.ending;
    ringMat.opacity = still ? 0.6 : 0.45 + Math.sin(t * 2.5) * 0.15;
    hoverRing.visible = Boolean(hovered && hovered !== s.place && !s.ending);
    if (hovered) hoverRing.position.set(STAND[hovered].x, STAND[hovered].y + 0.03, STAND[hovered].z);

    // Spell motes
    if (moteStart >= 0) {
      const age = (now - moteStart) / 1000;
      if (age > 1.8) { motes.points.visible = false; moteStart = -1; }
      else {
        motes.points.visible = true;
        moteMat.opacity = 1 - age / 1.8;
        for (let i = 0; i < 90; i++) {
          motes.positions.set([moteOrigin.x + moteVelocity[i * 3] * age, moteOrigin.y + moteVelocity[i * 3 + 1] * age, moteOrigin.z + moteVelocity[i * 3 + 2] * age], i * 3);
        }
        motes.attribute.needsUpdate = true;
      }
    }

    // Camera: a slow breath around the diorama, leaning toward where you are.
    const aspect = camera.aspect;
    // Pull back at dawn so the hill and the men on it are in frame.
    const distance = (aspect < 1 ? 20 + (1 - aspect) * 18 : 17.5) + (s.dawn ? 3.5 : 0);
    focus.lerp(target.clone().lerp(new THREE.Vector3(stand.x, stand.y + 0.6, stand.z), 0.22), still ? 1 : 0.03);
    const azimuth = 0.62 + (still ? 0 : Math.sin(t * 0.07) * 0.05);
    const elevation = 0.36 + (still ? 0 : Math.sin(t * 0.05) * 0.015);
    camera.position.set(
      focus.x + distance * Math.cos(elevation) * Math.sin(azimuth),
      focus.y + distance * Math.sin(elevation),
      focus.z + distance * Math.cos(elevation) * Math.cos(azimuth),
    );
    camera.lookAt(focus);
    renderer.render(scene, camera);
  }
  frameId = requestAnimationFrame(frame);

  return {
    update(next) { state = next; },
    cast(verb) {
      if (!state) return;
      castTime = performance.now();
      moteOrigin = HOTSPOT[state.place].clone();
      moteMat.color.set(SPELL_COLOUR[verb]);
      for (let i = 0; i < 90; i++) {
        const a = rand(i + castTime) * Math.PI * 2, up = rand(i * 7 + castTime);
        moteVelocity.set([Math.cos(a) * (0.4 + up), 0.4 + up * 1.6, Math.sin(a) * (0.4 + up)], i * 3);
      }
      if (!options.reducedMotion()) moteStart = castTime;
    },
    roar() {
      if (!options.reducedMotion()) roarStart = performance.now();
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(frameId);
      sizeObserver.disconnect();
      canvas.removeEventListener("pointermove", pointerMove);
      canvas.removeEventListener("pointerleave", pointerLeave);
      canvas.removeEventListener("click", click);
      const geometries = new Set<THREE.BufferGeometry>();
      const materials = new Set<THREE.Material>();
      scene.traverse(object => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Points) {
          geometries.add(object.geometry);
          for (const m of [object.material].flat()) materials.add(m);
        }
      });
      geometries.forEach(g => g.dispose());
      materials.forEach(m => m.dispose());
      renderer.dispose();
      renderer.forceContextLoss();
      canvas.remove();
    },
  };
}

/** The hilltop is flat to about this radius, then falls away. */
function hillY(radius: number) {
  return radius <= 8.4 ? 0 : -(radius - 8.4) * 1.15;
}

function soldierPlace(i: number, angle: number, radius: number, spread: number, rows: number) {
  const a = angle + (i % Math.ceil(12 / rows)) * spread;
  const r = radius + Math.floor(i / Math.ceil(12 / rows)) * 0.55;
  return polar(a, r, hillY(r));
}

function soldierTarget(i: number, s: GameState, t: number, still: boolean): THREE.Vector3 {
  const dawn = s.dawn!;
  if (s.ending === "stand") return soldierPlace(i, 0.7, 13, 0.1, 2);
  if (s.ending === "unseen" || s.ending === "decoy") return soldierPlace(i, 1.4, 15, 0.05, 3);
  if (!dawn.found) {
    const wander = still ? 0 : Math.sin(t * 0.25 + i * 1.7) * 0.07;
    const radius = 8.9 - (dawn.suspicion / 100) * 2.2 + (i % 3) * 0.45;
    return polar(-0.5 + (i / 12) * 2.8 + wander, radius, hillY(radius));
  }
  if (dawn.reach === 0) return soldierPlace(i, 0.55, 8.2, 0.13, 2);
  if (dawn.reach === 1) return soldierPlace(i, 0.75, 5.8, 0.12, 2);
  const steps = 9;
  const onStair = dawn.reach === 3 ? 6 : 2 + dawn.climb * 2;
  if (dawn.reach === 3 && i < 3) return polar(DOOR_T + (i - 1) * 0.12, R - 0.8, HALL);
  if (i < onStair) {
    // Step 0 is the top of the stair; the man with the highest index leads.
    const step = THREE.MathUtils.clamp(steps - 1 - i - dawn.climb * 2, 0, steps - 1);
    const y = HALL - (step + 1) * (HALL / steps) + 0.16;
    return polar(DOOR_T - 0.22 - step * 0.13, R + 0.6, y + (dawn.held && i === onStair - 1 ? 0.1 : 0));
  }
  return soldierPlace(i, DOOR_T - 1.55, R + 1.6, 0.16, 2);
}

function makePoints(count: number, color: string, size: number) {
  const positions = new Float32Array(count * 3);
  const geometry = new THREE.BufferGeometry();
  const attribute = new THREE.BufferAttribute(positions, 3);
  geometry.setAttribute("position", attribute);
  const points = new THREE.Points(geometry, new THREE.PointsMaterial({ color, size, sizeAttenuation: false }));
  points.frustumCulled = false;
  return { points, positions, attribute };
}

function rand(seed: number) {
  const x = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return x - Math.floor(x);
}

function jitter(geometry: THREE.BufferGeometry, amount: number, seed: number) {
  const position = geometry.getAttribute("position");
  const moved = new Map<string, [number, number, number]>();
  for (let i = 0; i < position.count; i++) {
    const key = `${position.getX(i).toFixed(3)},${position.getY(i).toFixed(3)},${position.getZ(i).toFixed(3)}`;
    let offset = moved.get(key);
    if (!offset) {
      const n = moved.size + seed;
      offset = [(rand(n) - 0.5) * amount, (rand(n + 50) - 0.5) * amount, (rand(n + 90) - 0.5) * amount];
      moved.set(key, offset);
    }
    position.setXYZ(i, position.getX(i) + offset[0], position.getY(i) + offset[1], position.getZ(i) + offset[2]);
  }
  geometry.computeVertexNormals();
}

/** A low-poly dragon curled on her side, facing local +x. */
function buildDragon(mat: (color: string, extra?: THREE.MeshLambertMaterialParameters) => THREE.MeshLambertMaterial) {
  const group = new THREE.Group();
  const scale = mat("#2f6a8c");
  const dark = mat("#1e4561");
  const membrane = mat("#4b86a8", { side: THREE.DoubleSide });
  const horn = mat("#d9cfb4");
  const eyeMat = new THREE.MeshBasicMaterial({ color: "#ffd36e" });
  const materials = [scale, dark, membrane, horn];
  const put = (geometry: THREE.BufferGeometry, material: THREE.Material, parent: THREE.Object3D, x: number, y: number, z: number) => {
    const m = new THREE.Mesh(geometry, material);
    m.position.set(x, y, z);
    parent.add(m);
    return m;
  };

  const body = put(new THREE.IcosahedronGeometry(1, 1), scale, group, 0, 0.62, 0);
  body.scale.set(1.25, 0.62, 0.8);
  for (let i = 0; i < 5; i++) {
    const spike = put(new THREE.ConeGeometry(0.09, 0.28, 4), horn, group, -0.9 + i * 0.42, 1.12 - Math.abs(i - 2) * 0.06, 0);
    spike.rotation.z = -0.3;
  }
  for (const [x, z] of [[0.7, 0.5], [0.7, -0.5], [-0.7, 0.55], [-0.7, -0.55]]) put(new THREE.BoxGeometry(0.28, 0.3, 0.28), dark, group, x, 0.15, z);

  // Tail curls round in front of her.
  for (let i = 0; i < 7; i++) {
    const a = Math.PI + 0.3 + i * 0.36;
    const seg = put(new THREE.ConeGeometry(0.26 - i * 0.03, 0.55, 5), scale, group, Math.cos(a) * 1.25 + 0.15, 0.2, -Math.sin(a) * 1.05 + 0.25);
    seg.rotation.set(Math.PI / 2, 0, a + Math.PI);
  }

  // Neck and head on a pivot so she can look at you.
  const neck = new THREE.Group();
  neck.position.set(1.05, 0.75, 0.1);
  group.add(neck);
  for (let i = 0; i < 3; i++) put(new THREE.BoxGeometry(0.42, 0.36, 0.36), scale, neck, i * 0.3, i * 0.16, 0).rotation.z = 0.45;
  const head = new THREE.Group();
  head.position.set(0.95, 0.5, 0);
  neck.add(head);
  put(new THREE.BoxGeometry(0.5, 0.3, 0.36), scale, head, 0, 0, 0);
  const snout = put(new THREE.ConeGeometry(0.17, 0.45, 4), dark, head, 0.42, -0.04, 0);
  snout.rotation.z = -Math.PI / 2;
  for (const z of [-0.12, 0.12]) {
    const h = put(new THREE.ConeGeometry(0.05, 0.38, 4), horn, head, -0.3, 0.18, z);
    h.rotation.z = 1.1;
  }
  const eyes = [-0.19, 0.19].map(z => put(new THREE.BoxGeometry(0.08, 0.06, 0.03), eyeMat, head, 0.1, 0.06, z));

  // Wings: a folded good one, and the hurt one dragging.
  const wingGeometry = new THREE.BufferGeometry();
  wingGeometry.setAttribute("position", new THREE.Float32BufferAttribute([0, 0, 0, -1.9, 0.1, 0.4, -1.2, -0.1, 1.3, 0, 0, 0, -1.2, -0.1, 1.3, -0.2, -0.05, 1.5], 3));
  wingGeometry.computeVertexNormals();
  const good = new THREE.Group();
  good.position.set(0.35, 1.0, -0.3);
  group.add(good);
  good.add(new THREE.Mesh(wingGeometry, membrane));
  good.children[0].scale.set(1, 1, -1);
  good.rotation.x = -0.25;
  const hurt = new THREE.Group();
  hurt.position.set(0.35, 1.0, 0.35);
  group.add(hurt);
  hurt.add(new THREE.Mesh(wingGeometry, membrane));
  const bandage = put(new THREE.BoxGeometry(0.2, 0.08, 0.12), mat("#c9c1ad"), hurt, -0.9, 0, 0.55);
  materials.push(bandage.material as THREE.MeshLambertMaterial);
  for (const m of materials) m.transparent = true;

  let breathe = 0;
  return {
    group,
    setGhost(opacity: number) { for (const m of materials) { m.opacity = opacity; m.depthWrite = opacity > 0.5; } eyeMat.transparent = opacity < 1; eyeMat.opacity = opacity; },
    animate(t: number, still: boolean, s: { asleep: boolean; wing: 0 | 1 | 2; look: THREE.Vector3; roaring: number }) {
      breathe = still ? 0 : Math.sin(t * (s.asleep ? 0.9 : 1.6));
      body.scale.y = 0.62 + breathe * 0.025;
      const local = group.worldToLocal(s.look.clone());
      const yaw = Math.atan2(-(local.z - 0.1), local.x - 1.05);
      neck.rotation.y = s.asleep ? 0.3 : THREE.MathUtils.lerp(neck.rotation.y, THREE.MathUtils.clamp(yaw, -1, 1), still ? 1 : 0.05);
      neck.rotation.z = s.asleep ? -0.55 : s.roaring * 0.7 + (still ? 0 : Math.sin(t * 0.7) * 0.04);
      const blink = s.asleep || (!still && t % 4.3 < 0.12);
      eyes.forEach(e => (e.scale.y = blink ? 0.15 : 1));
      hurt.rotation.x = [1.2, 0.65, -0.45][s.wing];
      hurt.rotation.z = s.wing === 2 && !still ? Math.sin(t * 1.4) * 0.18 : 0;
      good.rotation.x = s.wing === 2 ? 0.45 + (still ? 0 : Math.sin(t * 1.4) * 0.12) : -0.25;
      bandage.visible = s.wing < 2;
    },
  };
}
