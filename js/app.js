// js/app.js
import { loadWebpackModule } from "./webpack-loader.js";

/**
 * Debug level:
 *  0 = minimal
 *  1 = normal (default)
 *  2 = verbose (recommended for "calibration stuck 0%")
 * Use: ?debug=2
 */
const DEBUG_LEVEL = (() => {
  const v = new URLSearchParams(location.search).get("debug");
  const n = Number(v);
  return Number.isFinite(n) ? n : 1;
})();

const LICENSE_KEY = "dev_1ntzip9admm6g0upynw3gooycnecx0vl93hz8nox"; // Do NOT display in UI

// ---------- DOM helpers ----------
const $ = (id) => document.getElementById(id);

const els = {
  calPoints: $("calPoints"),
  btnStart: $("btnStart"),
  btnStop: $("btnStop"),
  btnCal: $("btnCal"),
  btnClear: $("btnClear"),

  pillCoi: $("pillCoi"),
  pillSdk: $("pillSdk"),
  pillTrack: $("pillTrack"),
  pillPerm: $("pillPerm"),
  pillCal: $("pillCal"),

  canvas: $("output"),
};

// ---------- UI pills ----------
function setPill(el, text) {
  if (!el) return;
  el.textContent = text;
}

// ---------- log panel (in-page) ----------
function ensureLogPanel() {
  let panel = $("debugLogPanel");
  if (panel) return panel;

  panel = document.createElement("pre");
  panel.id = "debugLogPanel";
  panel.style.position = "fixed";
  panel.style.right = "12px";
  panel.style.bottom = "12px";
  panel.style.width = "560px";
  panel.style.maxWidth = "calc(100vw - 24px)";
  panel.style.height = "320px";
  panel.style.maxHeight = "40vh";
  panel.style.overflow = "auto";
  panel.style.padding = "10px";
  panel.style.borderRadius = "10px";
  panel.style.background = "rgba(0,0,0,0.75)";
  panel.style.color = "#d7f7d7";
  panel.style.fontFamily = "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace";
  panel.style.fontSize = "12px";
  panel.style.lineHeight = "1.35";
  panel.style.zIndex = "99999";
  panel.style.whiteSpace = "pre-wrap";
  panel.style.wordBreak = "break-word";
  panel.style.userSelect = "text";

  const header = document.createElement("div");
  header.style.position = "fixed";
  header.style.right = "12px";
  header.style.bottom = "340px";
  header.style.width = panel.style.width;
  header.style.maxWidth = panel.style.maxWidth;
  header.style.display = "flex";
  header.style.gap = "8px";
  header.style.zIndex = "99999";

  const btnCopy = document.createElement("button");
  btnCopy.textContent = "Copy Logs";
  btnCopy.style.padding = "6px 10px";
  btnCopy.style.borderRadius = "8px";
  btnCopy.style.border = "1px solid rgba(255,255,255,0.2)";
  btnCopy.style.background = "rgba(255,255,255,0.08)";
  btnCopy.style.color = "white";
  btnCopy.onclick = async () => {
    try {
      await navigator.clipboard.writeText(panel.textContent || "");
      logI("ui", "Logs copied to clipboard");
    } catch (e) {
      logE("ui", "Failed to copy logs", e);
    }
  };

  const btnClear = document.createElement("button");
  btnClear.textContent = "Clear Logs";
  btnClear.style.padding = "6px 10px";
  btnClear.style.borderRadius = "8px";
  btnClear.style.border = "1px solid rgba(255,255,255,0.2)";
  btnClear.style.background = "rgba(255,255,255,0.08)";
  btnClear.style.color = "white";
  btnClear.onclick = () => {
    LOG_BUFFER.length = 0;
    panel.textContent = "";
    logI("ui", "Logs cleared");
  };

  const badge = document.createElement("div");
  badge.textContent = `debug=${DEBUG_LEVEL}`;
  badge.style.marginLeft = "auto";
  badge.style.padding = "6px 10px";
  badge.style.borderRadius = "999px";
  badge.style.border = "1px solid rgba(255,255,255,0.2)";
  badge.style.background = "rgba(255,255,255,0.08)";
  badge.style.color = "white";
  badge.style.fontSize = "12px";

  header.appendChild(btnCopy);
  header.appendChild(btnClear);
  header.appendChild(badge);

  document.body.appendChild(header);
  document.body.appendChild(panel);

  return panel;
}

const LOG_BUFFER = [];
const LOG_MAX = 1500;
const panel = ensureLogPanel();

function ts() {
  const d = new Date();
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function safeJson(v) {
  try {
    if (v instanceof Error) {
      return { name: v.name, message: v.message, stack: v.stack };
    }
    return JSON.parse(
      JSON.stringify(v, (k, val) => {
        if (typeof val === "bigint") return String(val);
        return val;
      })
    );
  } catch {
    return String(v);
  }
}

function pushLog(line) {
  LOG_BUFFER.push(line);
  if (LOG_BUFFER.length > LOG_MAX) LOG_BUFFER.splice(0, LOG_BUFFER.length - LOG_MAX);
  panel.textContent = LOG_BUFFER.join("\n");
  panel.scrollTop = panel.scrollHeight;
}

function logBase(level, tag, msg, data) {
  const line = `[${ts()}] ${level.padEnd(5)} ${tag.padEnd(10)} ${msg}${data !== undefined ? " " + JSON.stringify(safeJson(data)) : ""}`;
  // Console
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.log(line);

  // Panel
  pushLog(line);
}

function logI(tag, msg, data) { if (DEBUG_LEVEL >= 1) logBase("INFO", tag, msg, data); }
function logW(tag, msg, data) { if (DEBUG_LEVEL >= 1) logBase("WARN", tag, msg, data); }
function logE(tag, msg, data) { logBase("ERROR", tag, msg, data); }
function logD(tag, msg, data) { if (DEBUG_LEVEL >= 2) logBase("DEBUG", tag, msg, data); }

// ---------- global error hooks ----------
window.addEventListener("error", (e) => {
  logE("window", "Unhandled error", {
    message: e.message,
    filename: e.filename,
    lineno: e.lineno,
    colno: e.colno,
    error: e.error ? safeJson(e.error) : null,
  });
});

window.addEventListener("unhandledrejection", (e) => {
  logE("promise", "Unhandled rejection", safeJson(e.reason));
});

// ---------- diagnostics snapshot ----------
async function diagSnapshot(prefix = "diag") {
  const snap = {
    href: location.href,
    secureContext: window.isSecureContext,
    crossOriginIsolated: window.crossOriginIsolated,
    userAgent: navigator.userAgent,
    devicePixelRatio: window.devicePixelRatio,
    visibilityState: document.visibilityState,
    hasMediaDevices: !!navigator.mediaDevices,
    hasGetUserMedia: !!navigator.mediaDevices?.getUserMedia,
  };

  // Permissions API (best effort)
  try {
    const p = await navigator.permissions.query({ name: "camera" });
    snap.cameraPermission = p.state;
  } catch (e) {
    snap.cameraPermission = "unknown";
    snap.cameraPermissionErr = String(e?.message || e);
  }

  logI(prefix, "snapshot", snap);
}

// ---------- state ----------
let easySeeso = null;
let videoEl = null;
let mediaStream = null;

let lastGazeAt = 0;
let lastFaceAt = 0;
let lastCalProgAt = 0;

let lastCalProgress = null;
let lastCalPoint = null;

const state = {
  sdk: "not_loaded",
  perm: "unknown",
  track: "stopped",
  cal: "idle",
};

function setState(key, val) {
  state[key] = val;
  // keep your existing UI pill style if any
  if (key === "sdk") setPill(els.pillSdk, val);
  if (key === "perm") setPill(els.pillPerm, val);
  if (key === "track") setPill(els.pillTrack, val);
  if (key === "cal") setPill(els.pillCal, val);
}

function summarizeObjKeys(o) {
  if (!o || typeof o !== "object") return o;
  return {
    keys: Object.keys(o),
  };
}

function pick(o, keys) {
  if (!o || typeof o !== "object") return o;
  const out = {};
  for (const k of keys) if (k in o) out[k] = o[k];
  return out;
}

// throttle helper (avoid log spam)
function throttle(fn, ms) {
  let t = 0;
  return (...args) => {
    const now = performance.now();
    if (now - t >= ms) {
      t = now;
      fn(...args);
    }
  };
}

const logGazeThrottled = throttle((info) => {
  // We don't know exact gazeInfo schema; log a safe subset if exists.
  const subset = (info && typeof info === "object")
    ? { ...pick(info, ["x", "y", "confidence", "timestamp", "state", "trackingState"]), ...summarizeObjKeys(info) }
    : info;
  logD("gaze", "sample", subset);
}, 500);

const logFaceThrottled = throttle((info) => {
  const subset = (info && typeof info === "object")
    ? { ...pick(info, ["score", "yaw", "pitch", "roll", "faceDetected", "timestamp"]), ...summarizeObjKeys(info) }
    : info;
  logD("face", "sample", subset);
}, 800);

// ---------- video/camera ----------
async function ensureVideoAndCamera() {
  if (!videoEl) {
    videoEl = document.createElement("video");
    videoEl.setAttribute("playsinline", "true");
    videoEl.muted = true;
    videoEl.autoplay = true;
    videoEl.style.position = "fixed";
    videoEl.style.left = "-9999px";
    videoEl.style.top = "-9999px";
    videoEl.width = 320;
    videoEl.height = 240;
    document.body.appendChild(videoEl);
  }

  logI("perm", "requesting camera (getUserMedia)");
  try {
    mediaStream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
        frameRate: { ideal: 30, max: 60 },
      },
      audio: false,
    });

    setState("perm", "granted");
    videoEl.srcObject = mediaStream;

    await videoEl.play().catch((e) => {
      // Autoplay may be blocked; still continue because stream exists.
      logW("perm", "video.play() blocked; continuing", e?.message || e);
    });

    // Track settings
    const tracks = mediaStream.getVideoTracks();
    if (tracks && tracks[0]) {
      const s = tracks[0].getSettings ? tracks[0].getSettings() : null;
      const c = tracks[0].getConstraints ? tracks[0].getConstraints() : null;
      logI("camera", "track settings", s);
      logD("camera", "track constraints", c);
    } else {
      logW("camera", "no video tracks in stream");
    }

    logI("camera", "video ready", {
      videoWidth: videoEl.videoWidth,
      videoHeight: videoEl.videoHeight,
      readyState: videoEl.readyState,
    });

    return true;
  } catch (e) {
    setState("perm", "denied");
    logE("perm", "getUserMedia failed", e);
    return false;
  }
}

// ---------- SeeSo wiring (callbacks + logs) ----------
function attachSeesoCallbacks(es) {
  // gaze
  es.onGaze = (gazeInfo) => {
    lastGazeAt = performance.now();
    if (!gazeInfo) {
      logW("gaze", "gazeInfo is null/undefined");
      return;
    }
    logGazeThrottled(gazeInfo);
  };

  // face/debug (if SDK provides these)
  es.onFace = (faceInfo) => {
    lastFaceAt = performance.now();
    if (!faceInfo) return;
    logFaceThrottled(faceInfo);
  };

  es.onDebug = (debugInfo) => {
    // Usually verbose: keep at DEBUG_LEVEL>=2
    logD("sdkdbg", "debug", debugInfo ? summarizeObjKeys(debugInfo) : debugInfo);
  };

  // calibration callbacks
  es.onCalibrationNextPoint = (pt) => {
    lastCalPoint = pt;
    logI("cal", "onCalibrationNextPoint", pt);
  };

  // progress can be extremely frequent; log changes + occasional heartbeat
  const logCalProgressThrottled = throttle((progress) => {
    logD("cal", "onCalibrationProgress", { progress });
  }, 300);

  es.onCalibrationProgress = (progress) => {
    lastCalProgAt = performance.now();
    if (lastCalProgress !== progress) {
      lastCalProgress = progress;
      logI("cal", "progress changed", { progress, lastPoint: lastCalPoint });
    } else {
      // still log occasionally in verbose mode to prove callback is firing
      logCalProgressThrottled(progress);
    }
  };

  es.onCalibrationFinished = (result) => {
    logI("cal", "onCalibrationFinished", result ? summarizeObjKeys(result) : result);
    setState("cal", "finished");
  };

  // optional user status callbacks (best effort)
  es.onAttention = (v) => logD("status", "attention", v);
  es.onBlink = (v) => logD("status", "blink", v);
  es.onDrowsiness = (v) => logD("status", "drowsiness", v);
}

// ---------- main flow ----------
async function boot() {
  // COI indicator (your UI shows coi enabled/disabled)
  const coi = window.crossOriginIsolated ? "enabled" : "disabled";
  setPill(els.pillCoi, coi);

  setState("sdk", "loading");
  setState("track", "stopped");
  setState("cal", "idle");
  setState("perm", "unknown");

  await diagSnapshot("boot");

  if (!navigator.mediaDevices?.getUserMedia) {
    logE("boot", "navigator.mediaDevices.getUserMedia not available");
    return;
  }

  const camOk = await ensureVideoAndCamera();
  if (!camOk) return;

  // Load EasySeeso (webpack module wrapper)
  let EasySeesoClass = null;
  try {
    const mod = await loadWebpackModule("./seeso/easy-seeso.js");
    EasySeesoClass = mod?.default || mod?.EasySeeso || mod;
    logI("sdk", "easy-seeso module loaded", { exportedKeys: Object.keys(mod || {}) });
  } catch (e) {
    setState("sdk", "load_failed");
    logE("sdk", "Failed to load ./seeso/easy-seeso.js", e);
    return;
  }

  if (!EasySeesoClass) {
    setState("sdk", "bad_export");
    logE("sdk", "EasySeeso export not found. Check module export default.");
    return;
  }

  try {
    easySeeso = new EasySeesoClass();
    window.__seesoDebug = { easySeeso, state }; // for console inspection
    attachSeesoCallbacks(easySeeso);
  } catch (e) {
    setState("sdk", "construct_failed");
    logE("sdk", "Failed to construct EasySeeso", e);
    return;
  }

  // Init
  try {
    const userStatusOption = { useAttention: true, useBlink: true, useDrowsiness: true };
    logI("sdk", "initializing", { userStatusOption });

    await easySeeso.init(
      LICENSE_KEY,
      () => {
        setState("sdk", "initialized");
        logI("sdk", "initialized callback fired");
      },
      (errCode) => {
        setState("sdk", "init_failed");
        logE("sdk", "init failed callback fired", { errCode });
      },
      userStatusOption
    );

    // Some wrappers call callbacks but also return; log that we returned
    logI("sdk", "init() returned");
    if (state.sdk !== "initialized") {
      // if not set by callback, set here as a fallback
      setState("sdk", "initialized?");
      logW("sdk", "init() returned but sdk state not confirmed by callback");
    }
  } catch (e) {
    setState("sdk", "init_exception");
    logE("sdk", "Exception during init()", e);
    return;
  }

  wireButtons();
  // Optional: auto-start tracking/calibration if desired.
  // If you want immediate calibration: call startTrackingAndCalibration();
  logI("boot", "ready");
}

// ---------- tracking + calibration actions ----------
async function startTracking() {
  if (!easySeeso) {
    logW("track", "startTracking called but easySeeso is null");
    return false;
  }
  if (!videoEl) {
    logW("track", "startTracking called but videoEl is null");
    return false;
  }

  try {
    logI("track", "starting tracking", {
      videoWidth: videoEl.videoWidth,
      videoHeight: videoEl.videoHeight,
      readyState: videoEl.readyState,
    });

    // Different SDK wrappers vary; try common shapes safely.
    // 1) easySeeso.startTracking(video)
    // 2) easySeeso.startTracking()
    // 3) easySeeso.seeso.startTracking(video) etc.
    if (typeof easySeeso.startTracking === "function") {
      const r = await easySeeso.startTracking(videoEl);
      logI("track", "easySeeso.startTracking returned", r ? summarizeObjKeys(r) : r);
    } else if (easySeeso.seeso && typeof easySeeso.seeso.startTracking === "function") {
      const r = await easySeeso.seeso.startTracking(videoEl);
      logI("track", "seeso.startTracking returned", r ? summarizeObjKeys(r) : r);
    } else {
      logE("track", "No startTracking function found on easySeeso");
      return false;
    }

    setState("track", "running");
    return true;
  } catch (e) {
    setState("track", "failed");
    logE("track", "startTracking failed", e);
    return false;
  }
}

async function stopTracking() {
  if (!easySeeso) return;
  try {
    if (typeof easySeeso.stopTracking === "function") {
      await easySeeso.stopTracking();
    } else if (easySeeso.seeso && typeof easySeeso.seeso.stopTracking === "function") {
      await easySeeso.seeso.stopTracking();
    }
    setState("track", "stopped");
    logI("track", "stopped");
  } catch (e) {
    logE("track", "stopTracking failed", e);
  }
}

async function startCalibration(points) {
  if (!easySeeso) {
    logW("cal", "startCalibration called but easySeeso is null");
    return false;
  }

  const n = Number(points);
  const calN = Number.isFinite(n) && n > 0 ? n : 1;

  // reset calibration state logs
  lastCalProgress = null;
  lastCalPoint = null;
  lastCalProgAt = 0;

  try {
    setState("cal", "running");
    logI("cal", "starting calibration", { points: calN });

    // Different wrappers vary; try common shapes safely.
    // 1) easySeeso.startCalibration(points)
    // 2) easySeeso.seeso.startCalibration(points)
    // 3) easySeeso.calibrationStart(points) etc.
    if (typeof easySeeso.startCalibration === "function") {
      const r = await easySeeso.startCalibration(calN);
      logI("cal", "easySeeso.startCalibration returned", r ? summarizeObjKeys(r) : r);
    } else if (easySeeso.seeso && typeof easySeeso.seeso.startCalibration === "function") {
      const r = await easySeeso.seeso.startCalibration(calN);
      logI("cal", "seeso.startCalibration returned", r ? summarizeObjKeys(r) : r);
    } else {
      logE("cal", "No startCalibration function found on easySeeso");
      setState("cal", "failed");
      return false;
    }

    return true;
  } catch (e) {
    setState("cal", "failed");
    logE("cal", "startCalibration failed", e);
    return false;
  }
}

async function startTrackingAndCalibration() {
  const ok = await startTracking();
  if (!ok) return;
  const points = els.calPoints ? els.calPoints.value : 1;
  await startCalibration(points);
}

// ---------- buttons ----------
function wireButtons() {
  if (els.btnStart) {
    els.btnStart.onclick = async () => {
      logI("ui", "Start clicked");
      await startTracking();
    };
  }
  if (els.btnStop) {
    els.btnStop.onclick = async () => {
      logI("ui", "Stop clicked");
      await stopTracking();
    };
  }
  if (els.btnCal) {
    els.btnCal.onclick = async () => {
      logI("ui", "Calibrate clicked");
      if (state.track !== "running") {
        logW("ui", "tracking not running; starting tracking first");
        const ok = await startTracking();
        if (!ok) return;
      }
      const points = els.calPoints ? els.calPoints.value : 1;
      await startCalibration(points);
    };
  }
  if (els.btnClear) {
    els.btnClear.onclick = () => {
      logI("ui", "Clear clicked (canvas/logical)");
      // Your existing clear logic here (if any)
    };
  }

  logI("ui", "buttons wired", {
    hasStart: !!els.btnStart,
    hasStop: !!els.btnStop,
    hasCal: !!els.btnCal,
    hasClear: !!els.btnClear,
  });
}

// ---------- heartbeat: proves whether callbacks are firing ----------
setInterval(() => {
  const now = performance.now();
  const hb = {
    sdk: state.sdk,
    perm: state.perm,
    track: state.track,
    cal: state.cal,
    lastGazeMsAgo: lastGazeAt ? Math.round(now - lastGazeAt) : null,
    lastFaceMsAgo: lastFaceAt ? Math.round(now - lastFaceAt) : null,
    lastCalProgMsAgo: lastCalProgAt ? Math.round(now - lastCalProgAt) : null,
    lastCalProgress,
    lastCalPoint,
    visibilityState: document.visibilityState,
    video: videoEl ? { w: videoEl.videoWidth, h: videoEl.videoHeight, rs: videoEl.readyState } : null,
  };

  // INFO for key heartbeat only when calibration running, else DEBUG to reduce noise
  if (state.cal === "running") logI("hb", "calibration heartbeat", hb);
  else logD("hb", "heartbeat", hb);
}, 2000);

// ---------- visibility change ----------
document.addEventListener("visibilitychange", () => {
  logI("page", "visibilitychange", { visibilityState: document.visibilityState });
});

// Boot
boot().catch((e) => logE("boot", "boot() exception", e));


// ===== DEBUG STATE =====
const dbg = {
  lastGazeAt: 0,
  lastNextPointAt: 0,
  lastCollectAt: 0,
  lastCalProgressAt: 0,
  calProgressRaw: null,
  calRunning: false,
};

function dlog(...args) {
  // 콘솔 + (있으면) 화면 로그 모두 남기기
  const msg = `[${new Date().toISOString()}] ` + args.map(a => {
    try { return typeof a === "string" ? a : JSON.stringify(a); }
    catch { return String(a); }
  }).join(" ");
  console.log(msg);

  const pre = document.getElementById("debugLog"); // <pre id="debugLog"></pre> 있으면 사용
  if (pre) {
    pre.textContent = (pre.textContent + "\n" + msg).slice(-20000); // 최근 20KB만 유지
  }
}

// ===== CALIBRATION CALLBACKS (IMPORTANT) =====
function bindSeesoCallbacks(seeso, els) {
  // 1) Gaze callback: "진짜 gaze가 들어오는지" 확인 (calibration은 gaze 입력이 전제)
  seeso.addGazeCallback((gazeInfo) => {
    dbg.lastGazeAt = Date.now();
    // trackingState / x,y가 계속 갱신되는지 확인
    dlog("onGaze", {
      x: gazeInfo?.x,
      y: gazeInfo?.y,
      trackingState: gazeInfo?.trackingState,
      eyeMovementState: gazeInfo?.eyeMovementState,
    });
  });

  // 2) Calibration Next Point: 여기서 점을 그린 뒤 startCollectSamples()를 호출해야 진행률이 오름
  seeso.addCalibrationNextPointCallback((pointX, pointY) => {
    dbg.lastNextPointAt = Date.now();
    dlog("onCalibrationNextPoint", { pointX, pointY });

    // (예) 캔버스에 녹색 점 그리기
    const ctx = els.canvas.getContext("2d");
    ctx.clearRect(0, 0, els.canvas.width, els.canvas.height);
    ctx.beginPath();
    ctx.arc(pointX, pointY, 14, 0, Math.PI * 2);
    ctx.fillStyle = "#00ff3b";
    ctx.fill();

    // 점이 "화면에 렌더된 다음" 샘플 수집 시작 (0% 고정 해결 핵심)
    requestAnimationFrame(() => {
      setTimeout(() => {
        dbg.lastCollectAt = Date.now();
        let ret;
        try {
          ret = seeso.startCollectSamples(); // ★★★ 필수 ★★★
        } catch (e) {
          dlog("startCollectSamples() EXCEPTION", String(e));
          return;
        }
        dlog("startCollectSamples() CALLED", { returnValue: ret });
      }, 80);
    });
  });

  // 3) Calibration progress: 값이 오는지/형태(0~1인지)를 로그로 확인
  seeso.addCalibrationProgressCallback((progress) => {
    dbg.lastCalProgressAt = Date.now();
    dbg.calProgressRaw = progress;

    const pct = (typeof progress === "number")
      ? Math.round(progress * 100)
      : NaN;

    dlog("onCalibrationProgress", { progress, pct });

    // 화면 문구 갱신 (사용자가 0%만 보지 않도록)
    const calTextEl = document.getElementById("calText"); // 있으면 사용
    if (calTextEl && Number.isFinite(pct)) {
      calTextEl.textContent = `Calibrating... ${pct}% (keep your head steady, look at the green dot)`;
    }
  });

  // 4) Calibration finished: 완료 여부/데이터 길이 등 확인
  seeso.addCalibrationFinishCallback((calibrationData) => {
    dbg.calRunning = false;
    dlog("onCalibrationFinished", {
      type: typeof calibrationData,
      length: calibrationData?.length,
      preview: (typeof calibrationData === "string")
        ? calibrationData.slice(0, 60) + "..."
        : null
    });
  });

  // 5) SDK debug callback(있으면): 성능/내부 상태 힌트
  seeso.addDebugCallback((info) => {
    dlog("onDebug", info);
  });

  // 6) Watchdog: "cal: running인데 이벤트가 안 오는 상황"을 1초마다 경고
  setInterval(() => {
    if (!dbg.calRunning) return;

    const now = Date.now();
    const gazeAgo = dbg.lastGazeAt ? (now - dbg.lastGazeAt) : null;
    const nextPointAgo = dbg.lastNextPointAt ? (now - dbg.lastNextPointAt) : null;
    const collectAgo = dbg.lastCollectAt ? (now - dbg.lastCollectAt) : null;
    const progAgo = dbg.lastCalProgressAt ? (now - dbg.lastCalProgressAt) : null;

    // 진행률 이벤트가 2초 이상 안 오면 원인 추적 메시지
    if (!dbg.lastCalProgressAt || progAgo > 2000) {
      dlog("WATCHDOG: cal running but no progress event", {
        gazeAgoMs: gazeAgo,
        nextPointAgoMs: nextPointAgo,
        collectAgoMs: collectAgo,
        lastProgressAgoMs: progAgo,
        hint: "If nextPoint fires but progress stays 0%, ensure startCollectSamples() is called inside onCalibrationNextPoint."
      });
    }
  }, 1000);
}

// ===== when you start calibration =====
function startCalibrationFlow(seeso, points, criteria) {
  dbg.calRunning = true;
  dbg.lastNextPointAt = 0;
  dbg.lastCollectAt = 0;
  dbg.lastCalProgressAt = 0;
  dbg.calProgressRaw = null;

  dlog("startCalibration() REQUEST", { points, criteria });

  let ok = false;
  try {
    ok = seeso.startCalibration(points, criteria);
  } catch (e) {
    dlog("startCalibration() EXCEPTION", String(e));
    dbg.calRunning = false;
    return;
  }
  dlog("startCalibration() RETURN", { ok });

  if (!ok) {
    dbg.calRunning = false;
    dlog("Calibration did not start (startCalibration returned false)");
  }
}

