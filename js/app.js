// js/app.js
import { loadWebpackModule } from "./webpack-loader.js";

const LICENSE_KEY = "dev_1ntzip9admm6g0upynw3gooycnecx0vl93hz8nox";

const els = {
  preview: document.getElementById("preview"),
  canvas: document.getElementById("output"),
  status: document.getElementById("status"),
  pillCoi: document.getElementById("pillCoi"),
  pillPerm: document.getElementById("pillPerm"),
  pillSdk: document.getElementById("pillSdk"),
  pillTrack: document.getElementById("pillTrack"),
  pillCal: document.getElementById("pillCal"),
  btnRetry: document.getElementById("btnRetry"),
};

function setStatus(text) {
  if (els.status) els.status.textContent = text;
}

function setPill(el, label, value) {
  if (!el) return;
  el.textContent = `${label}: ${value}`;
}

function clamp(v, min, max) {
  return Math.min(Math.max(v, min), max);
}

function createDot(id, sizePx, colorCss, glowCss) {
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
    "z-index:99999",
    `background:${colorCss}`,
    `box-shadow:${glowCss}`,
    "display:none",
  ].join(";");
  document.body.appendChild(dot);
  return dot;
}

// 녹색 시선점
const gazeDot = createDot(
  "gazeDot",
  14,
  "rgba(0,255,0,0.95)",
  "0 0 0 2px rgba(0,0,0,0.55), 0 0 14px rgba(0,255,0,0.55)"
);

// 캘리브레이션 점(조금 더 크게)
const calDot = createDot(
  "calDot",
  20,
  "rgba(0,255,0,0.98)",
  "0 0 0 2px rgba(0,0,0,0.75), 0 0 18px rgba(0,255,0,0.65)"
);

function showDot(dot, x, y) {
  const px = clamp(Number(x) || 0, 0, window.innerWidth);
  const py = clamp(Number(y) || 0, 0, window.innerHeight);
  dot.style.left = `${px}px`;
  dot.style.top = `${py}px`;
  dot.style.display = "block";
}

function hideDot(dot) {
  dot.style.display = "none";
  dot.style.left = "-9999px";
  dot.style.top = "-9999px";
}

let Seeso = null;
let InitializationErrorType = null;
let TrackingState = null;
let CalibrationAccuracyCriteria = null;
let UserStatusOption = null;

let seeso = null;
let stream = null;

let trackingStateLast = null;
let trackingReadyResolve = null;

let calibrating = false;
let lastCalProgress = 0;
let collectTimer = null;
let collectRetryTimer = null;

function updateCoi() {
  setPill(els.pillCoi, "coi", window.crossOriginIsolated ? "enabled" : "disabled");
}

async function requestCamera() {
  setStatus("Requesting camera permission...");
  setPill(els.pillPerm, "perm", "requesting");

  // 권한 먼저 확보
  stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

  setPill(els.pillPerm, "perm", "granted");

  // 프리뷰 표시
  if (els.preview) {
    els.preview.srcObject = stream;
    els.preview.muted = true;
    els.preview.playsInline = true;
    try {
      await els.preview.play();
    } catch (_) {
      // 자동재생 정책으로 play가 실패해도 tracking에는 영향 없음
    }
  }

  return stream;
}

async function loadSeeso() {
  setStatus("Loading SDK module...");
  // 중요: app.js는 /js/에 있으므로 ../seeso/... 로 올라가야 함
  const mod = await loadWebpackModule("../seeso/dist/seeso.js");

  Seeso = mod.default;
  InitializationErrorType = mod.InitializationErrorType;
  TrackingState = mod.TrackingState;
  CalibrationAccuracyCriteria = mod.CalibrationAccuracyCriteria;
  UserStatusOption = mod.UserStatusOption;

  if (!Seeso || !InitializationErrorType || !TrackingState || !CalibrationAccuracyCriteria || !UserStatusOption) {
    throw new Error("SDK module loaded but exports are missing.");
  }
}

async function initSdk() {
  setStatus("Initializing SDK...");
  setPill(els.pillSdk, "sdk", "initializing");

  seeso = new Seeso();

  // userStatus는 끄는 값(0,0,0)로 전달 (불필요 기능 off)
  const userStatus = new UserStatusOption(0, 0, 0);

  const errCode = await seeso.initialize(LICENSE_KEY, userStatus);

  if (errCode !== InitializationErrorType.ERROR_NONE) {
    // errCode=4는 dev키를 공개 도메인에서 사용했을 때(배포)
    throw new Error(`SDK initialization failed (errCode=${errCode})`);
  }

  setPill(els.pillSdk, "sdk", "initialized");
}

function waitForTrackingSuccess(timeoutMs = 8000) {
  if (trackingStateLast === TrackingState.SUCCESS) return Promise.resolve();

  return new Promise((resolve, reject) => {
    trackingReadyResolve = resolve;
    const t0 = Date.now();
    const timer = setInterval(() => {
      if (trackingStateLast === TrackingState.SUCCESS) {
        clearInterval(timer);
        trackingReadyResolve = null;
        resolve();
        return;
      }
      if (Date.now() - t0 > timeoutMs) {
        clearInterval(timer);
        trackingReadyResolve = null;
        reject(new Error("Tracking not ready (face missing / low confidence)."));
      }
    }, 120);
  });
}

function startTracking() {
  setStatus("Starting tracking...");
  setPill(els.pillTrack, "track", "starting");

  // gaze callback
  seeso.addGazeCallback((gazeInfo) => {
    const x = gazeInfo?.x;
    const y = gazeInfo?.y;
    const ts = gazeInfo?.trackingState;

    trackingStateLast = ts;

    if (ts === TrackingState.SUCCESS) {
      setPill(els.pillTrack, "track", "running");
      showDot(gazeDot, x, y);

      if (typeof trackingReadyResolve === "function") {
        const r = trackingReadyResolve;
        trackingReadyResolve = null;
        r();
      }
    } else if (ts === TrackingState.FACE_MISSING) {
      setPill(els.pillTrack, "track", "face missing");
      hideDot(gazeDot);
    } else if (ts === TrackingState.LOW_CONFIDENCE) {
      setPill(els.pillTrack, "track", "low confidence");
      hideDot(gazeDot);
    } else {
      setPill(els.pillTrack, "track", "unknown");
      hideDot(gazeDot);
    }
  });

  const ok = seeso.startTracking(stream);
  if (!ok) throw new Error("Failed to start tracking.");

  setPill(els.pillTrack, "track", "running");
}

function normalizeProgress(p) {
  if (typeof p === "number") return p;
  if (p && typeof p === "object") {
    if (typeof p.progress === "number") return p.progress;
    if (typeof p.ratio === "number") return p.ratio;
    if (typeof p.value === "number") return p.value;
  }
  return 0;
}

function scheduleCollectSamples() {
  // 핵심: NextPoint 받은 뒤, 점이 표시된 다음 1회 호출해야 progress가 올라감
  clearTimeout(collectTimer);
  collectTimer = setTimeout(() => {
    try {
      seeso.startCollectSamples();
    } catch (e) {
      console.error("startCollectSamples failed:", e);
    }
  }, 200);

  // 안전장치: 0%가 오래 지속되면(타이밍 미스), 제한적으로 1회 재호출
  clearTimeout(collectRetryTimer);
  collectRetryTimer = setTimeout(() => {
    if (!calibrating) return;
    if (lastCalProgress > 0) return;
    try {
      seeso.startCollectSamples();
    } catch (_) {}
  }, 1800);
}

async function startOnePointCalibrationAuto() {
  if (calibrating) return;

  setStatus("Waiting for stable tracking before calibration...");
  await waitForTrackingSuccess(8000);

  calibrating = true;
  lastCalProgress = 0;

  setPill(els.pillCal, "cal", "running");
  setStatus("Calibrating... 0% (keep your head steady, look at the green dot)");

  // 콜백 등록
  const onNextPoint = (x, y) => {
    // SDK가 준 좌표 그대로 사용해야 함(중요)
    showDot(calDot, x, y);
    scheduleCollectSamples();
  };

  const onProgress = (pRaw) => {
    const p = normalizeProgress(pRaw);
    lastCalProgress = Math.max(lastCalProgress, p);
    const pct = clamp(Math.round(p * 100), 0, 100);
    setStatus(`Calibrating... ${pct}% (keep your head steady, look at the green dot)`);
  };

  const onFinish = (calibrationData) => {
    calibrating = false;
    hideDot(calDot);
    setPill(els.pillCal, "cal", "done");
    setStatus("Calibration finished. Tracking is running.");
    // 필요하면 calibrationData 저장 가능
    // console.log("calibrationData:", calibrationData);
  };

  // 중복 등록 방지(재시작 대비)
  try {
    seeso.removeCalibrationNextPointCallback(onNextPoint);
    seeso.removeCalibrationProgressCallback(onProgress);
    seeso.removeCalibrationFinishCallback(onFinish);
  } catch (_) {}

  seeso.addCalibrationNextPointCallback(onNextPoint);
  seeso.addCalibrationProgressCallback(onProgress);
  seeso.addCalibrationFinishCallback(onFinish);

  // 1점 + 기본 정확도
  const ok = seeso.startCalibration(1, CalibrationAccuracyCriteria.DEFAULT);
  if (!ok) {
    calibrating = false;
    hideDot(calDot);
    setPill(els.pillCal, "cal", "-");
    throw new Error("Calibration did not start (startCalibration returned false).");
  }
}

function cleanup() {
  clearTimeout(collectTimer);
  clearTimeout(collectRetryTimer);
  collectTimer = null;
  collectRetryTimer = null;

  hideDot(gazeDot);
  hideDot(calDot);

  try {
    if (seeso) {
      try { seeso.stopCalibration(); } catch (_) {}
      try { seeso.stopTracking(); } catch (_) {}
    }
  } catch (_) {}

  try {
    if (stream) stream.getTracks().forEach((t) => t.stop());
  } catch (_) {}
  stream = null;

  setPill(els.pillTrack, "track", "-");
  setPill(els.pillCal, "cal", "-");
}

async function main() {
  updateCoi();
  setPill(els.pillPerm, "perm", "-");
  setPill(els.pillSdk, "sdk", "-");
  setPill(els.pillTrack, "track", "-");
  setPill(els.pillCal, "cal", "-");

  if (els.btnRetry) {
    els.btnRetry.addEventListener("click", () => location.reload());
  }

  try {
    await requestCamera();
    await loadSeeso();
    await initSdk();
    startTracking();
    await startOnePointCalibrationAuto();
  } catch (e) {
    console.error(e);
    setStatus(`Error: ${e?.message || e}`);
    setPill(els.pillCal, "cal", "-");
  }
}

window.addEventListener("beforeunload", () => cleanup());
document.addEventListener("DOMContentLoaded", () => main());
