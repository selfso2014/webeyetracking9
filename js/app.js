// js/app.js
import { loadWebpackModule } from "./webpack-loader.js";

// NOTE: GitHub Pages is a static site. A client-side license key is not truly secret.
// This demo does NOT display the key in the UI, but the key still exists in delivered JS.
const LICENSE_KEY = "dev_1ntzip9admm6g0upynw3gooycnecx0vl93hz8nox";

const els = {
  status: document.getElementById("status"),
  btnRetry: document.getElementById("btnRetry"),
  canvas: document.getElementById("output"),
  video: document.getElementById("preview"),
  pillCoi: document.getElementById("pillCoi"),
  pillPerm: document.getElementById("pillPerm"),
  pillSdk: document.getElementById("pillSdk"),
  pillTrack: document.getElementById("pillTrack"),
  pillCal: document.getElementById("pillCal"),
};

function setPill(el, text) {
  if (el) el.textContent = text;
}

function setStatus(text) {
  if (els.status) els.status.textContent = text;
}

function showRetry(show) {
  if (!els.btnRetry) return;
  els.btnRetry.style.display = show ? "inline-flex" : "none";
}

function toErrorString(err) {
  if (!err) return "Unknown error";
  if (typeof err === "string") return err;
  return err.message || String(err);
}

function stopStream(stream) {
  if (!stream) return;
  for (const t of stream.getTracks()) {
    try {
      t.stop();
    } catch {
      // ignore
    }
  }
}

// Canvas utilities
function createCanvasContext(canvas) {
  const ctx = canvas.getContext("2d", { alpha: true });
  const state = {
    ctx,
    dpr: Math.max(1, window.devicePixelRatio || 1),
    w: 0,
    h: 0,
  };

  function resize() {
    state.dpr = Math.max(1, window.devicePixelRatio || 1);
    state.w = Math.max(1, Math.floor(window.innerWidth));
    state.h = Math.max(1, Math.floor(window.innerHeight));
    canvas.style.width = `${state.w}px`;
    canvas.style.height = `${state.h}px`;
    canvas.width = Math.floor(state.w * state.dpr);
    canvas.height = Math.floor(state.h * state.dpr);
    ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  }

  window.addEventListener("resize", resize);
  resize();

  return { ctx, resize, state };
}

function drawDot(ctx, x, y, radiusPx) {
  ctx.beginPath();
  ctx.arc(x, y, radiusPx, 0, Math.PI * 2);
  ctx.fill();
}

async function main() {
  showRetry(false);
  setPill(els.pillCoi, `coi: ${window.crossOriginIsolated ? "enabled" : "disabled"}`);
  setPill(els.pillPerm, "perm: -");
  setPill(els.pillSdk, "sdk: -");
  setPill(els.pillTrack, "track: -");
  setPill(els.pillCal, "cal: -");

  if (!window.crossOriginIsolated) {
    setStatus("Cross-Origin Isolation is required for deployment. Auto-reloading once...");
  }

  setStatus("Loading SeeSo SDK...");
  const seesoExports = await loadWebpackModule("./seeso/dist/seeso.js");
  const Seeso = seesoExports.default;
  const { InitializationErrorType, CalibrationAccuracyCriteria, TrackingState } = seesoExports;

  setPill(els.pillSdk, "sdk: loaded");

  // Prepare canvas
  if (!els.canvas) throw new Error("Canvas element (#output) not found.");
  const { ctx } = createCanvasContext(els.canvas);

  // Optional video preview (muted/inline). This can help on some browsers.
  let stream = null;
  if (els.video) {
    els.video.muted = true;
    els.video.playsInline = true;
    els.video.autoplay = true;
  }

  // 1) Get camera permission first (explicitly), then pass the stream to startTracking.
  setStatus("Requesting camera permission...");
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video: true });
    setPill(els.pillPerm, "perm: granted");
  } catch (err) {
    setPill(els.pillPerm, "perm: denied");
    throw err;
  }

  if (els.video) {
    try {
      els.video.srcObject = stream;
    } catch {
      // ignore
    }
  }

  // 2) Initialize SDK
  setStatus("Initializing SDK...");
  const seeso = new Seeso();
  const errCode = await seeso.initialize(LICENSE_KEY);
  if (errCode !== InitializationErrorType.ERROR_NONE) {
    setPill(els.pillSdk, "sdk: init failed");
    throw new Error(`SDK initialization failed (errCode=${errCode})`);
  }
  setPill(els.pillSdk, "sdk: initialized");

  // 3) Start tracking with the already-approved stream
  setStatus("Starting tracking...");
  const trackingOk = seeso.startTracking(stream);
  if (!trackingOk) {
    setPill(els.pillTrack, "track: failed");
    throw new Error("Failed to start tracking.");
  }
  setPill(els.pillTrack, "track: running");

  // 4) Wait until we get at least one SUCCESS gaze frame (or timeout),
  // then immediately start 1-point calibration.
  let lastGaze = null;
  let calibrationTarget = null;
  let isCalibrating = false;

  let trackingReadyResolve;
  const trackingReadyPromise = new Promise((resolve) => {
    trackingReadyResolve = resolve;
  });
  const readyTimeoutId = setTimeout(() => trackingReadyResolve(false), 4000);

  const onGaze = (gazeInfo) => {
    lastGaze = gazeInfo;
    if (gazeInfo && gazeInfo.trackingState === TrackingState.SUCCESS) {
      clearTimeout(readyTimeoutId);
      trackingReadyResolve(true);
    }
  };
  seeso.addGazeCallback(onGaze);

  // Render loop (dots)
  let rafId = 0;
  const render = () => {
    ctx.clearRect(0, 0, window.innerWidth, window.innerHeight);

    // Calibration target (bigger dot)
    if (isCalibrating && calibrationTarget) {
      ctx.fillStyle = "#00ff00";
      drawDot(ctx, calibrationTarget.x, calibrationTarget.y, 14);
    }

    // Gaze dot (green) after calibration
    if (!isCalibrating && lastGaze && lastGaze.trackingState === TrackingState.SUCCESS) {
      const x = lastGaze.x;
      const y = lastGaze.y;
      if (Number.isFinite(x) && Number.isFinite(y)) {
        ctx.fillStyle = "#00ff00";
        drawDot(ctx, x, y, 8);
      }
    }

    rafId = window.requestAnimationFrame(render);
  };
  render();

  await trackingReadyPromise;

  // 5) Start 1-point calibration automatically.
  setStatus("Starting 1-point calibration. Look at the green dot.");
  isCalibrating = true;
  setPill(els.pillCal, "cal: running");

  const onCalNextPoint = (x, y) => {
    calibrationTarget = { x, y };
  };

  const onCalProgress = (p) => {
    const pct = Math.round(Math.max(0, Math.min(1, p)) * 100);
    setStatus(`Calibrating... ${pct}% (keep your head steady, look at the green dot)`);
  };

  const onCalFinish = (_calibDataString) => {
    isCalibrating = false;
    calibrationTarget = null;
    setPill(els.pillCal, "cal: done");
    setStatus("Calibration finished. Tracking gaze (green dot).");

    // Cleanup calibration callbacks to avoid duplicates
    try {
      seeso.removeCalibrationNextPointCallback(onCalNextPoint);
      seeso.removeCalibrationProgressCallback(onCalProgress);
      seeso.removeCalibrationFinishCallback(onCalFinish);
    } catch {
      // ignore
    }
  };

  seeso.addCalibrationNextPointCallback(onCalNextPoint);
  seeso.addCalibrationProgressCallback(onCalProgress);
  seeso.addCalibrationFinishCallback(onCalFinish);

  const started = seeso.startCalibration(1, CalibrationAccuracyCriteria.Default);
  if (!started) {
    setPill(els.pillCal, "cal: failed");
    isCalibrating = false;
    throw new Error("Calibration did not start.");
  }

  // Clean shutdown on page unload
  window.addEventListener("beforeunload", () => {
    try {
      window.cancelAnimationFrame(rafId);
    } catch {
      // ignore
    }
    try {
      seeso.stopCalibration();
    } catch {
      // ignore
    }
    try {
      seeso.stopTracking();
    } catch {
      // ignore
    }
    try {
      seeso.deinitialize();
    } catch {
      // ignore
    }
    stopStream(stream);
  });
}

async function boot() {
  try {
    await main();
  } catch (err) {
    console.error(err);
    setStatus(`Error: ${toErrorString(err)}`);
    showRetry(true);
  }
}

if (els.btnRetry) {
  els.btnRetry.addEventListener("click", () => {
    window.location.reload();
  });
}

boot();
