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

function createDot(id, sizePx, cssText) {
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
    "display:none",
    cssText,
  ].join(";");
  document.body.appendChild(dot);
  return dot;
}

// 시선점(움직이는 점) - 녹색 (요구사항)
const gazeDot = createDot(
  "gazeDot",
  14,
  [
    "background:rgba(0,255,0,0.95)",
    "box-shadow:0 0 0 2px rgba(0,0,0,0.55), 0 0 14px rgba(0,255,0,0.55)",
  ].join(";")
);

// 캘리브레이션 타겟(고정점) - 녹색이지만 더 크고 “링 + 크로스헤어”로 구분
const calTarget = createDot(
  "calTarget",
  34,
  [
    "background:transparent",
    "box-shadow:0 0 0 3px rgba(0,255,0,0.95), 0 0 20px rgba(0,255,0,0.45)",
  ].join(";")
);

// 캘리브레이션 타겟 내부 크로스헤어
(function ensureCrosshair() {
  const crossId = "calTargetCross";
  let cross = document.getElementById(crossId);
  if (cross) return;

  cross = document.createElement("div");
  cross.id = crossId;
  cross.style.cssText = [
    "position:fixed",
    "left:-9999px",
    "top:-9999px",
    "width:34px",
    "height:34px",
    "transform:translate(-50%,-50%)",
    "pointer-events:none",
    "z-index:100000",
    "display:none",
    "background:",
    "linear-gradient(transparent 48%, rgba(0,255,0,0.95) 48%, rgba(0,255,0,0.95) 52%, transparent 52%),",
    "linear-gradient(90deg, transparent 48%, rgba(0,255,0,0.95) 48%, rgba(0,255,0,0.95) 52%, transparent 52%)",
  ].join(";");
  document.body.appendChild(cross);
})();

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

function showCross(x, y) {
  const cross = document.getElementById("calTargetCross");
  if (!cross) return;
  showDot(cross, x, y);
}
function hideCross() {
  const cross = document.getElementById("calTargetCross");
  if (!cross) return;
  hideDot(cross);
}

let Seeso = null;
let InitializationErrorType = null;
let TrackingState = null;
let CalibrationAccuracyCriteria = null;
let UserStatusOption = null;

let seeso = null;
let stream = null;

let calibrating = false;
let lastCalProgress = 0;
let nextPointSeen = false;
let calRestartedOnce = false;

let trackingStateLast = null;
let stableSuccessSince = null;

// calibration timers
let collectTimer = null;
let progressWatchTimer = null;
let noNextPointTimer = null;

function updateCoi() {
  setPill(els.pillCoi, "coi", window.crossOriginIsolated ? "enabled" : "disabled");
}

async function requestCamera() {
  setStatus("Requesting camera permission...");
  setPill(els.pillPerm, "perm", "requesting");

  stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });

  setPill(els.pillPerm, "perm", "granted");

  if (els.preview) {
    els.preview.srcObject = stream;
    els.preview.muted = true;
    els.preview.playsInline = true;
    try {
      await els.preview.play();
    } catch (_) {}
  }

  return stream;
}

async function loadSeeso() {
  setStatus("Loading SDK module...");

  // app.js는 /js/에 있으므로 ../seeso/... 로 올라가야 합니다.
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

  // userStatus 옵션은 모두 off (필요시 조정)
  const userStatus = new UserStatusOption(0, 0, 0);

  const errCode = await seeso.initialize(LICENSE_KEY, userStatus);

  if (errCode !== InitializationErrorType.ERROR_NONE) {
    throw new Error(`SDK initialization failed (errCode=${errCode})`);
  }

  setPill(els.pillSdk, "sdk", "initialized");
}

function startTracking() {
  setStatus("Starting tracking...");
  setPill(els.pillTrack, "track", "starting");

  seeso.addGazeCallback((gazeInfo) => {
    const x = gazeInfo?.x;
    const y = gazeInfo?.y;
    const ts = gazeInfo?.trackingState;

    trackingStateLast = ts;

    if (ts === TrackingState.SUCCESS) {
      // 안정 SUCCESS 시작 시각 기록
      if (stableSuccessSince == null) stableSuccessSince = Date.now();

      setPill(els.pillTrack, "track", calibrating ? "running (cal)" : "running");

      // 캘리브레이션 중에는 시선점을 숨겨서 “타겟 점”만 보게 함
      if (!calibrating) {
        showDot(gazeDot, x, y);
      } else {
        hideDot(gazeDot);
      }
    } else {
      stableSuccessSince = null;
      if (ts === TrackingState.FACE_MISSING) setPill(els.pillTrack, "track", "face missing");
      else if (ts === TrackingState.LOW_CONFIDENCE) setPill(els.pillTrack, "track", "low confidence");
      else setPill(els.pillTrack, "track", "unknown");

      hideDot(gazeDot);
    }
  });

  const ok = seeso.startTracking(stream);
  if (!ok) throw new Error("Failed to start tracking.");

  setPill(els.pillTrack, "track", "running");
}

async function waitForTrackingStable(requiredMs = 800, timeoutMs = 10000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (trackingStateLast === TrackingState.SUCCESS && stableSuccessSince != null) {
      if (Date.now() - stableSuccessSince >= requiredMs) return;
    }
    await new Promise((r) => setTimeout(r, 80));
  }
  throw new Error("Tracking not stable enough for calibration (face missing / low confidence).");
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

function clearCalTimers() {
  clearTimeout(collectTimer);
  clearInterval(progressWatchTimer);
  clearTimeout(noNextPointTimer);
  collectTimer = null;
  progressWatchTimer = null;
  noNextPointTimer = null;
}

function startCollectSamplesSafely() {
  // UI 렌더 이후 호출(권장 패턴)
  clearTimeout(collectTimer);
  collectTimer = setTimeout(() => {
    try {
      seeso.startCollectSamples();
    } catch (e) {
      console.error("startCollectSamples failed:", e);
    }
  }, 450);
}

function stopCalibrationQuiet() {
  try {
    seeso.stopCalibration();
  } catch (_) {}
}

async function startOnePointCalibrationAuto() {
  if (calibrating) return;

  setPill(els.pillCal, "cal", "preparing");
  setStatus("Waiting for stable tracking before calibration...");
  await waitForTrackingStable(900, 12000);

  // 상태 초기화
  calibrating = true;
  lastCalProgress = 0;
  nextPointSeen = false;

  setPill(els.pillCal, "cal", "running");
  setStatus("Calibrating... 0% (keep your head steady, look at the green target)");

  // 기존 캘리브레이션이 남아 있으면 정리
  stopCalibrationQuiet();
  clearCalTimers();

  const onNextPoint = (x, y) => {
    nextPointSeen = true;

    // 캘리브레이션 중에는 gazeDot 숨김 + 타겟만 표시
    hideDot(gazeDot);

    // 타겟 표시(고정)
    showDot(calTarget, x, y);
    showCross(x, y);

    setStatus(
      `Calibrating... 0% (target at x=${Math.round(x)}, y=${Math.round(y)}). Keep head steady and stare at the target.`
    );

    // 렌더 후 샘플 수집 시작
    // requestAnimationFrame 2번으로 실제 페인트를 더 확실히 보장
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        startCollectSamplesSafely();
      });
    });
  };

  const onProgress = (pRaw) => {
    const p = normalizeProgress(pRaw);
    lastCalProgress = Math.max(lastCalProgress, p);

    const pct = clamp(Math.round(p * 100), 0, 100);
    setStatus(`Calibrating... ${pct}% (keep your head steady, stare at the target)`);
  };

  const onFinish = () => {
    calibrating = false;
    clearCalTimers();

    hideDot(calTarget);
    hideCross();

    setPill(els.pillCal, "cal", "done");
    setPill(els.pillTrack, "track", "running");
    setStatus("Calibration finished. Tracking is running.");
  };

  // 콜백 등록 (startCalibration 이전에 등록)
  seeso.addCalibrationNextPointCallback(onNextPoint);
  seeso.addCalibrationProgressCallback(onProgress);
  seeso.addCalibrationFinishCallback(onFinish);

  const ok = seeso.startCalibration(1, CalibrationAccuracyCriteria.DEFAULT);
  if (!ok) {
    calibrating = false;
    setPill(els.pillCal, "cal", "-");
    hideDot(calTarget);
    hideCross();
    throw new Error("Calibration did not start (startCalibration returned false).");
  }

  // 1) NextPoint가 아예 오지 않는 경우 감지
  noNextPointTimer = setTimeout(() => {
    if (!calibrating) return;
    if (nextPointSeen) return;

    // 1회만 재시작 시도
    if (!calRestartedOnce) {
      calRestartedOnce = true;
      setStatus("Calibration target not received. Restarting calibration once...");
      stopCalibrationQuiet();
      calibrating = false;
      startOnePointCalibrationAuto().catch((e) => {
        console.error(e);
        setStatus(`Error: ${e?.message || e}`);
        setPill(els.pillCal, "cal", "-");
      });
    } else {
      setStatus("Calibration target not received. Please reload and try again.");
      setPill(els.pillCal, "cal", "-");
    }
  }, 1500);

  // 2) 0%가 계속 유지되는 경우(샘플 수집 재호출/재시작)
  progressWatchTimer = setInterval(() => {
    if (!calibrating) return;

    // NextPoint가 왔는데도 progress가 계속 0이면 샘플수집 타이밍/응시 문제 가능
    if (nextPointSeen && lastCalProgress <= 0) {
      // tracking이 SUCCESS일 때만 재호출
      if (trackingStateLast === TrackingState.SUCCESS) {
        try {
          seeso.startCollectSamples();
        } catch (_) {}
      }
    }

    // 너무 오래(예: 6초) 0이면 1회 재시작
    const tooLongZero = nextPointSeen && lastCalProgress <= 0;
    if (tooLongZero) {
      // 6초 기준: interval(500ms)*12
      // 이 조건은 아래처럼 누적 체크로 구현
    }
  }, 500);

  // “6초 0%” 재시작용 누적 카운터
  let zeroTicks = 0;
  const zeroCounter = setInterval(() => {
    if (!calibrating) {
      clearInterval(zeroCounter);
      return;
    }
    if (nextPointSeen && lastCalProgress <= 0) {
      zeroTicks += 1;
    } else {
      zeroTicks = 0;
    }

    if (zeroTicks >= 12) {
      clearInterval(zeroCounter);

      if (!calRestartedOnce) {
        calRestartedOnce = true;
        setStatus("Calibration stuck at 0%. Restarting calibration once...");
        stopCalibrationQuiet();
        calibrating = false;
        startOnePointCalibrationAuto().catch((e) => {
          console.error(e);
          setStatus(`Error: ${e?.message || e}`);
          setPill(els.pillCal, "cal", "-");
        });
      } else {
        setStatus("Calibration stuck at 0%. Please reload and try again.");
        setPill(els.pillCal, "cal", "-");
      }
    }
  }, 500);
}

function cleanup() {
  clearCalTimers();

  hideDot(gazeDot);
  hideDot(calTarget);
  hideCross();

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
