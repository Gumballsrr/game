/**
 * Hearts of Iron IV - Central & Eastern European Theater 3D Engine
 * Features:
 * - Direct 1:1 Province Lookup (1080x720) covering GER, SOV, HUN, ROM, FIN, POL
 * - Dynamic 60 FPS Province Selection & Hover Mesh (Glowing contours & gold highlights)
 * - Authentic Paradox Terrain Illustration Cards
 * - Clausewitz Camera with Smooth WASD & 3D Orbit Controls
 */
(() => {
  'use strict';

  const container = document.getElementById('map-3d-wrapper');

  // Dimensions of Theater
  const MAP_W = 1080;
  const MAP_H = 720;
  const PLANE_W = 360.0;
  const PLANE_H = 240.0;

  // Three.js Core
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060c13);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    1,
    12000
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.shadowMap.enabled = true;
  container.appendChild(renderer.domElement);

  // Lighting (Clausewitz NW Directional Sun + Cold Ambient)
  const ambientLight = new THREE.AmbientLight(0xdbe6f2, 0.72);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfff5e4, 1.25);
  sunLight.position.set(-250, 450, 280);
  sunLight.castShadow = true;
  scene.add(sunLight);

  const skyFill = new THREE.DirectionalLight(0x6080a0, 0.35);
  skyFill.position.set(180, 220, -150);
  scene.add(skyFill);

  // Mesh & Material variables
  let terrainMesh = null;
  let terrainMaterial = null;
  let texPolitical = null;
  let texSatellite = null;
  let currentMapmode = 'political';

  // Province Highlight Layer (Dynamic 2D Canvas mapped onto 3D plane)
  const hlCanvas = document.createElement('canvas');
  hlCanvas.width = MAP_W;
  hlCanvas.height = MAP_H;
  const hlCtx = hlCanvas.getContext('2d', { willReadFrequently: true });
  let hlTexture = new THREE.CanvasTexture(hlCanvas);
  hlTexture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  let hlMesh = null;

  // UI DOM Elements
  const tooltip = document.getElementById('hover-tooltip');
  const ttFlagImg = document.getElementById('tt-flag-img');
  const ttState = document.getElementById('tt-state');
  const ttSub = document.getElementById('tt-sub');

  const stateWin = document.getElementById('state-window');
  const stName = document.getElementById('st-name');
  const stCategory = document.getElementById('st-category');
  const stOwnerName = document.getElementById('st-owner-name');
  const stFlagImg = document.getElementById('st-flag-img');
  const stManpower = document.getElementById('st-manpower');
  const stVps = document.getElementById('st-vps');
  const stInfra = document.getElementById('st-infra');
  const stProvCount = document.getElementById('st-prov-count');
  const vpList = document.getElementById('vp-list');
  const btnCloseState = document.getElementById('btn-close-state');
  const stTerrainBanner = document.getElementById('st-terrain-banner');

  const dateDisplay = document.getElementById('date-display');
  const btnPause = document.getElementById('btn-pause');
  const speedPips = document.querySelectorAll('.speed-step-indicator .pip');

  const modePolitical = document.getElementById('mode-political');
  const modeTerrain = document.getElementById('mode-terrain');
  const btnToggle3D = document.getElementById('btn-toggle-3d');
  const lbl3DStatus = document.getElementById('lbl-3d-status');
  const btnZoomIn = document.getElementById('btn-zoom-in');
  const btnZoomOut = document.getElementById('btn-zoom-out');
  const btnZoomReset = document.getElementById('btn-zoom-reset');

  // Datasets
  let provLookup = null;       // Uint16Array (1080 * 720)
  let provMeta = {};           // Province dictionary
  let provBounds = {};         // Province bounding boxes
  let statesData = {};

  let hoveredPid = 0;
  let selectedPid = 6521;      // Default selected: Berlin (#6521)

  // Flag resolver
  function getFlagUrl(tag) {
    const known = {
      GER: 'gfx/flags/GER_fascism.png',
      SOV: 'gfx/flags/SOV_communism.png',
      FIN: 'gfx/flags/FIN_neutrality.png',
      HUN: 'gfx/flags/HUN_neutrality.png',
      ROM: 'gfx/flags/ROM_neutrality.png',
      POL: 'gfx/flags/POL_neutrality.png',
      SWE: 'gfx/flags/SWE_democratic.png',
      ENG: 'gfx/flags/ENG_democratic.png',
      FRA: 'gfx/flags/FRA_democratic.png',
      USA: 'gfx/flags/USA_democratic.png',
      ITA: 'gfx/flags/ITA_fascism.png'
    };
    return known[tag] || 'gfx/flags/GER_fascism.png';
  }

  // Terrain Banner resolver
  function getTerrainBannerUrl(terrain) {
    const map = {
      urban: 'gfx/interface/terrains/terrain_urban.png',
      forest: 'gfx/interface/terrains/terrain_forest.png',
      hills: 'gfx/interface/terrains/terrain_hills.png',
      mountain: 'gfx/interface/terrains/terrain_mountain.png',
      marsh: 'gfx/interface/terrains/terrain_marsh.png',
      plains: 'gfx/interface/terrains/terrain_plains.png',
      water: 'gfx/interface/terrains/terrain_water_day.png'
    };
    return map[terrain] || 'gfx/interface/terrains/terrain_plains.png';
  }

  // -------------------------------------------------------------
  // CLAUSEWITZ CAMERA CONTROLLER
  // -------------------------------------------------------------
  const camState = {
    // Initial center on Berlin - Warsaw axis
    target: new THREE.Vector3(-45, 0, 15),
    current: new THREE.Vector3(-45, 0, 15),
    distance: 160,
    targetDistance: 160,
    minDistance: 20,
    maxDistance: 380,
    pitch: 0.45,
    targetPitch: 0.45,
    minPitch: 0.05,
    maxPitch: 1.15,
    yaw: 0.0,
    targetYaw: 0.0,
    is3DActive: true
  };

  const keysDown = {};
  window.addEventListener('keydown', (e) => {
    keysDown[e.code] = true;
    if (e.code === 'Space') {
      e.preventDefault();
      togglePause();
    } else if (e.code === 'F1') {
      e.preventDefault();
      modePolitical.click();
    } else if (e.code === 'F2') {
      e.preventDefault();
      modeTerrain.click();
    } else if (e.code === 'KeyT') {
      btnToggle3D.click();
    } else if (e.code === 'NumpadAdd' || e.code === 'Equal') {
      e.preventDefault();
      setSpeed(Math.min(5, gameSpeed + 1));
    } else if (e.code === 'NumpadSubtract' || e.code === 'Minus') {
      e.preventDefault();
      setSpeed(Math.max(1, gameSpeed - 1));
    }
  });

  window.addEventListener('keyup', (e) => {
    keysDown[e.code] = false;
  });

  function updateCamera() {
    // WASD & Arrow Keys Pan
    const panFactor = camState.distance * 0.0045;
    const fwd = new THREE.Vector3(Math.sin(camState.yaw), 0, Math.cos(camState.yaw));
    const rgt = new THREE.Vector3(Math.cos(camState.yaw), 0, -Math.sin(camState.yaw));

    if (keysDown['KeyW'] || keysDown['ArrowUp']) {
      camState.target.addScaledVector(fwd, -panFactor);
    }
    if (keysDown['KeyS'] || keysDown['ArrowDown']) {
      camState.target.addScaledVector(fwd, panFactor);
    }
    if (keysDown['KeyA'] || keysDown['ArrowLeft']) {
      camState.target.addScaledVector(rgt, -panFactor);
    }
    if (keysDown['KeyD'] || keysDown['ArrowRight']) {
      camState.target.addScaledVector(rgt, panFactor);
    }

    camState.target.x = Math.max(-PLANE_W / 2, Math.min(PLANE_W / 2, camState.target.x));
    camState.target.z = Math.max(-PLANE_H / 2, Math.min(PLANE_H / 2, camState.target.z));

    // Smooth Lerp
    camState.current.lerp(camState.target, 0.14);
    camState.distance += (camState.targetDistance - camState.distance) * 0.14;
    camState.yaw += (camState.targetYaw - camState.yaw) * 0.14;

    if (camState.is3DActive) {
      const zoomRatio = 1.0 - (camState.distance - camState.minDistance) / (camState.maxDistance - camState.minDistance);
      const autoPitch = 0.18 + Math.pow(Math.max(0, zoomRatio), 0.75) * 0.85;
      camState.targetPitch = Math.min(camState.maxPitch, autoPitch);
    } else {
      camState.targetPitch = 0.04;
    }
    camState.pitch += (camState.targetPitch - camState.pitch) * 0.12;

    const cosPitch = Math.cos(camState.pitch);
    const sinPitch = Math.sin(camState.pitch);
    const cosYaw = Math.cos(camState.yaw);
    const sinYaw = Math.sin(camState.yaw);

    const cx = camState.current.x + camState.distance * sinPitch * sinYaw;
    const cy = camState.current.y + camState.distance * cosPitch;
    const cz = camState.current.z + camState.distance * sinPitch * cosYaw;

    camera.position.set(cx, cy, cz);
    camera.lookAt(camState.current);
  }

  // Mouse drag handling
  let isDragging = false;
  let dragButton = 0;
  let prevMouseX = 0, prevMouseY = 0;

  window.addEventListener('mousedown', (e) => {
    if (e.target !== renderer.domElement) return;
    isDragging = true;
    dragButton = e.button;
    prevMouseX = e.clientX;
    prevMouseY = e.clientY;
  });

  window.addEventListener('contextmenu', (e) => {
    if (e.target === renderer.domElement) e.preventDefault();
  });

  window.addEventListener('mousemove', (e) => {
    if (isDragging) {
      const dx = e.clientX - prevMouseX;
      const dy = e.clientY - prevMouseY;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;

      if (dragButton === 0) {
        // Pan
        const factor = camState.distance * 0.0016;
        const forward = new THREE.Vector3(Math.sin(camState.yaw), 0, Math.cos(camState.yaw));
        const right = new THREE.Vector3(Math.cos(camState.yaw), 0, -Math.sin(camState.yaw));

        camState.target.addScaledVector(right, -dx * factor);
        camState.target.addScaledVector(forward, -dy * factor);
        camState.target.x = Math.max(-PLANE_W / 2, Math.min(PLANE_W / 2, camState.target.x));
        camState.target.z = Math.max(-PLANE_H / 2, Math.min(PLANE_H / 2, camState.target.z));
      } else if (dragButton === 2) {
        // Orbit rotation
        camState.targetYaw -= dx * 0.006;
      }
      tooltip.classList.remove('visible');
      return;
    }

    handleHover(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const factor = e.deltaY < 0 ? 0.82 : 1.22;
    camState.targetDistance = Math.min(camState.maxDistance, Math.max(camState.minDistance, camState.targetDistance * factor));
  }, { passive: false });

  // -------------------------------------------------------------
  // PROVINCE RAYCASTING & 60 FPS HIGHLIGHT RENDERER
  // -------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const mouseVec = new THREE.Vector2();

  function getRayIntersection(screenX, screenY) {
    if (!terrainMesh) return null;
    mouseVec.x = (screenX / window.innerWidth) * 2 - 1;
    mouseVec.y = -(screenY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouseVec, camera);
    const hits = raycaster.intersectObject(terrainMesh);
    return hits.length > 0 ? hits[0] : null;
  }

  // Draw province highlight into dynamic canvas texture
  function redrawHighlights() {
    hlCtx.clearRect(0, 0, MAP_W, MAP_H);

    // 1. Draw Selected Province (Golden Contour & Warm Overlay)
    if (selectedPid > 0 && provBounds[selectedPid]) {
      drawProvinceShape(selectedPid, 'rgba(255, 215, 60, 0.95)', 'rgba(255, 215, 60, 0.35)', true);
    }

    // 2. Draw Hovered Province (Crisp White/Cyan Contour & Soft Wash)
    if (hoveredPid > 0 && hoveredPid !== selectedPid && provBounds[hoveredPid]) {
      drawProvinceShape(hoveredPid, 'rgba(240, 250, 255, 0.95)', 'rgba(180, 220, 255, 0.22)', false);
    }

    hlTexture.needsUpdate = true;
  }

  function drawProvinceShape(pid, strokeColor, fillColor, isSelected) {
    const b = provBounds[pid].box;
    const minX = Math.max(0, b[0] - 1);
    const minY = Math.max(0, b[1] - 1);
    const maxX = Math.min(MAP_W - 1, b[2] + 1);
    const maxY = Math.min(MAP_H - 1, b[3] + 1);

    const bw = maxX - minX + 1;
    const bh = maxY - minY + 1;
    const imgData = hlCtx.getImageData(minX, minY, bw, bh);
    const data = imgData.data;

    // Parse colors
    const strokeR = isSelected ? 255 : 240;
    const strokeG = isSelected ? 215 : 250;
    const strokeB = isSelected ? 60 : 255;
    const fillR = isSelected ? 255 : 180;
    const fillG = isSelected ? 215 : 220;
    const fillB = isSelected ? 60 : 255;
    const fillA = isSelected ? 80 : 50;

    for (let y = minY; y <= maxY; y++) {
      for (let x = minX; x <= maxX; x++) {
        const curPid = provLookup[y * MAP_W + x];
        if (curPid === pid) {
          // Check if boundary pixel
          const isEdge =
            x === 0 || x === MAP_W - 1 || y === 0 || y === MAP_H - 1 ||
            provLookup[y * MAP_W + (x - 1)] !== pid ||
            provLookup[y * MAP_W + (x + 1)] !== pid ||
            provLookup[(y - 1) * MAP_W + x] !== pid ||
            provLookup[(y + 1) * MAP_W + x] !== pid;

          const idx = ((y - minY) * bw + (x - minX)) * 4;
          if (isEdge) {
            data[idx] = strokeR;
            data[idx + 1] = strokeG;
            data[idx + 2] = strokeB;
            data[idx + 3] = 240;
          } else {
            data[idx] = fillR;
            data[idx + 1] = fillG;
            data[idx + 2] = fillB;
            data[idx + 3] = fillA;
          }
        }
      }
    }
    hlCtx.putImageData(imgData, minX, minY);
  }

  function handleHover(screenX, screenY) {
    const hit = getRayIntersection(screenX, screenY);
    if (!hit || !hit.uv || !provLookup) {
      if (hoveredPid !== 0) {
        hoveredPid = 0;
        redrawHighlights();
      }
      tooltip.classList.remove('visible');
      return;
    }

    const lx = Math.floor(hit.uv.x * MAP_W);
    const ly = Math.floor((1.0 - hit.uv.y) * MAP_H);
    if (lx < 0 || lx >= MAP_W || ly < 0 || ly >= MAP_H) {
      tooltip.classList.remove('visible');
      return;
    }

    const pid = provLookup[ly * MAP_W + lx] || 0;
    if (pid !== hoveredPid) {
      hoveredPid = pid;
      redrawHighlights();
    }

    if (pid > 0 && provMeta[pid]) {
      const p = provMeta[pid];
      ttFlagImg.src = getFlagUrl(p.owner);
      ttState.textContent = p.state_name;

      let vpText = p.vp > 0 ? ` • ★ ${p.vp} VP` : '';
      const terrainLabel = {
        urban: 'Urbano',
        forest: 'Floresta',
        hills: 'Colinas',
        mountain: 'Montanha',
        marsh: 'Pântano',
        plains: 'Planície'
      }[p.terrain] || p.terrain;

      const coastalLabel = p.coastal ? 'Litoral' : 'Interior';
      ttSub.textContent = `${p.country_name} (${p.owner}) • Prov: #${pid} • ${terrainLabel} (${coastalLabel})${vpText}`;

      tooltip.style.left = `${screenX + 16}px`;
      tooltip.style.top = `${screenY + 16}px`;
      tooltip.classList.add('visible');
    } else {
      tooltip.classList.remove('visible');
    }
  }

  // Click handler: Select Province & Show State details
  window.addEventListener('click', (e) => {
    if (e.target !== renderer.domElement) return;
    const hit = getRayIntersection(e.clientX, e.clientY);
    if (!hit || !hit.uv || !provLookup) return;

    const lx = Math.floor(hit.uv.x * MAP_W);
    const ly = Math.floor((1.0 - hit.uv.y) * MAP_H);
    const pid = provLookup[ly * MAP_W + lx] || 0;

    if (pid > 0) {
      selectedPid = pid;
      redrawHighlights();

      if (provMeta[pid]) {
        const p = provMeta[pid];
        const sid = String(p.state_id);
        if (statesData[sid]) {
          showStateDetails(statesData[sid], pid);
        }
      }
    }
  });

  function showStateDetails(st, activePid) {
    stName.textContent = st.name;
    stCategory.textContent = st.category || 'Megalopolis';
    stOwnerName.textContent = `${st.country_name} (${st.owner})`;
    stFlagImg.src = getFlagUrl(st.owner);

    // Update Terrain Banner
    if (activePid && provMeta[activePid]) {
      stTerrainBanner.src = getTerrainBannerUrl(provMeta[activePid].terrain);
    } else {
      stTerrainBanner.src = 'gfx/interface/terrains/terrain_plains.png';
    }

    const mpFormatted = st.manpower > 1000000
      ? (st.manpower / 1000000).toFixed(2) + 'M'
      : (st.manpower / 1000).toFixed(0) + 'K';
    stManpower.textContent = mpFormatted;

    let totalVps = 0;
    vpList.innerHTML = '';
    if (st.vps) {
      for (const [vpid, pts] of Object.entries(st.vps)) {
        totalVps += pts;
        const li = document.createElement('li');
        const isCurrent = parseInt(vpid) === activePid;
        li.innerHTML = `<span>Província #${vpid} ${isCurrent ? '<b>(Selecionada)</b>' : ''}</span><strong style="color:var(--gold-title)">★ ${pts} VP</strong>`;
        vpList.appendChild(li);
      }
    }
    if (totalVps === 0) {
      const li = document.createElement('li');
      li.textContent = 'Nenhum centro urbano';
      vpList.appendChild(li);
    }
    stVps.textContent = `★ ${totalVps} VP`;
    stProvCount.textContent = st.provinces.length;

    stateWin.classList.add('open');
  }

  btnCloseState.addEventListener('click', () => {
    stateWin.classList.remove('open');
  });

  // Mapmodes
  modePolitical.addEventListener('click', () => {
    currentMapmode = 'political';
    if (terrainMaterial && texPolitical) terrainMaterial.map = texPolitical;
    terrainMaterial.needsUpdate = true;
    modePolitical.classList.add('active');
    modeTerrain.classList.remove('active');
  });

  modeTerrain.addEventListener('click', () => {
    currentMapmode = 'terrain';
    if (terrainMaterial && texSatellite) terrainMaterial.map = texSatellite;
    terrainMaterial.needsUpdate = true;
    modeTerrain.classList.add('active');
    modePolitical.classList.remove('active');
  });

  btnToggle3D.addEventListener('click', () => {
    camState.is3DActive = !camState.is3DActive;
    lbl3DStatus.textContent = camState.is3DActive ? 'ON' : 'OFF';
  });

  btnZoomIn.addEventListener('click', () => {
    camState.targetDistance = Math.max(camState.minDistance, camState.targetDistance * 0.7);
  });
  btnZoomOut.addEventListener('click', () => {
    camState.targetDistance = Math.min(camState.maxDistance, camState.targetDistance * 1.4);
  });
  btnZoomReset.addEventListener('click', () => {
    camState.target.set(-45, 0, 15);
    camState.targetDistance = 160;
    camState.targetYaw = 0.0;
  });

  // Time Engine
  let isPaused = false;
  let gameSpeed = 1;
  let currentDate = new Date(Date.UTC(1936, 0, 1, 12, 0));

  function updateClock() {
    if (!isPaused) {
      currentDate.setUTCHours(currentDate.getUTCHours() + 1);
      const hours = String(currentDate.getUTCHours()).padStart(2, '0') + ':00';
      const day = currentDate.getUTCDate();
      const months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
      dateDisplay.textContent = `${hours}, ${day} ${months[currentDate.getUTCMonth()]}, ${currentDate.getUTCFullYear()}`;
    }
  }

  let timer = setInterval(updateClock, 1000);

  function togglePause() {
    isPaused = !isPaused;
    btnPause.textContent = isPaused ? '▶' : '⏸';
  }

  function setSpeed(spd) {
    gameSpeed = spd;
    speedPips.forEach(p => p.classList.toggle('active', parseInt(p.dataset.speed) <= spd));
    clearInterval(timer);
    const intervals = [1000, 650, 400, 220, 90];
    timer = setInterval(updateClock, intervals[spd - 1]);
  }

  btnPause.addEventListener('click', togglePause);
  speedPips.forEach(pip => {
    pip.addEventListener('click', () => setSpeed(parseInt(pip.dataset.speed)));
  });

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // -------------------------------------------------------------
  // INITIALIZATION
  // -------------------------------------------------------------
  async function init() {
    const texLoader = new THREE.TextureLoader();

    // 1. Load Theater Political & Satellite Textures
    texPolitical = await new Promise(res => texLoader.load('data/theater_political_map.jpg', res));
    texPolitical.anisotropy = renderer.capabilities.getMaxAnisotropy();

    texSatellite = await new Promise(res => texLoader.load('data/theater_satellite_map.jpg', res));
    texSatellite.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // 2. Load 3D Elevation Displacement & Normal Map
    const texHeight = await new Promise(res => texLoader.load('data/theater_heightmap.jpg', res));
    const texNormal = await new Promise(res => texLoader.load('data/theater_normal.jpg', res));

    // 3. Create 3D Terrain Plane Geometry
    const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_H, 270, 180);
    geometry.rotateX(-Math.PI / 2);

    terrainMaterial = new THREE.MeshStandardMaterial({
      map: texPolitical,
      displacementMap: texHeight,
      displacementScale: 12.0,
      displacementBias: -1.0,
      normalMap: texNormal,
      normalScale: new THREE.Vector2(0.9, 0.9),
      roughness: 0.68,
      metalness: 0.08
    });

    terrainMesh = new THREE.Mesh(geometry, terrainMaterial);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // 4. Interactive Province Highlight Layer Mesh (Positioned just above terrain)
    const hlGeo = new THREE.PlaneGeometry(PLANE_W, PLANE_H, 270, 180);
    hlGeo.rotateX(-Math.PI / 2);
    const hlMat = new THREE.MeshBasicMaterial({
      map: hlTexture,
      transparent: true,
      depthWrite: false,
      blending: THREE.NormalBlending
    });
    hlMesh = new THREE.Mesh(hlGeo, hlMat);
    hlMesh.position.y = 0.35; // Slight offset above terrain
    scene.add(hlMesh);

    // 5. Water Plane underneath land
    const waterGeo = new THREE.PlaneGeometry(PLANE_W * 1.05, PLANE_H * 1.05);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0e1b28,
      roughness: 0.12,
      metalness: 0.85
    });
    const waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = -0.5;
    scene.add(waterMesh);

    // 6. Load Datasets
    try {
      const [binResp, provResp, boundsResp, statesResp] = await Promise.all([
        fetch('data/theater_prov_lookup.bin'),
        fetch('data/theater_provinces.json'),
        fetch('data/theater_prov_bounds.json'),
        fetch('data/hoi4_states.json')
      ]);

      const binBuf = await binResp.arrayBuffer();
      provLookup = new Uint16Array(binBuf);
      provMeta = await provResp.json();
      provBounds = await boundsResp.json();
      statesData = await statesResp.json();

      console.log('Central/Eastern Theater Loaded: 4012 Active Provinces');
      redrawHighlights();

      // Show Berlin by default in state window
      if (statesData["64"]) {
        showStateDetails(statesData["64"], 6521);
      }
    } catch (err) {
      console.error('Failed to load theater data files:', err);
    }

    // 60 FPS Render Loop
    function renderLoop() {
      requestAnimationFrame(renderLoop);
      updateCamera();
      renderer.render(scene, camera);
    }
    renderLoop();
  }

  init();
})();
