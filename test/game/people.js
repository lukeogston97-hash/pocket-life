/* ---------- people ---------- */
const HIP_Y = 0.86, WAIST_Y = 1.08;
const headGeo = new THREE.IcosahedronGeometry(0.16, 1);
const capGeo = new THREE.SphereGeometry(0.19, 10, 6, 0, Math.PI * 2, 0, Math.PI * 0.5);
const longHairGeo = new THREE.CylinderGeometry(0.168, 0.188, 0.34, 10, 1, true, Math.PI * 0.5, Math.PI);
const bunGeo = new THREE.IcosahedronGeometry(0.078, 0);
const eyeGeo = new THREE.IcosahedronGeometry(0.018, 0);
const handGeo = new THREE.IcosahedronGeometry(0.05, 0);
const footGeo = new THREE.BoxGeometry(0.11, 0.07, 0.21).translate(0, -0.035, 0.035);
const yokeGeo = new THREE.IcosahedronGeometry(1, 1);
const footMat = mat('#5b4636');
footMat.userData.shared = true;
const eyeMat = mat('#2a2420');
eyeMat.userData.shared = true;
const greyHair = new THREE.Color('#aaa59d');
function hairColourFor(look) {
  const c = new THREE.Color(find(LOOKS.hairColour, look.hairColour).hex);
  return c.lerp(greyHair, clamp01((look.age - 50) / 30) * 0.85);
}
const own = (geo) => { geo.userData.perPerson = true; return geo; };
function makePerson(look) {
  const B = BODY_SHAPES[find(LOOKS.sex, look.sex).id] || Object.values(BODY_SHAPES)[0];
  const w = find(LOOKS.build, look.build).w;
  const tunic = find(LOOKS.tunic, look.tunic);
  const skin = mat(find(LOOKS.skin, look.skin).hex);
  const hair = mat(hairColourFor(look), { side: THREE.DoubleSide });
  const cloth = mat(tunic.hex);
  const cord = mat(tunic.cord);
  const g = new THREE.Group();
  const parts = {};

  // legs hang from the hips
  const legGeo = own(new THREE.CylinderGeometry(B.leg[0] * w, B.leg[1] * w, 0.8, 6).translate(0, -0.4, 0));
  for (const side of [-1, 1]) {
    const hip = new THREE.Group();
    hip.position.set(B.hipGap * w * side, HIP_Y, 0);
    const f = new THREE.Mesh(footGeo, footMat);
    f.position.y = -0.8;
    hip.add(new THREE.Mesh(legGeo, skin), f);
    g.add(hip);
    parts[side < 0 ? 'legL' : 'legR'] = hip;
  }

  // everything above the hips hangs off one group, so older people can stoop
  const body = new THREE.Group();
  body.position.y = HIP_Y;
  g.add(body);
  const waistY = WAIST_Y - HIP_Y;
  const topY = waistY + B.torsoLength;
  const skirt = new THREE.Mesh(own(new THREE.CylinderGeometry(B.waist * w + 0.006, B.hem * w, B.tunicLength, 8)), cloth);
  skirt.position.y = waistY - B.tunicLength / 2;
  const torso = new THREE.Mesh(own(new THREE.CylinderGeometry(B.chest * w, B.waist * w, B.torsoLength, 8)), cloth);
  torso.position.y = waistY + B.torsoLength / 2;
  const belt = new THREE.Mesh(own(new THREE.CylinderGeometry(B.waist * w + 0.014, B.waist * w + 0.014, 0.05, 8)), cord);
  belt.position.y = waistY;
  // rounded shoulders that cover where the arms join
  const yoke = new THREE.Mesh(yokeGeo, cloth);
  yoke.position.y = topY - 0.01;
  yoke.scale.set((B.shoulder + B.arm[0]) * w * 1.03, 0.07, B.chest * w * 0.98);
  const neck = new THREE.Mesh(own(new THREE.CylinderGeometry(B.neck, B.neck * 1.12, 0.14, 6)), skin);
  neck.position.y = topY + 0.06;
  body.add(skirt, torso, belt, yoke, neck);
  parts.torso = torso;

  // head and hair
  const headG = new THREE.Group();
  headG.position.y = topY + 0.13 + 0.15 * B.head;
  headG.scale.setScalar(B.head);
  body.add(headG);
  const head = new THREE.Mesh(headGeo, skin);
  head.scale.set(0.95, 1.08, 1);
  headG.add(head);
  if (look.hair !== 'shaved') {
    const cap = new THREE.Mesh(capGeo, hair);
    cap.position.set(0, 0.012, -0.012);
    cap.rotation.x = -0.3;
    headG.add(cap);
  }
  if (look.hair === 'long') {
    const back = new THREE.Mesh(longHairGeo, hair);
    back.position.set(0, -0.13, -0.012);
    headG.add(back);
  }
  if (look.hair === 'tied') {
    const bun = new THREE.Mesh(bunGeo, hair);
    bun.position.set(0, 0.1, -0.17);
    headG.add(bun);
  }
  for (const s of [-1, 1]) {
    const e = new THREE.Mesh(eyeGeo, eyeMat);
    e.position.set(0.055 * s, 0, 0.148);
    headG.add(e);
  }

  // arms hang from the shoulders, angled out so hands clear the tunic
  const armGeo = own(new THREE.CylinderGeometry(B.arm[0] * w, B.arm[1] * w, 0.58, 6).translate(0, -0.29, 0));
  const sleeveGeo = own(new THREE.CylinderGeometry(B.arm[0] * w + 0.02, B.arm[0] * w + 0.014, 0.17, 6).translate(0, -0.06, 0));
  for (const side of [-1, 1]) {
    const sh = new THREE.Group();
    sh.position.set(B.shoulder * w * side, topY - 0.045, 0);
    sh.userData.spread = B.armSpread * side;
    sh.rotation.z = sh.userData.spread;
    const hand = new THREE.Mesh(handGeo, skin);
    hand.position.y = -0.6;
    sh.add(new THREE.Mesh(armGeo, skin), new THREE.Mesh(sleeveGeo, cloth), hand);
    body.add(sh);
    // the person faces +z, so their right side is -x (it was the wrong way round before 0.1.17, which put tools in the left hand)
    parts[side < 0 ? 'armR' : 'armL'] = sh;
    parts[side < 0 ? 'handR' : 'handL'] = hand;
  }

  body.userData.stoop = clamp01((look.age - 62) / 25) * 0.12;
  body.rotation.x = body.userData.stoop;
  parts.body = body;
  g.scale.setScalar(B.height);
  g.userData.parts = parts;
  g.userData.headTop = (topY + 0.13 + 0.15 * B.head + 0.2 * B.head + HIP_Y) * B.height;
  return shadowsOn(g);
}
// arm pose: x swings forward/back, the outward spread stays the same
function setArm(arm, x) { arm.rotation.set(x, 0, arm.userData.spread); }
function disposeMaterials(obj) {
  obj.traverse((m) => {
    if (!m.isMesh) return;
    for (const x of Array.isArray(m.material) ? m.material : [m.material]) if (x && !x.userData.shared) x.dispose();
    if (m.geometry && m.geometry.userData.perPerson) m.geometry.dispose();
  });
}

/* ---------- the little stage you see while making your person ---------- */
const pscene = new THREE.Scene();
pscene.fog = new THREE.Fog(HAZE, 9, 22);
const pcam = new THREE.PerspectiveCamera(27, 1, 0.1, 100);
pcam.position.set(1.75, 1.75, 5.4);
pcam.lookAt(0, 0.95, 0);
pscene.add(new THREE.HemisphereLight('#f4f2e1', '#7b8857', 2.05));
const psun = new THREE.DirectionalLight('#fff0d4', 2.3);
psun.position.set(-3.5, 6, 3.2);
psun.castShadow = true;
psun.shadow.mapSize.set(1024, 1024);
Object.assign(psun.shadow.camera, { left: -3, right: 3, top: 3, bottom: -3, near: 0.5, far: 20 });
psun.shadow.bias = -0.0008;
psun.shadow.normalBias = 0.02;
pscene.add(psun);
{
  const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.6, 0.28, 11), [mat('#9d8c68'), mat('#9fb06b'), mat('#9d8c68')]);
  disc.position.y = -0.14;
  disc.receiveShadow = true;
  pscene.add(disc);
  const tuftMat = mat('#a9b86f', { side: THREE.DoubleSide });
  for (let i = 0; i < 26; i++) {
    const a = rand() * Math.PI * 2, d = 0.6 + Math.sqrt(rand()) * 0.75;
    const t = new THREE.Group();
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(new THREE.ConeGeometry(0.035, rr(0.22, 0.34), 3, 1, true), tuftMat);
      c.position.set((k - 1) * 0.03, 0.13, (k % 2) * 0.03);
      c.rotation.z = (k - 1) * 0.3;
      t.add(c);
    }
    t.position.set(Math.cos(a) * d, 0, Math.sin(a) * d);
    t.rotation.y = rand() * 6;
    pscene.add(t);
  }
  for (let i = 0; i < 12; i++) {
    const a = rand() * Math.PI * 2, d = 0.6 + rand() * 0.75;
    const f = new THREE.Mesh(new THREE.IcosahedronGeometry(0.045, 0), mat(pick(['#f3efe1', '#ecd36a', '#e2a8b4', '#b8a5d9'])));
    f.position.set(Math.cos(a) * d, 0.09, Math.sin(a) * d);
    pscene.add(f);
  }
  const stone = new THREE.Mesh(rockGeos[0], mat('#a9a397'));
  stone.position.set(-1.0, 0.05, -0.55);
  stone.scale.set(0.26, 0.18, 0.22);
  stone.castShadow = stone.receiveShadow = true;
  pscene.add(stone);
}
let draft = { ...DEFAULT_LOOK };
let previewPerson = null, previewSpin = 0.3, previewDrag = null;
function refreshPreview() {
  if (previewPerson) { pscene.remove(previewPerson); disposeMaterials(previewPerson); }
  previewPerson = makePerson(draft);
  previewPerson.rotation.y = previewSpin;
  pscene.add(previewPerson);
}
function renderCreator(w, h) {
  renderer.setClearColor(HAZE, 1);
  const ar = app.getBoundingClientRect(), sheet = $('sheet').getBoundingClientRect();
  const top = Math.max(0, $('creatorHead').getBoundingClientRect().bottom - ar.top);
  // The stage fills the space the sheet leaves: above it on a phone held upright, beside it on one held sideways
  // (style.css puts the sheet down the right when the screen is short and wide), running a little way under its rounded edge.
  const beside = sheet.top - ar.top <= top && sheet.left - ar.left > 80; // (it starts level with the heading, not below your person)
  const bottom = beside ? h : Math.min(h, sheet.top - ar.top + 24);
  const aw = beside ? Math.max(80, Math.min(w, sheet.left - ar.left + 24)) : w;
  const ah = Math.max(80, bottom - top);
  renderer.setScissorTest(false);
  renderer.setViewport(0, 0, w, h);
  renderer.clear();
  renderer.setScissorTest(true);
  renderer.setScissor(0, h - bottom, aw, ah);
  renderer.setViewport(0, h - bottom, aw, ah);
  pcam.aspect = aw / ah;
  pcam.updateProjectionMatrix();
  renderer.render(pscene, pcam);
  renderer.setScissorTest(false);
}
