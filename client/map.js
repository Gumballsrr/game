/**
 * Hearts of Iron IV - True 3D WebGL Engine
 * Built with Three.js - Real 3D Terrain Mesh with Heightmap Vertex Displacement,
 * Normal Mapping, Clausewitz Camera Controls, and Real-Time Raycasting.
 */
(() => {
  'use strict';

  // Container
  const container = document.getElementById('map-3d-wrapper');

  // Three.js Scene, Camera, Renderer
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x060c13);

  const camera = new THREE.PerspectiveCamera(
    45,
    window.innerWidth / window.innerHeight,
    1,
    25000
  );

  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.appendChild(renderer.domElement);

  // Lighting (Authentic HOI4 Northwest Directional Sun + Ambient Sky)
  const ambientLight = new THREE.AmbientLight(0xdde8f5, 0.65);
  scene.add(ambientLight);

  const sunLight = new THREE.DirectionalLight(0xfff6e5, 1.15);
  sunLight.position.set(-300, 500, 350);
  sunLight.castShadow = true;
  scene.add(sunLight);

  const fillLight = new THREE.DirectionalLight(0x7090b0, 0.35);
  fillLight.position.set(200, 300, -200);
  scene.add(fillLight);

  // Map Dimensions (Official HOI4 Proportions: 5632 x 2048)
  const PLANE_W = 563.2;
  const PLANE_H = 204.8;
  const MAP_W = 5632;
  const MAP_H = 2048;
  const LOOKUP_W = 2816;
  const LOOKUP_H = 1024;

  let terrainMesh = null;
  let waterMesh = null;
  let material = null;
  let texPolitical = null;
  let texSatellite = null;
  let currentMapmode = 'political';

  // UI Elements
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

  // Data
  let statesData = {};
  let countriesData = {};
  let provLookup = null;

  // Flag resolver
  function getFlagUrl(tag) {
    const known = {
      GER: 'gfx/flags/GER_fascism.png',
      SOV: 'gfx/flags/SOV_communism.png',
      ENG: 'gfx/flags/ENG_democratic.png',
      FRA: 'gfx/flags/FRA_democratic.png',
      USA: 'gfx/flags/USA_democratic.png',
      ITA: 'gfx/flags/ITA_fascism.png',
      JAP: 'gfx/flags/JAP_fascism.png',
      POL: 'gfx/flags/POL_neutrality.png',
      CHI: 'gfx/flags/CHI_neutrality.png',
      SPA: 'gfx/flags/SPA_neutrality.png',
      SWE: 'gfx/flags/SWE_democratic.png',
      BRA: 'gfx/flags/BRA_neutrality.png'
    };
    return known[tag] || 'gfx/flags/GER_fascism.png';
  }

  // -------------------------------------------------------------
  // CLAUSEWITZ 3D CAMERA CONTROLLER
  // -------------------------------------------------------------
  const camState = {
    // Target position on map (Central Europe / Berlin default)
    target: new THREE.Vector3(20, 0, 10),
    current: new THREE.Vector3(20, 0, 10),
    // Distance from target (Zoom)
    distance: 140,
    targetDistance: 140,
    minDistance: 15,
    maxDistance: 450,
    // Pitch (tilt angle from vertical: 0 = straight down, ~65° = horizon tilt)
    pitch: 0.45,
    targetPitch: 0.45,
    minPitch: 0.05,
    maxPitch: 1.15,
    // Yaw (horizontal rotation)
    yaw: 0.0,
    targetYaw: 0.0,
    is3DActive: true
  };

  function updateCamera() {
    // Smooth interpolation (Lerp)
    camState.current.lerp(camState.target, 0.14);
    camState.distance += (camState.targetDistance - camState.distance) * 0.14;
    camState.yaw += (camState.targetYaw - camState.yaw) * 0.14;

    // Automatic 3D tilt curve: closer zoom -> tilt down towards horizon
    if (camState.is3DActive) {
      const zoomRatio = 1.0 - (camState.distance - camState.minDistance) / (camState.maxDistance - camState.minDistance);
      // As zoom goes from 0 (far) to 1 (near), pitch tilts from 0.15 (near top-down) to 0.95 (~55 degrees)
      const autoPitch = 0.15 + Math.pow(Math.max(0, zoomRatio), 0.8) * 0.85;
      camState.targetPitch = Math.min(camState.maxPitch, autoPitch);
    } else {
      camState.targetPitch = 0.05; // Almost flat top-down
    }
    camState.pitch += (camState.targetPitch - camState.pitch) * 0.12;

    // Spherical coordinates to Cartesian
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

  // Mouse drag handling (Pan & Orbit)
  let isDragging = false;
  let dragButton = 0; // 0 = left (pan), 2 = right (rotate)
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
        // Left drag: Pan on ground plane
        const factor = camState.distance * 0.0018;
        const forward = new THREE.Vector3(Math.sin(camState.yaw), 0, Math.cos(camState.yaw));
        const right = new THREE.Vector3(Math.cos(camState.yaw), 0, -Math.sin(camState.yaw));

        camState.target.addScaledVector(right, -dx * factor);
        camState.target.addScaledVector(forward, -dy * factor);

        // Clamp to map bounds
        camState.target.x = Math.max(-PLANE_W / 2, Math.min(PLANE_W / 2, camState.target.x));
        camState.target.z = Math.max(-PLANE_H / 2, Math.min(PLANE_H / 2, camState.target.z));
      } else if (dragButton === 2) {
        // Right drag: Free 3D Rotation (Yaw)
        camState.targetYaw -= dx * 0.006;
      }
      tooltip.classList.remove('visible');
      return;
    }

    // Hover Raycasting
    handleHover(e.clientX, e.clientY);
  });

  window.addEventListener('mouseup', () => {
    isDragging = false;
  });

  // Smooth mouse-wheel zoom
  window.addEventListener('wheel', (e) => {
    e.preventDefault();
    const zoomFactor = e.deltaY < 0 ? 0.82 : 1.22;
    camState.targetDistance = Math.min(camState.maxDistance, Math.max(camState.minDistance, camState.targetDistance * zoomFactor));
  }, { passive: false });

  // -------------------------------------------------------------
  // RAYCASTING & PROVINCE DETECTION
  // -------------------------------------------------------------
  const raycaster = new THREE.Raycaster();
  const mouseVec = new THREE.Vector2();

  function getRayIntersection(screenX, screenY) {
    if (!terrainMesh) return null;
    mouseVec.x = (screenX / window.innerWidth) * 2 - 1;
    mouseVec.y = -(screenY / window.innerHeight) * 2 + 1;
    raycaster.setFromCamera(mouseVec, camera);
    const hits = raycaster.intersectObject(terrainMesh);
    return (hits.length > 0) ? hits[0] : null;
  }

  function handleHover(screenX, screenY) {
    const hit = getRayIntersection(screenX, screenY);
    if (!hit || !hit.uv || !provLookup) {
      tooltip.classList.remove('visible');
      return;
    }

    const lx = Math.floor(hit.uv.x * LOOKUP_W);
    const ly = Math.floor((1.0 - hit.uv.y) * LOOKUP_H);
    if (lx < 0 || lx >= LOOKUP_W || ly < 0 || ly >= LOOKUP_H) {
      tooltip.classList.remove('visible');
      return;
    }

    const pid = provLookup[ly * LOOKUP_W + lx] || 0;
    if (pid > 0) {
      let foundState = null;
      for (const sid in statesData) {
        if (statesData[sid].provinces.includes(pid)) {
          foundState = statesData[sid];
          break;
        }
      }

      if (foundState) {
        ttFlagImg.src = getFlagUrl(foundState.owner);
        ttState.textContent = foundState.name;

        let vpText = '';
        if (foundState.vps && foundState.vps[pid]) {
          vpText = ` • ⭐ ${foundState.vps[pid]} VP`;
        }
        ttSub.textContent = `${foundState.country_name} (${foundState.owner}) • Prov: #${pid}${vpText}`;

        tooltip.style.left = `${screenX + 16}px`;
        tooltip.style.top = `${screenY + 16}px`;
        tooltip.classList.add('visible');
      } else {
        tooltip.classList.remove('visible');
      }
    } else {
      tooltip.classList.remove('visible');
    }
  }

  // Click to open State Window
  window.addEventListener('click', (e) => {
    if (e.target !== renderer.domElement) return;
    const hit = getRayIntersection(e.clientX, e.clientY);
    if (!hit || !hit.uv || !provLookup) return;

    const lx = Math.floor(hit.uv.x * LOOKUP_W);
    const ly = Math.floor((1.0 - hit.uv.y) * LOOKUP_H);
    const pid = provLookup[ly * LOOKUP_W + lx] || 0;

    if (pid > 0) {
      for (const sid in statesData) {
        if (statesData[sid].provinces.includes(pid)) {
          showStateDetails(statesData[sid]);
          break;
        }
      }
    }
  });

  function showStateDetails(st) {
    stName.textContent = st.name;
    stCategory.textContent = st.category || 'Regional';
    stOwnerName.textContent = `${st.country_name} (${st.owner})`;
    stFlagImg.src = getFlagUrl(st.owner);

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
        li.innerHTML = `<span>Província #${vpid}</span><strong>⭐ ${pts} VP</strong>`;
        vpList.appendChild(li);
      }
    }
    if (totalVps === 0) {
      const li = document.createElement('li');
      li.textContent = 'Nenhum centro urbano';
      vpList.appendChild(li);
    }
    stVps.textContent = `⭐ ${totalVps} VP`;
    stProvCount.textContent = st.provinces.length;

    stateWin.classList.add('open');
  }

  btnCloseState.addEventListener('click', () => {
    stateWin.classList.remove('open');
  });

  // Mapmodes
  modePolitical.addEventListener('click', () => {
    currentMapmode = 'political';
    if (material && texPolitical) material.map = texPolitical;
    material.needsUpdate = true;
    modePolitical.classList.add('active');
    modeTerrain.classList.remove('active');
  });

  modeTerrain.addEventListener('click', () => {
    currentMapmode = 'terrain';
    if (material && texSatellite) material.map = texSatellite;
    material.needsUpdate = true;
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
    camState.target.set(20, 0, 10);
    camState.targetDistance = 140;
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

  btnPause.addEventListener('click', togglePause);
  window.addEventListener('keydown', (e) => {
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
    }
  });

  speedPips.forEach(pip => {
    pip.addEventListener('click', () => {
      const spd = parseInt(pip.dataset.speed);
      gameSpeed = spd;
      speedPips.forEach(p => p.classList.toggle('active', parseInt(p.dataset.speed) <= spd));
      clearInterval(timer);
      const intervals = [1000, 650, 400, 220, 90];
      timer = setInterval(updateClock, intervals[spd - 1]);
    });
  });

  // Window resize handler (strictly maintains 3D aspect ratio without texture distortion!)
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });

  // -------------------------------------------------------------
  // INITIALIZATION & TEXTURE LOADING
  // -------------------------------------------------------------
  async function init() {
    const texLoader = new THREE.TextureLoader();

    // 1. Load Political Map Texture
    texPolitical = await new Promise(res => texLoader.load('data/hoi4_political_map.jpg', res));
    texPolitical.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // 2. Load Satellite Colormap Texture
    texSatellite = await new Promise(res => texLoader.load('data/hoi4_satellite_colormap.jpg', res));
    texSatellite.anisotropy = renderer.capabilities.getMaxAnisotropy();

    // 3. Load 3D Heightmap Displacement Texture (physically elevates vertices!)
    const texDisp = await new Promise(res => texLoader.load('data/hoi4_heightmap_displacement.jpg', res));

    // 4. Load 3D Normal Map
    let texNormal = null;
    try {
      texNormal = await new Promise(res => texLoader.load('data/hoi4_normal_map.jpg', res));
    } catch (_) {}

    // Create 3D Terrain Plane Geometry (Subdivided for vertex height elevation)
    const geometry = new THREE.PlaneGeometry(PLANE_W, PLANE_H, 512, 256);
    geometry.rotateX(-Math.PI / 2); // Lay flat on XZ plane

    material = new THREE.MeshStandardMaterial({
      map: texPolitical,
      displacementMap: texDisp,
      displacementScale: 14.0, // Mountains like the Alps physically rise up!
      displacementBias: -1.0,
      normalMap: texNormal,
      normalScale: new THREE.Vector2(0.85, 0.85),
      roughness: 0.72,
      metalness: 0.08
    });

    terrainMesh = new THREE.Mesh(geometry, material);
    terrainMesh.receiveShadow = true;
    scene.add(terrainMesh);

    // Shiny Ocean Water Surface Plane (subtle gloss underneath land)
    const waterGeo = new THREE.PlaneGeometry(PLANE_W * 1.05, PLANE_H * 1.05);
    waterGeo.rotateX(-Math.PI / 2);
    const waterMat = new THREE.MeshStandardMaterial({
      color: 0x0e1b28,
      roughness: 0.15,
      metalness: 0.8
    });
    waterMesh = new THREE.Mesh(waterGeo, waterMat);
    waterMesh.position.y = -0.5;
    scene.add(waterMesh);

    // Load JSONs and Binary Lookup Table
    try {
      const stResp = await fetch('data/hoi4_states.json');
      statesData = await stResp.json();

      const cResp = await fetch('data/hoi4_countries.json');
      countriesData = await cResp.json();

      const binResp = await fetch('data/hoi4_prov_lookup_2816.bin');
      const binBuf = await binResp.arrayBuffer();
      provLookup = new Uint16Array(binBuf);
      console.log('HOI4 3D Engine: Province Lookup Loaded (2816x1024)');
    } catch (err) {
      console.error('Failed to load HOI4 data files:', err);
    }

    // Start 60 FPS Render Loop
    function renderLoop() {
      requestAnimationFrame(renderLoop);
      updateCamera();
      renderer.render(scene, camera);
    }
    renderLoop();
  }

  init();
})();
