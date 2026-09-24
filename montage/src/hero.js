// Монтажка — «эфир» в шапке: поле точек, которое дышит волной и отвечает на громкость того, что играет.
// Three.js грузится лениво с CDN (cloudai-x/threejs-skills: renderer с alpha, pixelRatio ≤ 1.5, ResizeObserver,
// пауза вне экрана). Нет WebGL или сети — та же волна линиями на Canvas 2D. prefers-reduced-motion — один кадр.
// Использует audioLevel из app.js и cssVar из cleanup.js.
const HERO_THREE = 'https://cdn.jsdelivr.net/npm/three@0.186.1/build/three.module.min.js';
const HERO = { running: false, visible: true, raf: 0, level: 0, mx: 0, my: 0, tx: 0, ty: 0, mode: null, t0: performance.now() };
const heroReduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;
const heroColors = () => ({ a: cssVar('--accent'), b: cssVar('--c1'), c: cssVar('--c4'), bg: cssVar('--surface') });
function heroLoop(draw) {
  const tick = now => {
    HERO.raf = 0;
    if (!HERO.visible || document.hidden) { HERO.running = false; return; }
    const lv = typeof audioLevel === 'function' ? audioLevel() : 0;
    HERO.level += (lv - HERO.level) * (lv > HERO.level ? 0.35 : 0.06);   // быстро вверх, медленно вниз
    HERO.mx += (HERO.tx - HERO.mx) * 0.06; HERO.my += (HERO.ty - HERO.my) * 0.06;
    draw((now - HERO.t0) / 1000);
    HERO.raf = requestAnimationFrame(tick);
  };
  HERO.kick = () => { if (heroReduced()) { draw(4.2); return; } if (!HERO.raf && HERO.visible && !document.hidden) { HERO.running = true; HERO.raf = requestAnimationFrame(tick); } };
  HERO.kick();
}
async function initHero() {
  const host = document.querySelector('.hero-wave'); if (!host) return;
  const cv = host.querySelector('canvas');
  new IntersectionObserver(([e]) => { HERO.visible = e.isIntersecting; if (HERO.visible && HERO.kick) HERO.kick(); }).observe(host);
  document.addEventListener('visibilitychange', () => { if (!document.hidden && HERO.kick) HERO.kick(); });
  document.querySelector('header.top').addEventListener('pointermove', e => { const r = host.getBoundingClientRect(); HERO.tx = ((e.clientX - r.left) / r.width - 0.5) * 2; HERO.ty = ((e.clientY - r.top) / r.height - 0.5) * 2; });
  let ok = false;
  try { ok = await heroThree(host, cv); } catch (err) { console.warn('эфир: Three.js недоступен, рисую на Canvas 2D —', err && err.message); }
  if (!ok) hero2d(host, cv);
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => HERO.recolor && HERO.recolor());
  new MutationObserver(() => HERO.recolor && HERO.recolor()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
}
async function heroThree(host, cv) {
  const probe = document.createElement('canvas'); if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) return false;
  const THREE = await import(HERO_THREE);
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: false, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
  camera.position.set(0, 2.2, 7.4); camera.lookAt(0, 0, 0);
  const NX = 180, NZ = 40, pos = new Float32Array(NX * NZ * 3), seed = new Float32Array(NX * NZ);
  for (let z = 0, k = 0; z < NZ; z++) for (let x = 0; x < NX; x++, k++) { pos[k * 3] = (x / (NX - 1) - 0.5) * 12; pos[k * 3 + 1] = 0; pos[k * 3 + 2] = (z / (NZ - 1) - 0.5) * 5; seed[k] = Math.random(); }
  const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.BufferAttribute(pos, 3)); geo.setAttribute('seed', new THREE.BufferAttribute(seed, 1));
  const uni = { uTime: { value: 0 }, uLevel: { value: 0 }, uMouse: { value: new THREE.Vector2() }, uA: { value: new THREE.Color() }, uB: { value: new THREE.Color() }, uC: { value: new THREE.Color() }, uPx: { value: renderer.getPixelRatio() } };
  const mat = new THREE.ShaderMaterial({
    uniforms: uni, transparent: true, depthWrite: false, blending: THREE.NormalBlending,
    vertexShader: `
      uniform float uTime, uLevel, uPx; uniform vec2 uMouse; attribute float seed; varying float vH; varying float vA;
      void main() {
        vec3 p = position;
        float x = p.x, z = p.z, t = uTime;
        float env = exp(-pow(x / 5.2, 2.0));                       // к краям волна гаснет
        float h = sin(x * 0.9 + t * 1.1 + z * 0.55) * 0.34
                + sin(x * 2.1 - t * 1.7 + z * 1.3) * 0.12
                + sin(x * 0.35 + t * 0.45) * 0.28;
        h *= env * (0.75 + uLevel * 2.0);
        h += sin(x * 5.0 + t * 6.0 + seed * 6.28) * 0.05 * uLevel * env;
        p.y = h + uMouse.y * 0.12 * env;
        p.x += uMouse.x * 0.25 * (z + 2.5) * 0.12;
        vH = clamp(h * 1.6 + 0.5, 0.0, 1.0);
        vA = env * smoothstep(-2.5, 1.5, z);
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        gl_PointSize = (2.0 + 2.8 * vH) * uPx * (7.0 / -mv.z);
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 uA, uB, uC; varying float vH; varying float vA;
      void main() {
        vec2 c = gl_PointCoord - 0.5; float d = dot(c, c); if (d > 0.25) discard;
        vec3 col = mix(uB, uA, smoothstep(0.15, 0.6, vH)); col = mix(col, uC, smoothstep(0.75, 1.0, vH) * 0.6);
        gl_FragColor = vec4(col, vA * (1.0 - d * 3.2) * 0.9);
      }`,
  });
  const pts = new THREE.Points(geo, mat); scene.add(pts);
  HERO.recolor = () => { const k = heroColors(); uni.uA.value.set(k.a); uni.uB.value.set(k.b); uni.uC.value.set(k.c); if (heroReduced()) HERO.kick && HERO.kick(); };
  HERO.recolor();
  const size = () => { const w = host.clientWidth, h = host.clientHeight; if (!w || !h) return; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); if (heroReduced() && HERO.kick) HERO.kick(); };
  new ResizeObserver(size).observe(host); size();
  HERO.mode = 'three';
  heroLoop(t => {
    uni.uTime.value = t; uni.uLevel.value = Math.min(1, HERO.level * 3.2);
    uni.uMouse.value.set(HERO.mx, -HERO.my);
    pts.rotation.y = HERO.mx * 0.05; camera.position.y = 2.2 - HERO.my * 0.25; camera.lookAt(0, 0, 0);
    renderer.render(scene, camera);
  });
  host.classList.add('ready');
  return true;
}
function hero2d(host, cv) {
  const g = cv.getContext('2d'); let W = 0, H = 0, k = heroColors();
  HERO.recolor = () => { k = heroColors(); if (heroReduced()) HERO.kick && HERO.kick(); };
  const size = () => { const dpr = Math.min(window.devicePixelRatio || 1, 1.5); W = host.clientWidth; H = host.clientHeight; cv.width = W * dpr; cv.height = H * dpr; g.setTransform(dpr, 0, 0, dpr, 0, 0); if (heroReduced() && HERO.kick) HERO.kick(); };
  new ResizeObserver(size).observe(host); size();
  HERO.mode = '2d';
  heroLoop(t => {
    g.clearRect(0, 0, W, H);
    const lv = Math.min(1, HERO.level * 3.2);
    for (let line = 0; line < 14; line++) {
      const z = line / 13, yb = H * (0.35 + z * 0.4), amp = H * 0.12 * (0.7 + lv * 2) * (0.5 + z * 0.5);
      g.beginPath();
      for (let x = 0; x <= W; x += 4) {
        const u = x / W - 0.5, env = Math.exp(-Math.pow(u / 0.42, 2));
        const y = yb + (Math.sin(u * 11 + t * 1.1 + z * 2.2) * 0.6 + Math.sin(u * 26 - t * 1.7 + z * 5) * 0.22) * amp * env + HERO.my * 6 * env;
        x ? g.lineTo(x + HERO.mx * 8 * z, y) : g.moveTo(x, y);
      }
      g.strokeStyle = z > 0.6 ? k.a : k.b; g.globalAlpha = 0.12 + z * 0.45; g.lineWidth = 1 + z; g.stroke();
    }
    g.globalAlpha = 1;
  });
  host.classList.add('ready');
}
