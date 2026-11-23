/*
 * Flight Focus — 純前端飛行與專注模擬引擎
 * 進度只由「基準虛擬時間 + 真實時間戳差 × 倍速」推算，不累積影格，
 * 因此背景分頁節流、電腦休眠與倍速切換都不會造成航程漂移。
 */
(function () {
  'use strict';

  const { airports, routes } = window.FLIGHT_FOCUS_DATA;
  const CURRENT_KEY = 'flightFocus.current.v1';
  const LOG_KEY = 'flightFocus.logs.v1';
  // CARTO 自 2026 年起為無密鑰圖磚加上水印。留空會使用免密鑰 Esri 深灰底圖；
  // 如日後取得 CARTO 免費 Key，填入此處即可切回 Dark Matter。
  const CARTO_BASEMAPS_KEY = '';
  const $ = (id) => document.getElementById(id);
  const clamp = (value, min, max) => Math.min(Math.max(value, min), max);

  let map;
  let terminator;
  let selectedFlight = null;
  let activeFlight = null;
  let flightState = null;
  let routeData = null;
  let routeLayer = null;
  let traveledLayer = null;
  let planeMarker = null;
  let animationId = null;
  let currentFilter = 'all';
  let currentSearch = '';
  let following = false;
  let lastFramePaint = 0;
  let lastFollowPan = 0;
  let toastTimer = null;

  let audioContext = null;
  let noiseBuffer = null;
  let noiseSource = null;
  let noiseGain = null;
  let soundEnabled = true;
  let volume = 0.24;
  let wakeLock = null;
  let wakeWanted = false;
  let notifyWanted = false;

  function init() {
    initMap();
    bindEvents();
    renderFlightList();
    updateClock();
    setInterval(updateClock, 1000);
    // 日夜線不依賴飛行狀態，每分鐘以真實時間更新。
    setInterval(updateTerminator, 60000);
    restoreFlight();
  }

  function initMap() {
    map = L.map('map', {
      zoomControl: false,
      attributionControl: true,
      minZoom: 2,
      maxZoom: 10,
      worldCopyJump: false,
      zoomSnap: 0.25,
      wheelPxPerZoomLevel: 90
    }).setView([24, 114], 3);

    const tileSource = CARTO_BASEMAPS_KEY ? {
      url: `https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}{r}.png?key=${encodeURIComponent(CARTO_BASEMAPS_KEY)}`,
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
    } : {
      url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}',
      attribution: '<a href="https://www.esri.com/">Esri</a>, TomTom, Garmin, FAO, NOAA, USGS'
    };
    L.tileLayer(tileSource.url, { maxZoom: 19, attribution: tileSource.attribution }).addTo(map);

    if (typeof L.terminator === 'function') {
      terminator = L.terminator({ color: '#020617', fillColor: '#020617', fillOpacity: 0.3, weight: 0 }).addTo(map);
    }
  }

  function updateTerminator() {
    if (terminator) terminator.setTime(new Date());
  }

  function bindEvents() {
    $('durationFilters').addEventListener('click', (event) => {
      const button = event.target.closest('button[data-filter]');
      if (!button) return;
      currentFilter = button.dataset.filter;
      document.querySelectorAll('#durationFilters button').forEach((item) => item.classList.toggle('active', item === button));
      selectedFlight = null;
      updateSelectionSummary();
      renderFlightList();
      clearRoute();
    });

    $('flightSearch').addEventListener('input', (event) => {
      currentSearch = event.target.value.trim().toLowerCase();
      if (selectedFlight && !matchesFilter(selectedFlight)) {
        selectedFlight = null;
        updateSelectionSummary();
        clearRoute();
      }
      renderFlightList();
    });

    $('flightList').addEventListener('click', (event) => {
      const card = event.target.closest('.flight-card');
      if (!card) return;
      const flight = routes.find((item) => item.id === card.dataset.flightId);
      if (flight) selectFlight(flight);
    });

    $('takeoffBtn').addEventListener('click', takeOff);
    $('followBtn').addEventListener('click', toggleFollow);
    $('soundBtn').addEventListener('click', toggleSound);
    $('volumeSlider').addEventListener('input', (event) => {
      volume = Number(event.target.value) / 100;
      $('volumeValue').value = event.target.value;
      if (noiseGain && audioContext) noiseGain.gain.setTargetAtTime(volume * 1.2, audioContext.currentTime, 0.06);
    });
    $('wakeBtn').addEventListener('click', toggleWakeLock);
    $('notifyBtn').addEventListener('click', toggleNotifications);
    $('zenBtn').addEventListener('click', enterZenMode);
    $('zenExitBtn').addEventListener('click', exitZenMode);
    $('cancelFlightBtn').addEventListener('click', cancelFlight);
    $('newFlightBtn').addEventListener('click', resetToDeparture);

    document.querySelectorAll('#simControl [data-speed]').forEach((button) => {
      button.addEventListener('click', () => setSimulationSpeed(Number(button.dataset.speed)));
    });

    $('openLogBtn').addEventListener('click', openLog);
    $('closeLogBtn').addEventListener('click', closeLog);
    $('drawerBackdrop').addEventListener('click', () => {
      if (!$('logDrawer').hidden) closeLog();
    });
    $('clearLogBtn').addEventListener('click', clearLogs);

    document.addEventListener('keydown', (event) => {
      if (event.key !== 'Escape') return;
      if (document.body.classList.contains('zen-mode')) exitZenMode();
      else if (!$('logDrawer').hidden) closeLog();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.hidden) persistActiveFlight();
      else if (wakeWanted && flightState && !wakeLock) requestWakeLock();
    });
    window.addEventListener('pagehide', persistActiveFlight);

    // 瀏覽器不允許重新整理後自動播放；首次互動時恢復已開啟的機艙聲。
    document.addEventListener('pointerdown', () => {
      if (flightState && soundEnabled && !noiseSource) ensureNoise();
    });
  }

  function updateClock() {
    $('localClock').textContent = new Intl.DateTimeFormat('zh-HK', {
      hour: '2-digit', minute: '2-digit', hour12: false
    }).format(new Date());
  }

  function matchesFilter(flight) {
    const minutes = flight.minutes;
    let matchesDuration = true;
    switch (currentFilter) {
      case 'short': matchesDuration = minutes <= 140; break;
      case '3': matchesDuration = minutes >= 150 && minutes <= 210; break;
      case '4': matchesDuration = minutes > 210 && minutes <= 270; break;
      case '8': matchesDuration = minutes >= 450 && minutes <= 510; break;
      case '9': matchesDuration = minutes > 510 && minutes <= 570; break;
      case 'long': matchesDuration = minutes >= 600; break;
    }
    if (!matchesDuration) return false;
    if (!currentSearch) return true;

    const origin = airports[flight.from];
    const destination = airports[flight.to];
    const searchable = [
      flight.number, flight.id, flight.from, flight.to,
      origin.city, destination.city, origin.name, destination.name
    ].join(' ').toLowerCase();
    return searchable.includes(currentSearch);
  }

  function renderFlightList() {
    const filtered = routes.filter(matchesFilter);
    $('flightCount').textContent = `${filtered.length} 個航班`;
    $('flightList').innerHTML = filtered.length ? filtered.map((flight) => {
      const origin = airports[flight.from];
      const destination = airports[flight.to];
      const selected = selectedFlight && selectedFlight.id === flight.id;
      return `
        <button class="flight-card${selected ? ' selected' : ''}" data-flight-id="${flight.id}" aria-pressed="${selected}">
          <div>
            <div class="flight-meta"><strong>${flight.number}</strong><span>${flight.aircraft}</span></div>
            <div class="route-line">
              <strong>${flight.from}</strong>
              <div class="route-arrow"><svg viewBox="0 0 24 24"><path d="m3 11 18-8-7 18-2-7z"/></svg></div>
              <strong>${flight.to}</strong>
            </div>
            <div class="city-line">${origin.city}<span>→</span>${destination.city}</div>
          </div>
          <div class="flight-duration"><strong>${formatDuration(flight.minutes)}</strong><small>${formatNumber(routeDistance(flight))} km</small></div>
        </button>`;
    }).join('') : '<div class="empty-flights">沒有符合篩選與搜尋條件的航班</div>';
  }

  function selectFlight(flight) {
    selectedFlight = flight;
    renderFlightList();
    updateSelectionSummary();
    buildRoute(flight, false);
    fitRoute(true);
  }

  function updateSelectionSummary() {
    $('takeoffBtn').disabled = !selectedFlight;
    if (!selectedFlight) {
      $('selectionSummary').innerHTML = '<span>尚未選擇航班</span><small>SELECT A FLIGHT TO DEPART</small>';
      return;
    }
    $('selectionSummary').innerHTML = `<span>${selectedFlight.number} · ${selectedFlight.from} → ${selectedFlight.to}</span><small>${formatDuration(selectedFlight.minutes)} · ${airports[selectedFlight.to].city}</small>`;
  }

  function takeOff() {
    if (!selectedFlight) return;
    initAudio();
    if (audioContext && audioContext.state === 'suspended') audioContext.resume().catch(() => {});

    const now = Date.now();
    activeFlight = selectedFlight;
    flightState = {
      version: 1,
      flightId: activeFlight.id,
      task: $('taskInput').value.trim() || '自由專注',
      startedAt: now,
      updatedAt: now,
      elapsedMs: 0,
      speed: 1,
      completed: false
    };

    persistActiveFlight();
    $('preflight').hidden = true;
    $('arrivalCard').hidden = true;
    $('drawerBackdrop').hidden = true;
    showFlightHud();
    buildRoute(activeFlight, true);
    setFollowing(false);
    fitRoute(false);
    setSimulationSpeedButtons(1);
    playChime();
    ensureNoise();
    startFlightLoop();
  }

  function showFlightHud() {
    $('taskHud').hidden = false;
    $('telemetry').hidden = false;
    $('flightControls').hidden = false;
    $('bottomHud').hidden = false;
    $('simControl').hidden = false;
    $('activeTask').textContent = flightState.task;
    $('activeFlightNumber').textContent = activeFlight.number;
    $('originCode').textContent = activeFlight.from;
    $('originCity').textContent = airports[activeFlight.from].city;
    $('destinationCode').textContent = activeFlight.to;
    $('destinationCity').textContent = airports[activeFlight.to].city;
    updateNotificationButton();
  }

  function routeDistance(flight) {
    const from = airports[flight.from];
    const to = airports[flight.to];
    return turf.distance(toPoint([from.lat, from.lng]), toPoint([to.lat, to.lng]), { units: 'kilometers' });
  }

  function toPoint(latLng) {
    return turf.point([latLng[1], latLng[0]]);
  }

  function buildRoute(flight, withPlane) {
    clearRoute();
    const origin = airports[flight.from];
    const destination = airports[flight.to];
    const originLatLng = [origin.lat, origin.lng];
    const destinationLatLng = [destination.lat, destination.lng];
    let greatCircle;

    try {
      greatCircle = turf.greatCircle(toPoint(originLatLng), toPoint(destinationLatLng), { units: 'kilometers', npoints: 180 });
    } catch (_) {
      // 極少數幾何邊界情況以直線作安全回退，避免中斷專注流程。
      greatCircle = turf.lineString([[origin.lng, origin.lat], [destination.lng, destination.lat]]);
    }

    const geometry = greatCircle.geometry;
    const coordinateSegments = geometry.type === 'MultiLineString' ? geometry.coordinates : [geometry.coordinates];
    const segments = coordinateSegments.map((segment) => segment.map((coord) => [coord[1], coord[0]]));
    // 每個節點的累積距離只在建立航線時計算一次，更新循環不再反覆呼叫 Turf。
    const cumulativeDistances = segments.map((segment) => {
      const cumulative = [0];
      for (let index = 1; index < segment.length; index += 1) {
        const legDistance = turf.distance(toPoint(segment[index - 1]), toPoint(segment[index]), { units: 'kilometers' });
        cumulative.push(cumulative[index - 1] + legDistance);
      }
      return cumulative;
    });
    const pathDistance = cumulativeDistances.reduce((total, cumulative) => {
      return total + cumulative[cumulative.length - 1];
    }, 0);

    routeLayer = L.layerGroup().addTo(map);
    L.geoJSON(greatCircle, {
      interactive: false,
      style: { color: '#ffffff', weight: 1.25, opacity: 0.35, dashArray: '5 8', lineCap: 'round' }
    }).addTo(routeLayer);

    traveledLayer = L.polyline([], {
      color: '#38bdf8', weight: 2.4, opacity: 0.95, lineCap: 'round', lineJoin: 'round', interactive: false,
      className: 'traveled-route'
    }).addTo(routeLayer);

    routeLayer.addLayer(createAirportMarker(originLatLng, flight.from, false));
    routeLayer.addLayer(createAirportMarker(destinationLatLng, flight.to, true));

    routeData = {
      flight,
      greatCircle,
      segments,
      cumulativeDistances,
      distance: pathDistance > 0 ? pathDistance : routeDistance(flight)
    };

    if (withPlane) {
      const start = pointAtDistance(0);
      planeMarker = L.marker(start, {
        icon: L.divIcon({
          className: 'plane-marker',
          html: `<div class="plane-pulse"></div><div class="plane-body"><svg viewBox="0 0 48 48"><path d="M44 22.2 28.5 14V6.5a4.5 4.5 0 0 0-9 0V14L4 22.2v4.2l15.5-4.7v12.1l-5.2 3.6v3.2l9.7-2.4 9.7 2.4v-3.2l-5.2-3.6V21.7l15.5 4.7z"/></svg></div>`,
          iconSize: [44, 44],
          iconAnchor: [22, 22]
        }),
        interactive: false,
        keyboard: false,
        zIndexOffset: 1000
      }).addTo(routeLayer);
    }
  }

  function createAirportMarker(latLng, code, destination) {
    return L.marker(latLng, {
      icon: L.divIcon({
        className: '',
        html: `<div class="airport-marker${destination ? ' destination' : ''}"><i class="airport-dot"></i><span class="airport-label">${code}</span></div>`,
        iconSize: [60, 22],
        iconAnchor: [4, 11]
      }),
      interactive: false,
      keyboard: false
    });
  }

  function clearRoute() {
    if (routeLayer) routeLayer.remove();
    routeLayer = null;
    traveledLayer = null;
    planeMarker = null;
    routeData = null;
  }

  function fitRoute(isPreview) {
    if (!routeData) return;
    const bounds = L.latLngBounds(routeData.segments.flat());
    const desktop = window.innerWidth > 720;
    const options = isPreview && desktop
      ? { paddingTopLeft: [480, 90], paddingBottomRight: [70, 90], maxZoom: 5, animate: true, duration: 0.8 }
      : { padding: [55, 55], maxZoom: 6, animate: true, duration: 1.1 };
    map.fitBounds(bounds, options);
  }

  function findLegIndex(cumulative, targetDistance) {
    let low = 0;
    let high = cumulative.length - 1;
    while (low + 1 < high) {
      const middle = Math.floor((low + high) / 2);
      if (cumulative[middle] <= targetDistance) low = middle;
      else high = middle;
    }
    return low;
  }

  function interpolateOnLeg(segment, cumulative, legIndex, targetDistance) {
    const from = segment[legIndex];
    const to = segment[legIndex + 1];
    const legDistance = cumulative[legIndex + 1] - cumulative[legIndex];
    if (!to || legDistance === 0) return from;
    const ratio = clamp((targetDistance - cumulative[legIndex]) / legDistance, 0, 1);
    return [
      from[0] + (to[0] - from[0]) * ratio,
      from[1] + (to[1] - from[1]) * ratio
    ];
  }

  function pointAtDistance(targetDistance) {
    if (!routeData) return [0, 0];
    let remaining = clamp(targetDistance, 0, routeData.distance);

    for (let segmentIndex = 0; segmentIndex < routeData.segments.length; segmentIndex += 1) {
      const segment = routeData.segments[segmentIndex];
      const cumulative = routeData.cumulativeDistances[segmentIndex];
      const segmentDistance = cumulative[cumulative.length - 1];
      if (segment.length === 1 || segmentDistance === 0) {
        if (remaining <= 0) return segment[0];
        continue;
      }
      if (remaining > segmentDistance && segmentIndex < routeData.segments.length - 1) {
        remaining -= segmentDistance;
        continue;
      }
      const legIndex = findLegIndex(cumulative, remaining);
      return interpolateOnLeg(segment, cumulative, legIndex, remaining);
    }

    const lastSegment = routeData.segments[routeData.segments.length - 1];
    return lastSegment[lastSegment.length - 1];
  }

  function traveledSegments(targetDistance) {
    const result = [];
    let remaining = clamp(targetDistance, 0, routeData.distance);

    for (let segmentIndex = 0; segmentIndex < routeData.segments.length; segmentIndex += 1) {
      if (remaining <= 0) break;
      const segment = routeData.segments[segmentIndex];
      const cumulative = routeData.cumulativeDistances[segmentIndex];
      const segmentDistance = cumulative[cumulative.length - 1];

      if (remaining >= segmentDistance) {
        result.push(segment.slice());
        remaining -= segmentDistance;
        continue;
      }
      if (segment.length === 1 || segmentDistance === 0) continue;

      const legIndex = findLegIndex(cumulative, remaining);
      const partial = segment.slice(0, legIndex + 1);
      if (remaining > cumulative[legIndex]) {
        partial.push(interpolateOnLeg(segment, cumulative, legIndex, remaining));
      }
      result.push(partial);
      remaining = 0;
    }
    return result;
  }

  function getElapsedMs(now = Date.now()) {
    if (!flightState) return 0;
    return flightState.elapsedMs + (now - flightState.updatedAt) * flightState.speed;
  }

  function startFlightLoop() {
    if (animationId) cancelAnimationFrame(animationId);
    lastFramePaint = 0;
    const frame = (timestamp) => {
      if (!flightState || flightState.completed) return;
      if (timestamp - lastFramePaint >= 150) {
        updateFlight();
        lastFramePaint = timestamp;
      }
      if (flightState && !flightState.completed) animationId = requestAnimationFrame(frame);
    };
    updateFlight();
    if (flightState && !flightState.completed) animationId = requestAnimationFrame(frame);
  }

  function updateFlight() {
    if (!flightState || !activeFlight || !routeData || flightState.completed) return;
    const now = Date.now();
    const durationMs = activeFlight.minutes * 60000;
    const elapsed = getElapsedMs(now);
    const progress = clamp(elapsed / durationMs, 0, 1);
    const distanceFlown = routeData.distance * progress;
    const position = pointAtDistance(distanceFlown);
    const ahead = pointAtDistance(Math.min(distanceFlown + 3, routeData.distance));
    const behind = pointAtDistance(Math.max(distanceFlown - 3, 0));
    const bearingPoint = distanceFlown >= routeData.distance ? behind : position;
    const bearingTarget = distanceFlown >= routeData.distance ? position : ahead;
    const bearing = (turf.bearing(toPoint(bearingPoint), toPoint(bearingTarget)) + 360) % 360;

    if (planeMarker) {
      planeMarker.setLatLng(position);
      const element = planeMarker.getElement();
      if (element) {
        const body = element.querySelector('.plane-body');
        if (body) body.style.transform = `rotate(${bearing}deg)`;
      }
    }
    if (traveledLayer) traveledLayer.setLatLngs(traveledSegments(distanceFlown));

    if (following && now - lastFollowPan > 900) {
      map.panTo(position, { animate: true, duration: 0.75, noMoveStart: true });
      lastFollowPan = now;
    }

    updateTelemetry(elapsed, durationMs, progress, distanceFlown, bearing, now, position);
    updateProgress(progress, elapsed, durationMs, now);

    if (progress >= 1) completeFlight();
  }

  function updateTelemetry(elapsed, durationMs, progress, distanceFlown, bearing, now, position) {
    const climbMs = Math.min(durationMs * 0.1, 15 * 60000);
    const descentMs = Math.min(durationMs * 0.1, 20 * 60000);
    const descentStart = durationMs - descentMs;
    const cruiseAltitude = activeFlight.minutes >= 420 ? 38000 : 36000;
    const cruiseSpeed = clamp(routeData.distance / (activeFlight.minutes / 60), 720, 920);
    let altitude;
    let groundSpeed;
    let phase;

    if (elapsed < climbMs) {
      const ratio = easeOutCubic(clamp(elapsed / climbMs, 0, 1));
      phase = '爬升中 · CLIMBING';
      altitude = cruiseAltitude * ratio;
      groundSpeed = 250 + (cruiseSpeed - 250) * ratio;
    } else if (elapsed >= descentStart) {
      const ratio = easeInOutCubic(clamp((elapsed - descentStart) / descentMs, 0, 1));
      phase = '下降中 · DESCENDING';
      altitude = cruiseAltitude * (1 - ratio);
      groundSpeed = cruiseSpeed - (cruiseSpeed - 280) * ratio;
    } else {
      phase = '巡航中 · CRUISING';
      // 微小的正弦與隨機擾動，避免高度像僵硬的固定數字。
      altitude = cruiseAltitude + Math.sin(now / 1700) * 18 + (Math.random() - 0.5) * 8;
      groundSpeed = cruiseSpeed + Math.sin(now / 4200) * 7;
    }

    $('phaseLabel').textContent = phase;
    $('altitudeValue').textContent = Math.round(altitude).toLocaleString('en-US');
    $('speedValue').innerHTML = `${Math.round(groundSpeed)} <em>km/h</em>`;
    $('headingValue').textContent = `${String(Math.round(bearing) % 360).padStart(3, '0')}°`;
    $('flownValue').innerHTML = `${formatNumber(distanceFlown)} <em>km</em>`;
    $('remainingValue').innerHTML = `${formatNumber(routeData.distance * (1 - progress))} <em>km</em>`;
    $('coordinatesValue').textContent = formatCoordinates(position);
  }

  function updateProgress(progress, elapsed, durationMs, now) {
    const percent = progress * 100;
    const remainingVirtual = Math.max(durationMs - elapsed, 0);
    const eta = new Date(now + remainingVirtual / flightState.speed);
    $('countdownValue').textContent = formatCountdown(remainingVirtual);
    $('elapsedValue').textContent = formatCountdown(Math.min(elapsed, durationMs));
    $('progressFill').style.width = `${percent}%`;
    $('progressPlane').style.left = `${percent}%`;
    $('progressPercent').textContent = `${Math.floor(percent)}% COMPLETE`;
    $('etaValue').textContent = formatLocalTime(eta, airports[activeFlight.to].tz);
    $('zenProgress').firstElementChild.style.width = `${percent}%`;
  }

  function setSimulationSpeed(speed) {
    if (!flightState || ![1, 60, 600].includes(speed)) return;
    const now = Date.now();
    // 先結算舊倍速下的虛擬時間，再建立新時間錨點，進度不會回跳。
    flightState.elapsedMs = Math.min(getElapsedMs(now), activeFlight.minutes * 60000);
    flightState.updatedAt = now;
    flightState.speed = speed;
    setSimulationSpeedButtons(speed);
    persistActiveFlight();
    updateFlight();
    showToast(speed === 1 ? '已切換至即時速度' : `模擬速度已設為 ${speed}x`);
  }

  function setSimulationSpeedButtons(speed) {
    document.querySelectorAll('#simControl [data-speed]').forEach((button) => {
      button.classList.toggle('active', Number(button.dataset.speed) === speed);
    });
  }

  function toggleFollow() {
    setFollowing(!following);
    if (following && routeData && flightState) {
      const position = pointAtDistance(routeData.distance * clamp(getElapsedMs() / (activeFlight.minutes * 60000), 0, 1));
      map.panTo(position, { animate: true, duration: 0.8 });
    }
  }

  function setFollowing(value) {
    following = value;
    $('followBtn').classList.toggle('active', value);
    $('followBtn').setAttribute('aria-pressed', String(value));
    $('followBtn').querySelector('b').textContent = value ? 'ON' : 'OFF';
    if (value) map.dragging.disable();
    else map.dragging.enable();
  }

  function completeFlight() {
    if (!flightState || flightState.completed) return;
    flightState.completed = true;
    exitZenMode();
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    try { localStorage.removeItem(CURRENT_KEY); } catch (_) {}

    const logs = readLogs();
    logs.unshift({
      id: `${flightState.startedAt}-${activeFlight.id}`,
      flightId: activeFlight.id,
      task: flightState.task,
      completedAt: Date.now(),
      minutes: activeFlight.minutes,
      distance: Math.round(routeData.distance)
    });
    writeLogs(logs);

    $('phaseLabel').textContent = '已抵達 · LANDED';
    $('countdownValue').textContent = '00:00:00';
    $('arrivalRoute').textContent = `${activeFlight.from} → ${activeFlight.to} · ${activeFlight.number}`;
    $('arrivalTask').textContent = flightState.task;
    $('arrivalDuration').textContent = formatDuration(activeFlight.minutes);
    $('arrivalDistance').textContent = `${formatNumber(routeData.distance)} km`;
    $('arrivalCard').hidden = false;
    $('drawerBackdrop').hidden = false;
    $('flightControls').hidden = true;
    $('simControl').hidden = true;
    playChime();
    stopNoise();
    releaseWakeLock();
    sendArrivalNotification();
    fitRoute(false);
  }

  function cancelFlight() {
    if (!flightState) return;
    if (!window.confirm('確定終止目前航程？這次未完成的專注不會寫入飛行日誌。')) return;
    if (animationId) cancelAnimationFrame(animationId);
    animationId = null;
    selectedFlight = activeFlight;
    try { localStorage.removeItem(CURRENT_KEY); } catch (_) {}
    stopNoise();
    releaseWakeLock();
    flightState = null;
    activeFlight = null;
    exitZenMode();
    hideFlightHud();
    $('preflight').hidden = false;
    $('taskInput').value = '';
    renderFlightList();
    updateSelectionSummary();
    buildRoute(selectedFlight, false);
    fitRoute(true);
  }

  function resetToDeparture() {
    flightState = null;
    activeFlight = null;
    selectedFlight = null;
    exitZenMode();
    hideFlightHud();
    clearRoute();
    $('arrivalCard').hidden = true;
    $('drawerBackdrop').hidden = true;
    $('preflight').hidden = false;
    $('taskInput').value = '';
    renderFlightList();
    updateSelectionSummary();
    map.setView([24, 114], 3, { animate: true });
  }

  function hideFlightHud() {
    $('taskHud').hidden = true;
    $('telemetry').hidden = true;
    $('flightControls').hidden = true;
    $('bottomHud').hidden = true;
    $('simControl').hidden = true;
    $('zenProgress').hidden = true;
    $('zenExitBtn').hidden = true;
    setFollowing(false);
  }

  function persistActiveFlight() {
    if (!flightState || flightState.completed) return;
    try { localStorage.setItem(CURRENT_KEY, JSON.stringify(flightState)); } catch (_) {}
  }

  function restoreFlight() {
    let saved;
    try { saved = JSON.parse(localStorage.getItem(CURRENT_KEY)); } catch (_) { return; }
    if (!saved || saved.completed) return;
    const flight = routes.find((item) => item.id === saved.flightId);
    if (!flight || !Number.isFinite(saved.updatedAt) || !Number.isFinite(saved.elapsedMs)) return;

    activeFlight = flight;
    selectedFlight = flight;
    flightState = saved;
    if (![1, 60, 600].includes(flightState.speed)) flightState.speed = 1;
    flightState.task = String(flightState.task || '自由專注').slice(0, 80);
    $('taskInput').value = flightState.task === '自由專注' ? '' : flightState.task;
    $('preflight').hidden = true;
    showFlightHud();
    buildRoute(activeFlight, true);
    setFollowing(false);
    fitRoute(false);
    setSimulationSpeedButtons(flightState.speed);
    startFlightLoop();
    if (!flightState.completed) showToast('已恢復上次航程，飛行進度保持同步');
  }

  function enterZenMode() {
    if (!flightState) return;
    document.body.classList.add('zen-mode');
    $('zenExitBtn').hidden = false;
    $('zenProgress').hidden = false;
    if (routeData && flightState) setFollowing(true);
  }

  function exitZenMode() {
    document.body.classList.remove('zen-mode');
    $('zenExitBtn').hidden = true;
    $('zenProgress').hidden = true;
  }

  /* Web Audio：本地合成棕噪音，不需要任何音訊檔案。 */
  function initAudio() {
    if (audioContext) return;
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      soundEnabled = false;
      updateSoundButton();
      return;
    }
    audioContext = new AudioContextClass();
    const length = audioContext.sampleRate * 4;
    noiseBuffer = audioContext.createBuffer(1, length, audioContext.sampleRate);
    const output = noiseBuffer.getChannelData(0);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      output[index] = last * 3.2;
    }
  }

  function ensureNoise() {
    if (!soundEnabled || !flightState || flightState.completed) return;
    initAudio();
    if (!audioContext || noiseSource) return;
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});

    const source = audioContext.createBufferSource();
    noiseSource = source;
    noiseSource.buffer = noiseBuffer;
    noiseSource.loop = true;
    const filter = audioContext.createBiquadFilter();
    filter.type = 'lowpass';
    filter.frequency.value = 700;
    filter.Q.value = 0.35;
    noiseGain = audioContext.createGain();
    noiseGain.gain.value = 0;
    noiseSource.connect(filter);
    filter.connect(noiseGain);
    noiseGain.connect(audioContext.destination);
    noiseSource.start();
    noiseGain.gain.setTargetAtTime(volume * 1.2, audioContext.currentTime, 0.35);
    source.onended = () => {
      if (noiseSource === source) {
        noiseSource = null;
        noiseGain = null;
      }
    };
  }

  function stopNoise() {
    if (!noiseSource || !audioContext) return;
    const source = noiseSource;
    if (noiseGain) noiseGain.gain.setTargetAtTime(0, audioContext.currentTime, 0.08);
    window.setTimeout(() => {
      try { source.stop(); } catch (_) {}
      source.disconnect();
    }, 250);
    noiseSource = null;
  }

  function playChime() {
    // AudioContext 只由起飛或音效按鈕等使用者手勢建立；自動恢復後抵達不觸發自動播放警告。
    if (!soundEnabled || !audioContext) return;
    if (audioContext.state === 'suspended') audioContext.resume().catch(() => {});
    const start = audioContext.currentTime + 0.03;
    [659.25, 523.25].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      const at = start + index * 0.34;
      oscillator.type = 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0, at);
      gain.gain.linearRampToValueAtTime(0.12, at + 0.025);
      gain.gain.exponentialRampToValueAtTime(0.001, at + 0.42);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start(at);
      oscillator.stop(at + 0.45);
    });
  }

  function toggleSound() {
    soundEnabled = !soundEnabled;
    updateSoundButton();
    if (soundEnabled) {
      initAudio();
      ensureNoise();
      playChime();
    } else stopNoise();
  }

  function updateSoundButton() {
    $('soundBtn').classList.toggle('active', soundEnabled);
    $('soundBtn').setAttribute('aria-pressed', String(soundEnabled));
    $('soundBtn').querySelector('b').textContent = soundEnabled ? 'ON' : 'OFF';
  }

  async function toggleWakeLock() {
    if (wakeLock) {
      wakeWanted = false;
      await releaseWakeLock();
      showToast('已關閉螢幕常亮');
    } else {
      wakeWanted = true;
      await requestWakeLock();
    }
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) {
      wakeWanted = false;
      updateWakeButton();
      showToast('此瀏覽器不支援螢幕常亮功能');
      return;
    }
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => {
        wakeLock = null;
        updateWakeButton();
      });
      updateWakeButton();
      showToast('飛行期間將保持螢幕常亮');
    } catch (_) {
      wakeWanted = false;
      updateWakeButton();
      showToast('無法啟用螢幕常亮，請確認瀏覽器權限');
    }
  }

  async function releaseWakeLock() {
    wakeWanted = false;
    if (wakeLock) {
      try { await wakeLock.release(); } catch (_) {}
    }
    wakeLock = null;
    updateWakeButton();
  }

  function updateWakeButton() {
    const active = Boolean(wakeLock);
    $('wakeBtn').classList.toggle('active', active);
    $('wakeBtn').setAttribute('aria-pressed', String(active));
    $('wakeBtn').querySelector('b').textContent = active ? 'ON' : 'OFF';
  }

  async function toggleNotifications() {
    if (!('Notification' in window)) {
      showToast('此瀏覽器不支援系統通知');
      return;
    }
    if (Notification.permission === 'granted') {
      notifyWanted = !notifyWanted;
    } else if (Notification.permission === 'denied') {
      showToast('通知權限已被封鎖，請在瀏覽器設定中開啟');
      return;
    } else {
      try {
        const permission = await Notification.requestPermission();
        notifyWanted = permission === 'granted';
        if (!notifyWanted) showToast('未取得通知權限');
      } catch (_) {
        showToast('目前環境無法請求通知權限');
        return;
      }
    }
    updateNotificationButton();
    if (notifyWanted) showToast('抵達時會送出系統通知');
  }

  function updateNotificationButton() {
    const granted = 'Notification' in window && Notification.permission === 'granted';
    if (!granted) notifyWanted = false;
    $('notifyBtn').classList.toggle('active', notifyWanted);
    $('notifyBtn').setAttribute('aria-pressed', String(notifyWanted));
    $('notifyBtn').querySelector('b').textContent = notifyWanted ? 'ON' : 'OFF';
  }

  function sendArrivalNotification() {
    if (!notifyWanted || !('Notification' in window) || Notification.permission !== 'granted') return;
    try {
      new Notification('Flight Focus · 降落完成', {
        body: `${activeFlight.from} → ${activeFlight.to}｜${flightState.task}\n專注 ${formatDuration(activeFlight.minutes)}，航程 ${formatNumber(routeData.distance)} km。`,
        tag: 'flight-focus-arrival'
      });
    } catch (_) {}
  }

  function openLog() {
    renderLogs();
    $('logDrawer').hidden = false;
    $('drawerBackdrop').hidden = false;
  }

  function closeLog() {
    $('logDrawer').hidden = true;
    if ($('arrivalCard').hidden) $('drawerBackdrop').hidden = true;
  }

  function readLogs() {
    try {
      const logs = JSON.parse(localStorage.getItem(LOG_KEY));
      return Array.isArray(logs) ? logs : [];
    } catch (_) { return []; }
  }

  function writeLogs(logs) {
    try { localStorage.setItem(LOG_KEY, JSON.stringify(logs)); } catch (_) {}
  }

  function renderLogs() {
    const logs = readLogs();
    const totalMinutes = logs.reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
    const totalDistance = logs.reduce((sum, entry) => sum + Number(entry.distance || 0), 0);
    $('logFlights').textContent = logs.length;
    $('logHours').textContent = (totalMinutes / 60).toFixed(1);
    $('logDistance').textContent = Math.round(totalDistance).toLocaleString('en-US');
    $('clearLogBtn').hidden = logs.length === 0;
    $('logList').innerHTML = logs.length ? logs.map((entry) => {
      const flight = routes.find((item) => item.id === entry.flightId);
      if (!flight) return '';
      const date = new Intl.DateTimeFormat('zh-HK', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(entry.completedAt));
      return `<article class="log-entry">
        <div class="log-entry-head"><strong>${flight.from} → ${flight.to}</strong><span>${flight.number}</span></div>
        <p>${escapeHtml(entry.task || '自由專注')}</p>
        <small>${date} · ${formatDuration(entry.minutes)} · ${formatNumber(entry.distance)} km</small>
      </article>`;
    }).join('') : '<div class="empty-log">還沒有完成的航程。<br>第一段專注旅程，等你起飛。</div>';
  }

  function clearLogs() {
    if (!window.confirm('確定清除所有飛行日誌？此操作無法復原。')) return;
    try { localStorage.removeItem(LOG_KEY); } catch (_) {}
    renderLogs();
  }

  function showToast(message) {
    window.clearTimeout(toastTimer);
    $('toast').textContent = message;
    $('toast').classList.add('show');
    toastTimer = window.setTimeout(() => $('toast').classList.remove('show'), 2800);
  }

  function formatDuration(minutes) {
    const value = Math.round(Number(minutes));
    return `${Math.floor(value / 60)}h ${String(value % 60).padStart(2, '0')}m`;
  }

  function formatCountdown(milliseconds) {
    const totalSeconds = Math.max(0, Math.ceil(milliseconds / 1000));
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
  }

  function formatNumber(number) {
    return Math.round(Number(number)).toLocaleString('en-US');
  }

  function formatLocalTime(date, timeZone) {
    try {
      return new Intl.DateTimeFormat('zh-HK', { timeZone, hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    } catch (_) {
      return new Intl.DateTimeFormat('zh-HK', { hour: '2-digit', minute: '2-digit', hour12: false }).format(date);
    }
  }

  function formatCoordinates(position) {
    const lat = `${Math.abs(position[0]).toFixed(4)}° ${position[0] >= 0 ? 'N' : 'S'}`;
    const lng = `${Math.abs(position[1]).toFixed(4)}° ${position[1] >= 0 ? 'E' : 'W'}`;
    return `${lat} · ${lng}`;
  }

  function escapeHtml(value) {
    const div = document.createElement('div');
    div.textContent = String(value);
    return div.innerHTML;
  }

  function easeOutCubic(value) { return 1 - Math.pow(1 - value, 3); }
  function easeInOutCubic(value) {
    return value < 0.5 ? 4 * value * value * value : 1 - Math.pow(-2 * value + 2, 3) / 2;
  }

  init();
})();
