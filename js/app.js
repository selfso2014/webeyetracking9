// js/app.js
import { loadWebpackModule } from "./webpack-loader.js";

/**
 * IMPORTANT
 * - 로컬(127.0.0.1/localhost)에서는 dev_ 키로 동작 가능
 * - GitHub Pages(배포)에서는 dev_ 키 사용 시 errCode=4로 차단될 수 있음(라이선스 정책)
 */
const LICENSE_KEY = "dev_1ntzip9admm6g0upynw3gooycnecx0vl93hz8nox";

const els = {
  calPoints: document.getElementById("calPoints"),
  btnStart: document.getElementById("btnStart"),
  btnStop: document.getElementById("btnStop"),
  btnCal: document.getElementById("btnCal"),
  btnClear: document.getElementById("btnClear"),
  pillCoi: document.getElementById("pillCoi"),
  pillSdk: document.getElementById("pillSdk"),
  pillTrack: document.getElementById("pillTrack"),
  pillPerm: document.getElementById("pillPerm"),
  canvas: document.getElementById("output"),
};

function setPill(el, text) {
  if (!el) return;
  el.textContent = text;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function ensureMessageEl() {
  let el =
    document.getElementById("statusText") ||
    document.getElementById("status") ||
    document.getElementById("message");
  if (el) return el;

  // 없으면 상단에 간단히 하나 생성
  el = document.createElement("div");
  el.id = "statusText";
  el.style.cssText = [
    "position:fixed",
    "left:12px",
    "top:12px",
    "z-index:99999",
    "padding:10px 12px",
    "border-radius:10px",
    "background:rgba(0,0,0,0.65)",
    "color:#fff",
    "font:14px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif",
    "max-width:min(680px, calc(100vw - 24px))",
    "white-space:pre-wrap",
  ].join(";");
  document.body.appendChild(el);
  return el;
}

const msgEl = ensureMessageEl();
function setMessage(text) {
  if (!msgEl) return;
  msgEl.textContent = text;
}

function createDot(id, sizePx = 14) {
  let dot = document.getElementById(id);
  if (dot) return dot;

  dot = document.createElement("div");
  dot.id = id;
  dot.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:-9999px",
    `width:${sizePx}px`,
    `height:${sizePx}px`,
    "border-radius:999px",
    "transform:translate(-50%,-50%)",
    "pointer-events:none",
    "z-index:99998",
    // 녹색점 + 외곽선
    "background:rgba(0,255,0,0.95)",
    "box-shadow:0 0 0 2px rgba(0,0,0,0.55), 0 0 14px rgba(0,255,0,0.55)",
    "display:none",
  ].join(";");
  document.body.appendChild(dot);
  return dot;
}

const gazeDot = createDot("gazeDot", 14);
const calDot = createDot("calDot", 18);

function showDot(dot, x, y) {
  const px = clamp(x, 0, window.innerWidth);
  const py = clamp(y, 0, window.innerHeight);
  dot.style.left = `${px}px`;
  dot.style.top = `${py}px`;
  dot.style.display = "block";
}
function hideDot(dot) {
  dot.style.display = "none";
  dot.style.left = "-9999px";
  dot.style.top = "-9999px";
}

let EasySeeso = null;
let SeesoEnums = null;

let easy = null;
let cameraStream = null;

let started = false;
let trackingStateLast = null;
let trackingReadyResolver = null;

let calibrating = false;
let lastCalProgress = 0;
let collectTimer = null;
let collectRetryTimer = null;

function isLocalHost() {
  const h = location.hostname;
  return h === "localhost" || h === "127.0.0.1";
}

function updateCOIStatus() {
  setPill(els.pillCoi, window.crossOriginIsolated ? "enabled" : "disabled");
}

async function requestCameraPermission() {
  // permission 먼저 받기(요구사항)
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({ video: true });
    setPill(els.pillPerm, "granted");
    return cameraStream;
  } catch (e) {
    setPill(els.pillPerm, "denied");
    throw e;
  }
}

function stopCameraStream() {
  if (!cameraStream) return;
  try {
    cameraStream.getTracks().forEach((t) => t.stop());
  } catch (_) {}
  cameraStream = null;
}

function cleanup() {
  try {
    if (easy) {
      try {
        easy.stopCalibration?.();
      } catch (_) {}
      try {
        easy.stopTracking?.();
      } catch (_) {}
      try {
        easy.deinit?.();
      } catch (_) {}
    }
  } catch (_) {}

  stopCameraStream();

  clearTimeout(collectTimer);
  clearTimeout(collectRetryTimer);
  collectTimer = null;
  collectRetryTimer = null;

  hideDot(gazeDot);
  hideDot(calDot);

  setPill(els.pillTrack, "-");
  setPill(els.pillSdk, "-");
}

function waitForTrackingSuccess(timeoutMs = 8000) {
  // 이미 성공한 상태면 즉시 resolve
  if (trackingStateLast === SeesoEnums?.TrackingState?.SUCCESS) return Promise.resolve();

  return new Promise((resolve, reject) => {
    const t0 = Date.now();
    trackingReadyResolver = () => resolve();

    const timer = setInterval(() => {
      const elapsed = Date.now() - t0;
      if (trackingStateLast === SeesoEnums?.TrackingState?.SUCCESS) {
        clearInterval(timer);
        trackingReadyResolver = null;
        resolve();
      } else if (elapsed > timeoutMs) {
        clearInterval(timer);
        trackingReadyResolver = null;
        reject(new Error("Tracking not ready (face missing or low confidence)."));
      }
    }, 120);
  });
}

function normalizeProgress(p) {
  // SDK가 number(0~1) 또는 object를 줄 수 있으므로 방어적으로 처리
  if (typeof p === "number") return p;
  if (p && typeof p === "object") {
    if (typeof p.progress === "number") return p.progress;
    if (typeof p.ratio === "number") return p.ratio;
    if (typeof p.value === "number") return p.value;
  }
  return 0;
}

function scheduleCollectSamples() {
  // 핵심: NextPoint를 받은 뒤 "점이 화면에 그려진 다음" 1회 호출
  clearTimeout(collectTimer);
  collectTimer = setTimeout(() => {
    try {
      easy.startCollectSamples();
    } catch (e) {
      console.error("startCollectSamples() failed:", e);
    }
  }, 200);

  // 만약 0%가 오래 지속되면(사용자가 점을 보고 있는데 샘플수집 타이밍이 엇갈린 경우),
  // 제한적으로 몇 번만 재시도
  clearTimeout(collectRetryTimer);
  collectRetryTimer = setTimeout(() => {
    if (!calibrating) return;
    if (lastCalProgress > 0) return;
    try {
      easy.startCollectSamples();
    } catch (_) {}
  }, 1800);
}

async function loadSDK() {
  // EasySeeso (wrapper)
  const easyMod = await loadWebpackModule("./seeso/easy-seeso.js");
  EasySeeso = easyMod?.default || easyMod;

  // Enums (TrackingState, InitializationErrorType, etc.)
  const seesoMod = await loadWebpackModule("./seeso/dist/seeso.js");
  SeesoEnums = seesoMod || {};

  if (!EasySeeso) throw new Error("Failed to load EasySeeso module.");
  if (!SeesoEnums?.TrackingState) throw new Error("Failed to load Seeso enums.");
}

async function initSDK() {
  // 라이선스 경고(배포에서 dev 키 사용 시 errCode=4 가능)
  if (!isLocalHost() && String(LICENSE_KEY).startsWith("dev_")) {
    setMessage(
      "Warning: dev_ license key on a non-localhost origin may fail (errCode=4)."
    );
  }

  easy = new EasySeeso();

  setPill(els.pillSdk, "initializing...");

  // EasySeeso.init은 콜백 기반이므로 Promise로 래핑
  await new Promise((resolve, reject) => {
    const afterInitialized = () => resolve();
    const afterFailed = () =>
      reject(new Error("SDK initialization failed (see errCode in UI/console)."));

    // userStatusOption은 생략(undefined)해도 되지만 명시적으로 null 전달
    easy.init(LICENSE_KEY, afterInitialized, afterFailed, null);
  });

  setPill(els.pillSdk, "initialized");
}

function handleGaze(gazeInfo) {
  // gazeInfo: { x, y, trackingState, ... }
  const x = Number(gazeInfo?.x ?? gazeInfo?.screenX ?? 0);
  const y = Number(gazeInfo?.y ?? gazeInfo?.screenY ?? 0);
  const ts = gazeInfo?.trackingState;

  trackingStateLast = ts;

  // tracking 상태 표시
  if (ts === SeesoEnums.TrackingState.SUCCESS) {
    setPill(els.pillTrack, calibrating ? "running (cal)" : "running");
    showDot(gazeDot, x, y);

    if (typeof trackingReadyResolver === "function") {
      const r = trackingReadyResolver;
      trackingReadyResolver = null;
      r();
    }
  } else if (ts === SeesoEnums.TrackingState.FACE_MISSING) {
    setPill(els.pillTrack, "face missing");
    hideDot(gazeDot);
  } else if (ts === SeesoEnums.TrackingState.LOW_CONFIDENCE) {
    setPill(els.pillTrack, "low confidence");
    // 점은 보여줄 수도 있지만 혼란 방지를 위해 숨김
    hideDot(gazeDot);
  } else {
    setPill(els.pillTrack, "unsupported");
    hideDot(gazeDot);
  }
}

function handleDebug(debugInfo) {
  // 필요하면 콘솔에서 확인
  // console.log("debug:", debugInfo);
}

async function startTrackingWithExistingStream() {
  if (!cameraStream) throw new Error("Camera stream not ready.");

  // EasySeeso.startTracking()은 내부에서 getUserMedia를 다시 호출하므로,
  // "권한 먼저 받고" 요구사항을 지키기 위해 low-level로 직접 startTracking(stream) 사용
  easy.onGaze = handleGaze;
  easy.onDebug = handleDebug;

  try {
    easy.seeso.addDebugCallback(handleDebug);
  } catch (_) {}

  const ok = easy.seeso.startTracking(cameraStream);
  if (!ok) {
    try {
      easy.seeso.removeDebugCallback(handleDebug);
    } catch (_) {}
    throw new Error("Failed to start tracking.");
  }

  setPill(els.pillTrack, "starting...");
}

async function startOnePointCalibrationAuto() {
  if (calibrating) return;

  // tracking이 실제로 성공 프레임을 내보낸 뒤 calibration 시작(중요)
  await waitForTrackingSuccess(8000);

  setPill(els.pillTrack, "running");
  setPill(els.pillSdk, "initialized");

  // 1점 캘리브레이션
  if (els.calPoints) els.calPoints.textContent = "1";

  calibrating = true;
  lastCalProgress = 0;
  setPill(els.pillTrack, "running (cal)");
  setMessage("Calibrating... 0% (keep your head steady, look at the green dot)");
  setPill(els.pillSdk, "initialized");

  const onNextPoint = (x, y) => {
    // SDK가 준 좌표에 정확히 점을 찍어야 progress가 정상적으로 올라갑니다.
    showDot(calDot, Number(x), Number(y));

    // 핵심: NextPoint 이후 1회 샘플 수집 시작
    scheduleCollectSamples();
  };

  const onProgress = (pRaw) => {
    const p = normalizeProgress(pRaw);
    lastCalProgress = Math.max(lastCalProgress, p);

    // progress는 0.0~1.0 이므로 *100
    const pct = clamp(Math.round(p * 100), 0, 100);
    setMessage(
      `Calibrating... ${pct}% (keep your head steady, look at the green dot)`
    );
  };

  const onFinished = (calibrationData) => {
    calibrating = false;
    hideDot(calDot);

    setMessage("Calibration finished. Tracking is running.");
    setPill(els.pillTrack, "running");
    setPill(els.pillSdk, "initialized");
    // calibrationData 필요 시 저장/업로드 로직 추가 가능
    // console.log("calibrationData:", calibrationData);
  };

  const started = easy.startCalibration(onNextPoint, onProgress, onFinished, 1);
  if (!started) {
    calibrating = false;
    hideDot(calDot);
    throw new Error("Calibration did not start (startCalibration returned false).");
  }

  // cal 상태를 표시하는 엘리먼트가 따로 있으면 거기에 연결해도 됨
}

async function bootstrap() {
  if (started) return;
  started = true;

  updateCOIStatus();
  setPill(els.pillPerm, "-");
  setPill(els.pillSdk, "-");
  setPill(els.pillTrack, "-");

  // 버튼이 있으면 수동 제어도 가능하게 연결(자동 흐름은 유지)
  if (els.btnStart) {
    els.btnStart.addEventListener("click", async () => {
      try {
        await startFlow();
      } catch (e) {
        setMessage(String(e?.message || e));
      }
    });
  }
  if (els.btnCal) {
    els.btnCal.addEventListener("click", async () => {
      try {
        await startOnePointCalibrationAuto();
      } catch (e) {
        setMessage(String(e?.message || e));
      }
    });
  }
  if (els.btnStop) {
    els.btnStop.addEventListener("click", () => {
      cleanup();
      setMessage("Stopped.");
    });
  }
  if (els.btnClear) {
    els.btnClear.addEventListener("click", () => {
      hideDot(gazeDot);
      hideDot(calDot);
      setMessage("Cleared dots.");
    });
  }

  // 자동 시작(요구사항)
  try {
    await startFlow();
  } catch (e) {
    console.error(e);
    setMessage(String(e?.message || e));
  }
}

async function startFlow() {
  cleanup(); // 재시작 시 안전
  updateCOIStatus();

  setMessage("Requesting camera permission...");
  await loadSDK();

  // 1) permission 먼저
  await requestCameraPermission();

  // 2) init
  setMessage("Initializing SDK...");
  await initSDK();

  // 3) tracking (permission 받은 stream으로 바로 시작)
  setMessage("Starting tracking...");
  await startTrackingWithExistingStream();

  // 4) 1점 캘리브레이션 자동
  setMessage("Preparing calibration...");
  await startOnePointCalibrationAuto();
}

// 반응형(점 표시용)
window.addEventListener("resize", () => {
  // dot 위치는 fixed 기반이라 별도 처리 없음
});

// 종료 시 정리
window.addEventListener("beforeunload", () => cleanup());

// 시작
document.addEventListener("DOMContentLoaded", () => {
  bootstrap();
});
