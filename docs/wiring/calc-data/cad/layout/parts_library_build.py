"""Build the K5 Parts Library page: each finished part in 3D with its pins, pinout and audit.

Input: parts-artist's sample folders in ~/k5-harness-pull/parts/samples/<PART>/ (GLB, pins.json, drawing, pinout).
Output: partslib/parts_library.html plus the images it references (published as artifact files).
"""
import base64, json, os, html, re
from PIL import Image

HERE = os.path.dirname(os.path.abspath(__file__))
SAMPLES = "/Users/skylar/k5-harness-pull/parts/samples/"
HEAD_SRC = os.path.join(HERE, "..", "m130review", "m130_review.html")

PARTS = [
    {
        "key": "M130", "id": "M130-A", "tab": "M130", "mount": "wall", "title": "MoTeC M130 engine computer", "pn": "MoTeC 13130",
        "facts": [
            ("Case, holes, headers", "17 of 17 printed dimensions match MoTeC datasheet 13130 p.3"),
            ("Pin names", "60 of 60 match MoTeC's pin list, datasheet pp.4-5"),
            ("Wires on pins", "60 of 60 match the harness registry; 52 pins used. Pin B12 is the battery-backup supply, so 7 of the 8 unused pins are usable."),
        ],
        "open": [],
    },
    {
        "key": "PDM30", "id": "PDM30-A", "tab": "PDM30", "mount": "wall", "title": "MoTeC PDM30 power module (cab)", "pn": "MoTeC PDM30",
        "facts": [
            ("Case and power stud", "Same case as the M130 (107.5 x 127.5 x 38.7 mm); M6 stud 74.3 mm up and 17.9 mm proud, all printed on PDM manual p.47"),
            ("Pin names", "58 of 58 match the PDM30 pinout, PDM manual p.44"),
            ("Wires on pins", "58 pins used, plus the 4 wires on the M6 stud, from the harness registry. Each short pin tail names the wire it joins."),
        ],
        "open": [],
    },
    {
        "key": "PDM15", "id": "PDM15-A", "tab": "PDM15", "mount": "wall", "title": "MoTeC PDM15 power module (engine bay)", "pn": "MoTeC PDM15",
        "facts": [
            ("Case and power stud", "Same case and stud as the PDM30 (PDM manual p.47: one drawing for both)"),
            ("Pin names", "60 of 60 match the PDM15 pinout, PDM manual p.43"),
            ("Wires on pins", "26 pins used, from the harness registry. Each short pin tail names the wire it joins."),
        ],
        "open": [],
    },
    {
        "key": "ODYSSEY", "id": "ODYSSEY", "tab": "Odyssey", "mount": "floor", "title": "Odyssey Extreme 34/78 running battery", "pn": "Odyssey 34/78-PC1500DT",
        "facts": [
            ("Case and terminals", "10 of 10 dimensions match EnerSys's datasheet; its 277 x 173 x 201 mm overall (to the post tops) checked against the datasheet"),
            ("Terminals", "+ post: 63 (to the isolator), ISO_PWR_FH and ISO_SW_PWR_FH. - post: ODY_NEG. The GM side terminals are unused. All match the harness registry."),
        ],
        "open": [],
    },
    {
        "key": "ACC-BATT", "id": "ACC-BATT", "tab": "YellowTop", "mount": "floor", "title": "Optima YellowTop D34/78 accessory battery", "pn": "Optima 8014-045 (D34/78)",
        "facts": [
            ("Envelope", "254.46 x 174.90 x 199.16 mm, checked against Optima's spec sheet p.7"),
            ("Terminals", "+ post: 32 (the amplifier feed) and DCDC_OUT. - post: ACC_NEG. The GM side terminals are unused. All match the harness registry."),
        ],
        "open": ["Optima prints only the envelope. The six cans, the towers and the terminal positions are sized from the maker's photo (purple on the drawing), and the post depth, side-boss projection and post sizes are assumed (red)."],
    },
    {
        "key": "DCDC", "id": "DCDC", "tab": "DC-DC", "mount": "wall", "title": "Victron Orion-Tr Smart 12/12-30 DC-DC charger", "pn": "Victron ORI121236140",
        "facts": [
            ("Case and mounting", "9 of 9 dimensions match Victron's 360-400 W non-isolated dimension drawing (186 x 132.3 x 84.2 mm, four slots 174 x 71.5 apart)"),
            ("Terminals", "IN + carries DCDC_IN, GND - carries DCDC_GND, OUT + carries DCDC_OUT, in the order printed on the unit. The remote terminal keeps its wire bridge."),
        ],
        "open": ["Victron's dimension drawing was read by the parts lane from Victron's site; the pieces lane has not re-read it."],
    },
]


def small(src, dst, width):
    im = Image.open(src).convert("RGB")
    if im.size[0] > width:
        im = im.resize((width, int(im.size[1] * width / im.size[0])), Image.LANCZOS)
    im.save(dst, quality=86)


data = {}
files = {}
for p in PARTS:
    d = SAMPLES + p["key"] + "/" + p["id"]
    glb = open(d + ".glb", "rb").read()
    assert b"blendermcp" not in glb and b"api_key" not in glb.lower()
    pins = json.load(open(d + ".pins.json"))
    cav = []
    for r in pins["cavities"]:
        full = re.sub(r"\s{2,}.*$", "", (r.get("full_name") or "").strip())
        full = re.sub(r"^(Hi|Lo)\s+", "", full)
        cav.append({
            "pin": r["pin"], "maker": r.get("maker_pin"), "ep": r.get("endpoint"), "cavity": r.get("cavity"),
            "name": r.get("name"), "full": full, "at": r.get("wire_side_glb_m"),
            "wires": [{"id": w.get("id"), "label": w.get("label"), "awg": w.get("awg"), "color": w.get("color")} for w in r.get("wires", [])],
        })
    data[p["key"]] = {"glb": base64.b64encode(glb).decode(), "pins": cav, "orient": pins.get("orientation_unknown", "")}
    p["images"] = []
    for kind, w in (("drawing", 1800), ("pinout", 1400)):
        src = d + "_" + kind + ".png"
        if os.path.exists(src):
            name = "%s_%s.jpg" % (p["key"].lower(), kind)
            small(src, os.path.join(HERE, name), w)
            files[name] = os.path.join(HERE, name)
            p["images"].append(kind)

head = open(HEAD_SRC).read()
head = head[:head.index("</style>")]
head = head.replace("<title>M130 Sample Review</title>", "<title>K5 Parts Library</title>")
css = """
.tabs { display: flex; flex-wrap: wrap; gap: 0; border-bottom: 1px solid var(--rule); }
.tabs button { font: 600 14px/1 var(--sans); padding: 12px 16px; border: 1px solid transparent; border-bottom: none; background: none; color: var(--muted); cursor: pointer; margin-bottom: -1px; }
.tabs button[aria-selected="true"] { color: var(--fg); background: var(--panel); border-color: var(--rule); }
.tabs button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.tabs .soon { font: 400 13px/1 var(--sans); color: var(--muted); padding: 12px 16px; }
.v3d { position: relative; }
.pinlbl { position: absolute; transform: translate(-50%, -130%); font: 500 11px/1 var(--mono); padding: 3px 5px; background: var(--fg); color: var(--bg); pointer-events: none; white-space: nowrap; }
.pinlbl.sel { background: var(--accent); color: #fff; }
.warn { border: 1px solid var(--rule); border-left: 3px solid var(--warn); background: var(--panel); padding: 12px 14px; display: grid; gap: 6px; }
tr.pinrow { cursor: pointer; }
tr.pinrow:hover td { background: color-mix(in srgb, var(--accent) 7%, transparent); }
tr.pinrow.sel td { background: color-mix(in srgb, var(--accent) 16%, transparent); }
td.spare { color: var(--muted); }
.facts { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; font-size: 14px; }
.facts dt { color: var(--muted); font: 500 12px/1.6 var(--mono); text-transform: uppercase; letter-spacing: .04em; }
.facts dd { margin: 0; }
@media (max-width: 720px) { .facts { grid-template-columns: 1fr; } }
</style>
"""
body = """
<div class="wrap">
  <header>
    <div class="eyebrow">K5 harness · parts in 3D · checked against the maker's drawings</div>
    <h1>K5 Parts Library</h1>
    <p class="muted">Every finished part, true size, with its plugs mated and every pin numbered. Turn it, point at a pin to see what lands there, or click a row in the pinout to find it on the part. The two batteries and the DC-DC charger are being built next.</p>
  </header>
  <div class="tabs" role="tablist" id="tabs"></div>
  <section id="partsec">
    <h2 id="ptitle"></h2>
    <div class="viewer">
      <div id="v3d" class="v3d" role="img" aria-label="3D model of the selected part"></div>
      <div class="bar">
        <span>Drag to turn, right-drag to pan, scroll or pinch to zoom.</span>
        <button type="button" id="b-front">Front view</button>
        <button type="button" id="b-wires">Look at the wire side</button>
        <button type="button" id="t-plugs" aria-pressed="true">Plugs</button>
        <button type="button" id="t-keep" aria-pressed="false">Keep-out zone</button>
        <span id="v3d-status" class="muted">Loading the model…</span>
      </div>
      <div class="bar"><span>Pointing at: <span id="v3d-part">nothing</span></span></div>
    </div>
    <div class="warn" id="orient"><strong>Check pin 1 before you trust a pin.</strong><span id="orient-text"></span></div>
    <dl class="facts" id="facts"></dl>
    <div id="open"></div>
    <h2>Pinout</h2>
    <p class="muted">Pin numbers are TE's, read from the wire side (TE drawing 2-1437285-3), with the maker's pin name beside each. Wires come from the harness registry. Click a row to light that pin on the part.</p>
    <div class="pins" id="pintables"></div>
    <h2>Drawings</h2>
    <div class="pair" id="drawings"></div>
  </section>
</div>
"""
parts_meta = [{"key": p["key"], "tab": p["tab"], "mount": p["mount"], "title": p["title"], "pn": p["pn"], "facts": p["facts"],
               "open": p["open"], "images": p["images"]} for p in PARTS]
js = r"""
<script src="https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/loaders/GLTFLoader.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/controls/OrbitControls.js"></script>
<script src="https://cdn.jsdelivr.net/npm/three@0.128.0/examples/js/environments/RoomEnvironment.js"></script>
<script>
var PARTS = __META__;
var DATA = __DATA__;
(function () {
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]; }); }
  var el = document.getElementById('v3d'), st = document.getElementById('v3d-status'), hov = document.getElementById('v3d-part');
  var tabs = document.getElementById('tabs');
  var cur = null, renderer = null, scene, camera, controls, root = null, pinGroup = null, pickParts = [], pickPins = [], mats = {}, labels = [], sel = null, radius = 0.2;
  var ok3d = !!(window.THREE && THREE.GLTFLoader && THREE.OrbitControls);
  if (ok3d) {
    try { renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true }); } catch (e) { renderer = null; }
  }
  if (renderer) {
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
    el.appendChild(renderer.domElement);
    scene = new THREE.Scene(); scene.background = new THREE.Color('#ffffff');
    try { var pm = new THREE.PMREMGenerator(renderer); scene.environment = pm.fromScene(new THREE.RoomEnvironment(), 0.04).texture; } catch (e) {}
    scene.add(new THREE.HemisphereLight(0xffffff, 0x9aa0a6, 0.55));
    var key = new THREE.DirectionalLight(0xffffff, 1.0); key.position.set(0.4, 0.6, 0.8); scene.add(key);
    var rim = new THREE.DirectionalLight(0xffffff, 0.8); rim.position.set(-0.6, 0.4, -0.7); scene.add(rim);
    camera = new THREE.PerspectiveCamera(28, 1, 0.001, 100);
    controls = new THREE.OrbitControls(camera, renderer.domElement); controls.enableDamping = true; controls.dampingFactor = 0.08;
    var resize = function () { var w = el.clientWidth || 600, h = el.clientHeight || 400; renderer.setSize(w, h, false); camera.aspect = w / h; camera.updateProjectionMatrix(); };
    if (window.ResizeObserver) new ResizeObserver(resize).observe(el); else window.addEventListener('resize', resize);
    resize();
  } else {
    st.textContent = 'The 3D view is off in this browser (no WebGL or the viewer did not load). The pinout and drawings below still work.';
  }
  function wireText(ws) {
    if (!ws || !ws.length) return 'spare';
    return ws.map(function (w) { return w.id + (w.label ? ' ' + w.label : '') + (w.awg ? ', ' + w.awg + ' AWG' : '') + (w.color ? ' ' + w.color : ''); }).join('; ');
  }
  function pinText(p) { return p.pin + ' (' + p.maker + ') · ' + p.name + (p.full && p.full !== p.name ? ' · ' + p.full : '') + ' · ' + wireText(p.wires); }
  function clearLabels() { labels.forEach(function (l) { l.div.remove(); }); labels = []; }
  function addLabel(p, cls) {
    var d = document.createElement('div'); d.className = 'pinlbl' + (cls ? ' ' + cls : ''); d.textContent = p.pin; el.appendChild(d);
    labels.push({ div: d, p: p }); return d;
  }
  function select(pin) {
    sel = pin;
    document.querySelectorAll('tr.pinrow').forEach(function (tr) { tr.classList.toggle('sel', tr.dataset.pin === pin); });
    if (!pinGroup) return;
    pinGroup.children.forEach(function (m) {
      var on = m.userData.pin === pin;
      m.scale.setScalar(on ? 2.2 : 1);
      m.material = on ? m.userData.selMat : m.userData.baseMat;
    });
    labels.filter(function (l) { return l.div.classList.contains('sel'); }).forEach(function (l) { l.div.remove(); });
    labels = labels.filter(function (l) { return !l.div.classList.contains('sel'); });
    var p = DATA[cur].pins.find(function (x) { return x.pin === pin; });
    if (p) { addLabel(p, 'sel'); hov.textContent = pinText(p); }
  }
  function buildTables(key) {
    var pins = DATA[key].pins, byEp = {};
    pins.forEach(function (p) { (byEp[p.ep] = byEp[p.ep] || []).push(p); });
    var out = '';
    Object.keys(byEp).sort().forEach(function (ep) {
      var rows = byEp[ep].map(function (p) {
        return '<tr class="pinrow" data-pin="' + esc(p.pin) + '" tabindex="0"><td class="num">' + esc(p.pin) + '</td><td class="num">' + esc(p.name) + '</td><td>' + esc(p.full) + '</td><td class="' + (p.wires.length ? '' : 'spare') + '">' + esc(wireText(p.wires)) + '</td></tr>';
      }).join('');
      var used = byEp[ep].filter(function (p) { return p.wires.length; }).length;
      out += '<div class="tbl"><h3>' + esc(ep) + ' · ' + byEp[ep].length + '-way · ' + used + ' used</h3><table><thead><tr><th>Pin</th><th>Name</th><th>Function</th><th>Wire in this build</th></tr></thead><tbody>' + rows + '</tbody></table></div>';
    });
    var box = document.getElementById('pintables'); box.innerHTML = out;
    box.querySelectorAll('tr.pinrow').forEach(function (tr) {
      tr.addEventListener('click', function () { select(tr.dataset.pin); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(tr.dataset.pin); } });
    });
  }
  function frontView() {
    if (!root) return;
    camera.position.set(radius * 0.7, radius * 0.35, radius * 2.0); controls.target.set(0, 0, 0); controls.update();
    var meta = PARTS.find(function (p) { return p.key === cur; });
    st.textContent = 'Front view: ' + meta.pn + ', true size. Blue dots are pins in use, grey are spare.';
  }
  function wireView() {
    if (!root) return;
    var meta = PARTS.find(function (p) { return p.key === cur; });
    var b = new THREE.Box3().setFromObject(pinGroup), c = b.getCenter(new THREE.Vector3());
    controls.target.copy(c);
    if (meta.mount === 'floor') {
      camera.position.set(c.x + 0.0005, c.y + radius * 1.05, c.z + radius * 0.22); controls.update();
      st.textContent = 'Looking down at the terminals. The side with the GM side terminals is at the bottom of this view.';
    } else {
      camera.position.set(c.x + 0.0005, c.y - radius * 1.05, c.z + radius * 0.22); controls.update();
      st.textContent = 'Wire side, looking up at the connections. The front of the unit (the label) is at the top of this view.';
    }
  }
  function load(key) {
    cur = key; sel = null; clearLabels();
    var meta = PARTS.find(function (p) { return p.key === key; });
    document.getElementById('ptitle').textContent = meta.title + ' · ' + meta.pn;
    document.getElementById('orient-text').textContent = DATA[key].orient || '';
    document.getElementById('facts').innerHTML = meta.facts.map(function (f) { return '<dt>' + esc(f[0]) + '</dt><dd>' + esc(f[1]) + '</dd>'; }).join('');
    document.getElementById('open').innerHTML = meta.open.length ? '<ul>' + meta.open.map(function (o) { return '<li>' + esc(o) + '</li>'; }).join('') + '</ul>' : '';
    var k = key.toLowerCase(), figs = '';
    if (meta.images.indexOf('drawing') >= 0) figs += '<figure><img src="' + k + '_drawing.jpg" alt="Dimensioned drawing of the ' + esc(meta.title) + '"><figcaption>Dimensioned drawing, colour-coded by source: blue printed by the maker, orange scaled off the print, purple sized from a photo, red assumed.</figcaption></figure>';
    if (meta.images.indexOf('pinout') >= 0) figs += '<figure><img src="' + k + '_pinout.jpg" alt="Pinout diagram of the ' + esc(meta.title) + '"><figcaption>Pinout diagram, wire side, with this build\'s wires.</figcaption></figure>';
    document.getElementById('drawings').innerHTML = figs;
    document.getElementById('orient').hidden = !(DATA[key].orient);
    buildTables(key);
    document.querySelectorAll('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.key === key ? 'true' : 'false'); });
    if (!renderer) return;
    if (root) { scene.remove(root); root = null; }
    pickParts = []; pickPins = []; mats = {};
    st.textContent = 'Loading the model…';
    var bin = atob(DATA[key].glb), bytes = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    new THREE.GLTFLoader().parse(bytes.buffer, '', function (gltf) {
      if (cur !== key) return;
      root = new THREE.Group(); var inner = new THREE.Group(); inner.add(gltf.scene); root.add(inner);
      inner.rotation.x = meta.mount === 'wall' ? Math.PI / 2 : 0;
      gltf.scene.traverse(function (o) {
        if (!o.isMesh) return; pickParts.push(o);
        var m = o.material; if (!m) return; var n = (o.name || '') + ' ' + ((o.parent && o.parent.name) || '');
        (mats[/keep-?out/i.test(n) ? 'keep' : (/plug|backshell/i.test(n) ? 'plugs' : 'other')] = mats[/keep-?out/i.test(n) ? 'keep' : (/plug|backshell/i.test(n) ? 'plugs' : 'other')] || []).push(o);
        if (m.transparent) m.depthWrite = false;
      });
      (mats.keep || []).forEach(function (o) { o.visible = document.getElementById('t-keep').getAttribute('aria-pressed') === 'true'; });
      (mats.plugs || []).forEach(function (o) { o.visible = document.getElementById('t-plugs').getAttribute('aria-pressed') === 'true'; });
      pinGroup = new THREE.Group(); inner.add(pinGroup);
      var geo = new THREE.SphereGeometry(0.00085, 12, 8);
      var used = new THREE.MeshBasicMaterial({ color: 0x1f5fae }), spare = new THREE.MeshBasicMaterial({ color: 0x9aa3ac }), hot = new THREE.MeshBasicMaterial({ color: 0xe0661c });
      DATA[key].pins.forEach(function (p) {
        if (!p.at) return;
        var m = new THREE.Mesh(geo, p.wires.length ? used : spare);
        m.position.set(p.at[0], p.at[1], p.at[2]);
        m.userData = { pin: p.pin, baseMat: p.wires.length ? used : spare, selMat: hot };
        pinGroup.add(m); pickPins.push(m);
      });
      scene.add(root);
      var box = new THREE.Box3().setFromObject(root), c = box.getCenter(new THREE.Vector3()), s = box.getSize(new THREE.Vector3());
      inner.position.sub(c); radius = Math.max(s.x, s.y, s.z);
      camera.near = radius / 100; camera.far = radius * 100; camera.updateProjectionMatrix();
      frontView();
      var few = DATA[key].pins.length <= 8;
      DATA[key].pins.filter(function (p) { return few || /^[AB]01$/.test(p.pin); }).forEach(function (p) { addLabel(p, ''); });
      st.textContent = 'Model loaded: ' + meta.pn + ', true size. Blue dots are pins in use, grey are spare.';
    }, function () { st.textContent = 'The 3D model did not load. The pinout and drawings below still work.'; });
  }
  PARTS.forEach(function (p, i) {
    var b = document.createElement('button'); b.type = 'button'; b.role = 'tab'; b.dataset.key = p.key; b.textContent = p.tab;
    b.setAttribute('aria-selected', i === 0 ? 'true' : 'false');
    b.addEventListener('click', function () { load(p.key); });
    tabs.appendChild(b);
  });
  var soon = document.createElement('span'); soon.className = 'soon'; soon.textContent = 'More parts after your verdict on these'; tabs.appendChild(soon);
  document.getElementById('b-front').addEventListener('click', frontView);
  document.getElementById('b-wires').addEventListener('click', wireView);
  function tog(id, group) {
    var b = document.getElementById(id);
    b.addEventListener('click', function () {
      var on = b.getAttribute('aria-pressed') !== 'true'; b.setAttribute('aria-pressed', on ? 'true' : 'false');
      (mats[group] || []).forEach(function (o) { o.visible = on; });
    });
  }
  tog('t-plugs', 'plugs'); tog('t-keep', 'keep');
  if (renderer) {
    var ray = new THREE.Raycaster(), ptr = new THREE.Vector2();
    renderer.domElement.addEventListener('pointermove', function (ev) {
      var rc = renderer.domElement.getBoundingClientRect();
      ptr.x = ((ev.clientX - rc.left) / rc.width) * 2 - 1; ptr.y = -((ev.clientY - rc.top) / rc.height) * 2 + 1;
      ray.setFromCamera(ptr, camera);
      var hp = ray.intersectObjects(pickPins, false);
      if (hp.length) { var p = DATA[cur].pins.find(function (x) { return x.pin === hp[0].object.userData.pin; }); hov.textContent = p ? pinText(p) : 'pin'; return; }
      var h = ray.intersectObjects(pickParts, false).filter(function (x) { return x.object.visible; });
      hov.textContent = h.length ? String(h[0].object.name || (h[0].object.parent && h[0].object.parent.name) || 'part').replace(/_/g, ' ') : 'nothing';
    });
    renderer.domElement.addEventListener('click', function (ev) {
      var rc = renderer.domElement.getBoundingClientRect();
      ptr.x = ((ev.clientX - rc.left) / rc.width) * 2 - 1; ptr.y = -((ev.clientY - rc.top) / rc.height) * 2 + 1;
      ray.setFromCamera(ptr, camera);
      var hp = ray.intersectObjects(pickPins, false);
      if (hp.length) { select(hp[0].object.userData.pin); var tr = document.querySelector('tr.pinrow[data-pin="' + hp[0].object.userData.pin + '"]'); if (tr) tr.scrollIntoView({ block: 'nearest' }); }
    });
    var v = new THREE.Vector3();
    (function loop() {
      controls.update(); renderer.render(scene, camera);
      if (pinGroup) {
        var w = el.clientWidth, h = el.clientHeight;
        labels.forEach(function (l) {
          var m = pinGroup.children.find(function (x) { return x.userData.pin === l.p.pin; });
          if (!m) return; m.getWorldPosition(v); v.project(camera);
          l.div.style.left = ((v.x + 1) / 2 * w) + 'px'; l.div.style.top = ((1 - v.y) / 2 * h) + 'px';
          l.div.hidden = v.z > 1;
        });
      }
      requestAnimationFrame(loop);
    })();
  }
  load(PARTS[0].key);
})();
</script>
"""
page = head + css + body + js.replace("__META__", json.dumps(parts_meta)).replace("__DATA__", json.dumps(data))
open(os.path.join(HERE, "parts_library.html"), "w").write(page)
json.dump(files, open(os.path.join(HERE, "files.json"), "w"), indent=1)
print("page bytes", len(page), "files", sorted(files))
