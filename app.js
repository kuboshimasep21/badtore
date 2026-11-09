/* =========================================================
   BadTore PRO v9.5 - Main Application Engine (app.js)
   - Separated Camera & Uploaded Video Pipelines (Zero conflict)
   - Instant Auto-Diagnosis on Video Upload + A-B Loop & Seek
   - 5-Factor Cause-Specific AI Engine + Junior Sensation Coaching
   - 3-Stage Drill Prescription (分解 ➔ 手投げノック ➔ パターン)
   ========================================================= */

"use strict";

/* ---------------------------------------------------------
   1. グローバル状態管理 ＆ メンバー初期データ
   --------------------------------------------------------- */
const STORAGE_KEY = "BADTORE_PRO_V95_STATE";

const DEFAULT_MEMBERS = [
  { id: "m_kuboshima", name: "窪島", hand: "right", bests: {} },
  { id: "m_rinne", name: "凛音", hand: "right", bests: {} },
  { id: "m_kanon", name: "奏音", hand: "right", bests: {} }
];

let appState = {
  members: JSON.parse(JSON.stringify(DEFAULT_MEMBERS)),
  activeMemberId: "m_kuboshima"
};

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed.members) && parsed.members.length > 0) {
        appState.members = parsed.members;
        appState.activeMemberId = parsed.activeMemberId || parsed.members[0].id;
      }
    }
  } catch (e) {
    console.warn("State load warning:", e);
  }
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(appState));
  } catch (e) {
    console.warn("State save warning:", e);
  }
}

function getActiveMember() {
  return appState.members.find(m => m.id === appState.activeMemberId) || appState.members[0];
}

/* ---------------------------------------------------------
   2. タブ切替 ＆ 全画面表示（iPhone / iPad 対応） ＆ WakeLock
   --------------------------------------------------------- */
let wakeLockSentinel = null;

async function requestWakeLock() {
  if ("wakeLock" in navigator) {
    try {
      wakeLockSentinel = await navigator.wakeLock.request("screen");
    } catch (_) {}
  }
}

function switchTab(tabId) {
  document.querySelectorAll(".tab-panel").forEach(p => p.classList.remove("active"));
  document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));

  const targetPanel = document.getElementById(tabId);
  if (targetPanel) targetPanel.classList.add("active");

  const targetBtn = document.querySelector(`.tab-btn[data-tab="${tabId}"]`);
  if (targetBtn) targetBtn.classList.add("active");

  if (tabId === "tab-pose" || tabId === "tab-reaction") {
    ensurePoseInitialized();
  }
}

function toggleFullscreen(boxId) {
  const el = document.getElementById(boxId);
  if (!el) return;
  const isNowFs = el.classList.toggle("is-fullscreen");
  document.body.classList.toggle("is-fullscreen-mode", isNowFs);
}

/* ---------------------------------------------------------
   3. iOS Safari 遅延ゼロ WebAudio 電子音 ＆ 音声合成
   --------------------------------------------------------- */
let audioCtx = null;

function ensureAudioContext() {
  if (!audioCtx) {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) audioCtx = new AudioContextClass();
  }
  if (audioCtx && audioCtx.state === "suspended") {
    audioCtx.resume();
  }
}

function playBeep(freq = 880, durationMs = 110, type = "sine") {
  try {
    ensureAudioContext();
    if (!audioCtx) return;
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
    gain.gain.setValueAtTime(0.22, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + durationMs / 1000);
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    osc.start();
    osc.stop(audioCtx.currentTime + durationMs / 1000);
  } catch (_) {}
}

function speakText(text) {
  if (!("speechSynthesis" in window)) return;
  try {
    window.speechSynthesis.cancel();
    const uttr = new SpeechSynthesisUtterance(text);
    uttr.lang = "ja-JP";
    uttr.rate = 1.25;
    uttr.pitch = 1.05;
    window.speechSynthesis.speak(uttr);
  } catch (_) {}
}

function testVoiceAudio() {
  playBeep(960, 120, "triangle");
  speakText("音声と電子音のテストです。右前、左奥。");
}

/* ---------------------------------------------------------
   4. TAB 1: 6点フットワークトレーナー（順番送り・時間制・再発光対応）
   --------------------------------------------------------- */
const FW_ZONES = {
  1: { name: "左前", voice: "ひだりまえ" },
  2: { name: "右前", voice: "みぎまえ" },
  3: { name: "左サイド", voice: "ひだりサイド" },
  4: { name: "右サイド", voice: "みぎサイド" },
  5: { name: "左奥", voice: "ひだりおく" },
  6: { name: "右奥", voice: "みぎおく" }
};

const FW_PRESET_SEQUENCES = {
  clockwise: [1, 2, 4, 6, 5, 3],
  counter_cw: [2, 1, 3, 5, 6, 4],
  cross_r: [2, 5],
  cross_l: [1, 6],
  front_back_r: [2, 6],
  front_back_l: [1, 5],
  sides: [3, 4],
  front_only: [1, 2],
  rear_only: [5, 6]
};

let fwEnabledZones = new Set([1, 2, 3, 4, 5, 6]);
let fwRunning = false;
let fwTimerId = null;
let fwCountdownId = null;
let fwSeqIndex = 0;

function toggleFwZone(zoneId) {
  if (fwEnabledZones.has(zoneId)) {
    if (fwEnabledZones.size <= 1) return;
    fwEnabledZones.delete(zoneId);
  } else {
    fwEnabledZones.add(zoneId);
  }
  renderFwZoneStates();
}

function enableAllFwZones(enableAll = true) {
  if (enableAll) fwEnabledZones = new Set([1, 2, 3, 4, 5, 6]);
  renderFwZoneStates();
}

function renderFwZoneStates() {
  document.querySelectorAll("#fwCourtGrid .court-cell").forEach(cell => {
    const z = Number(cell.getAttribute("data-zone"));
    cell.classList.toggle("disabled-zone", !fwEnabledZones.has(z));
  });
}

function applyFwPreset() {
  const pattern = document.getElementById("fwPatternSelect").value;
  if (pattern === "random") {
    fwEnabledZones = new Set([1, 2, 3, 4, 5, 6]);
  } else if (FW_PRESET_SEQUENCES[pattern]) {
    fwEnabledZones = new Set(FW_PRESET_SEQUENCES[pattern]);
  }
  renderFwZoneStates();
}

function highlightCourtZone(zoneId) {
  const cells = document.querySelectorAll("#fwCourtGrid .court-cell");
  const target = document.querySelector(`#fwCourtGrid .court-cell[data-zone="${zoneId}"]`);
  const wasAlreadyActive = target && target.classList.contains("active");

  cells.forEach(c => {
    c.classList.remove("active");
    c.classList.remove("retrigger");
  });

  if (!target) return;

  if (wasAlreadyActive) {
    // 同じ場所が連続した際も一瞬（95ms）消灯してからピカッと再発光
    target.classList.add("retrigger");
    setTimeout(() => {
      target.classList.remove("retrigger");
      target.classList.add("active");
    }, 95);
  } else {
    target.classList.add("active");
  }
}

function clearCourtHighlights() {
  document.querySelectorAll("#fwCourtGrid .court-cell").forEach(c => {
    c.classList.remove("active");
    c.classList.remove("retrigger");
  });
}

function startFootwork() {
  stopFootwork();
  ensureAudioContext();
  requestWakeLock();

  const prepSec = Number(document.getElementById("fwPrepCountSelect").value || 0);
  fwRunning = true;
  fwSeqIndex = 0;

  if (prepSec > 0) {
    runOverlayCountdown("fwCountdownOverlay", "fwCountdownNum", "fwCountdownLabel", prepSec, "センターに構えてください", () => {
      if (fwRunning) executeFootworkSets();
    });
  } else {
    executeFootworkSets();
  }
}

function runOverlayCountdown(overlayId, numId, labelId, seconds, labelText, onComplete) {
  const overlay = document.getElementById(overlayId);
  const numEl = document.getElementById(numId);
  const labelEl = document.getElementById(labelId);
  if (!overlay || !numEl) {
    onComplete();
    return;
  }

  let rem = seconds;
  overlay.classList.add("show");
  if (labelEl) labelEl.textContent = labelText;
  numEl.textContent = String(rem);
  playBeep(660, 90, "sine");

  fwCountdownId = setInterval(() => {
    rem -= 1;
    if (rem > 0) {
      numEl.textContent = String(rem);
      playBeep(660, 90, "sine");
    } else {
      clearInterval(fwCountdownId);
      fwCountdownId = null;
      overlay.classList.remove("show");
      playBeep(1120, 180, "triangle");
      onComplete();
    }
  }, 1000);
}

function executeFootworkSets() {
  const pattern = document.getElementById("fwPatternSelect").value;
  const intervalSec = Number(document.getElementById("fwIntervalSelect").value || 2.5);
  const modeVal = document.getElementById("fwModeDurationSelect").value;
  const [modeType, modeNumStr] = modeVal.split("_");
  const targetVal = Number(modeNumStr);

  const [totalSetsStr, restSecStr] = document.getElementById("fwSetsSelect").value.split("_");
  const totalSets = Number(totalSetsStr);
  const restSec = Number(restSecStr);
  const audioMode = document.getElementById("fwAudioSelect").value;

  let currentSet = 1;
  let currentRep = 0;
  let setStartTime = performance.now();

  const pickNextZone = () => {
    if (pattern !== "random" && FW_PRESET_SEQUENCES[pattern]) {
      const seq = FW_PRESET_SEQUENCES[pattern];
      const z = seq[fwSeqIndex % seq.length];
      fwSeqIndex += 1;
      return z;
    }
    const pool = Array.from(fwEnabledZones);
    if (pool.length === 0) return 1;
    return pool[Math.floor(Math.random() * pool.length)];
  };

  const stepInstruction = () => {
    if (!fwRunning) return;

    const elapsedSec = (performance.now() - setStartTime) / 1000;
    const isSetDone = (modeType === "reps") ? (currentRep >= targetVal) : (elapsedSec >= targetVal);

    if (isSetDone) {
      clearCourtHighlights();
      if (currentSet < totalSets) {
        speakText(`${currentSet}セット終了。${restSec}秒休憩です`);
        const nextSetNum = currentSet + 1;
        runOverlayCountdown(
          "fwCountdownOverlay",
          "fwCountdownNum",
          "fwCountdownLabel",
          restSec,
          `セット休憩中（次は ${nextSetNum}/${totalSets} セット）`,
          () => {
            if (!fwRunning) return;
            currentSet += 1;
            currentRep = 0;
            setStartTime = performance.now();
            stepInstruction();
          }
        );
      } else {
        document.getElementById("fwStatusBadge").textContent = `🎉 全 ${totalSets} セット完了！`;
        playBeep(1200, 260, "triangle");
        speakText("トレーニング完了です。ナイスファイト！");
        fwRunning = false;
      }
      return;
    }

    currentRep += 1;
    const zoneId = pickNextZone();
    highlightCourtZone(zoneId);

    const statusBadge = document.getElementById("fwStatusBadge");
    if (modeType === "reps") {
      statusBadge.textContent = `稼働中 セット ${currentSet}/${totalSets} ｜ ${currentRep}/${targetVal} 回`;
    } else {
      const remain = Math.max(0, Math.ceil(targetVal - elapsedSec));
      statusBadge.textContent = `稼働中 セット ${currentSet}/${totalSets} ｜ 残り ${remain} 秒`;
    }

    if (audioMode === "both" || audioMode === "beep") {
      playBeep(920, 95, "triangle");
    }
    if (audioMode === "both" || audioMode === "voice") {
      speakText(FW_ZONES[zoneId].voice);
    }

    fwTimerId = setTimeout(stepInstruction, intervalSec * 1000);
  };

  stepInstruction();
}

function stopFootwork() {
  fwRunning = false;
  if (fwTimerId) {
    clearTimeout(fwTimerId);
    fwTimerId = null;
  }
  if (fwCountdownId) {
    clearInterval(fwCountdownId);
    fwCountdownId = null;
  }
  const overlay = document.getElementById("fwCountdownOverlay");
  if (overlay) overlay.classList.remove("show");
  clearCourtHighlights();
  const badge = document.getElementById("fwStatusBadge");
  if (badge) badge.textContent = "停止中 ｜ 開始ボタンでスタート";
}

/* ---------------------------------------------------------
   5. AI Vision 共通パイプライン（カメラ映像とアップロード動画を完全分離）
   --------------------------------------------------------- */
let poseInstance = null;
let isPoseReady = false;
let isProcessingPoseFrame = false;

// 'idle' | 'camera_pose' | 'camera_rx' | 'video_pose'
let activeInputSource = "idle";
let cameraStream = null;
let latestLandmarks = null;
let visionLoopActive = false;

// ディレイ再生バッファ (0 / 3 / 5秒)
let delaySeconds = 0;
let delayFrameQueue = [];

// 動画A-Bループ制御
let videoLoopA = 0;
let videoLoopB = 9999;
let videoPlaybackRate = 1.0;

function ensurePoseInitialized() {
  if (poseInstance) return;
  if (typeof Pose === "undefined") {
    console.warn("MediaPipe Pose script not yet loaded.");
    return;
  }
  poseInstance = new Pose({
    locateFile: file => `https://cdn.jsdelivr.net/npm/@mediapipe/pose/${file}`
  });
  poseInstance.setOptions({
    modelComplexity: 1,
    smoothLandmarks: true,
    enableSegmentation: false,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5
  });
  poseInstance.onResults(onPoseResults);
  isPoseReady = true;
}

function onPoseResults(results) {
  latestLandmarks = (results && results.poseLandmarks) ? results.poseLandmarks : null;
  const recogBadge = document.getElementById("poseRecogBadge");
  if (recogBadge) {
    if (latestLandmarks) {
      recogBadge.textContent = "🟢 全身骨格ロック中";
      recogBadge.style.color = "#6ee7b7";
    } else {
      recogBadge.textContent = "🟡 全身を枠内に入れてください";
      recogBadge.style.color = "#fde047";
    }
  }
}

function stopCameraStreamOnly() {
  if (cameraStream) {
    cameraStream.getTracks().forEach(t => t.stop());
    cameraStream = null;
  }
  const camVid = document.getElementById("cameraVideo");
  if (camVid) camVid.srcObject = null;
}

function stopUploadedVideoOnly() {
  const upVid = document.getElementById("uploadedVideo");
  if (upVid) {
    upVid.pause();
  }
  const bar = document.getElementById("videoCtrlBar");
  if (bar) bar.classList.remove("show");
}

async function startPoseCamera() {
  ensurePoseInitialized();
  stopUploadedVideoOnly();

  if (activeInputSource === "camera_pose" && cameraStream) {
    stopCameraStreamOnly();
    activeInputSource = "idle";
    document.getElementById("poseCamBtn").textContent = "📷 AIカメラ起動";
    document.getElementById("poseSourceBadge").textContent = "⚪ カメラ停止中";
    document.getElementById("posePlaceholder").classList.remove("hidden");
    return;
  }

  try {
    stopCameraStreamOnly();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "environment", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    cameraStream = stream;
    const camVid = document.getElementById("cameraVideo");
    camVid.srcObject = stream;
    await camVid.play();

    activeInputSource = "camera_pose";
    document.getElementById("posePlaceholder").classList.add("hidden");
    document.getElementById("poseCamBtn").textContent = "⏹️ カメラ停止";
    document.getElementById("poseSourceBadge").textContent = "🟢 ライブAIカメラ稼働中";
    ensureVisionLoop();
  } catch (err) {
    alert("カメラの起動に失敗しました。Safariのカメラ許可設定をご確認ください。");
  }
}

/* ---------------------------------------------------------
   6. 動画読込の即時自動診断 ＆ シーク・区間A-Bループ制御
   --------------------------------------------------------- */
function handleVideoUpload(event) {
  const file = event.target.files && event.target.files[0];
  if (!file) return;

  ensurePoseInitialized();
  // カメラが動いていれば安全に停止して動画パイプラインへ切替
  stopCameraStreamOnly();
  document.getElementById("poseCamBtn").textContent = "📷 カメラに戻す";

  const upVid = document.getElementById("uploadedVideo");
  const url = URL.createObjectURL(file);

  upVid.src = url;
  upVid.playsInline = true;
  upVid.muted = true;
  upVid.playbackRate = videoPlaybackRate;

  upVid.onloadedmetadata = async () => {
    const dur = upVid.duration || 10;
    videoLoopA = 0;
    videoLoopB = dur;

    const slider = document.getElementById("vidSeekSlider");
    if (slider) {
      slider.max = String(dur.toFixed(2));
      slider.value = "0";
    }
    document.getElementById("loopABtn").textContent = "📍 開始A: 0.0s";
    document.getElementById("loopBBtn").textContent = `🏁 終了B: ${dur.toFixed(1)}s`;
    document.getElementById("videoCtrlBar").classList.add("show");
    document.getElementById("posePlaceholder").classList.add("hidden");
    document.getElementById("poseSourceBadge").textContent = "🎬 動画AI自動解析モード";

    activeInputSource = "video_pose";
    ensureVisionLoop();

    // カメラ起動不要で0秒目から即時再生＆自動診断スタート
    upVid.currentTime = 0;
    try {
      await upVid.play();
      document.getElementById("vidPlayPauseBtn").textContent = "⏸️ 一時停止";
    } catch (_) {}

    startImmediateVideoDiagnosis();
  };

  upVid.onended = () => {
    if (isDiagnosing10Sec) {
      finalizePoseDiagnosis();
    }
    document.getElementById("vidPlayPauseBtn").textContent = "▶️ 再生";
  };
}

function toggleUploadedVideoPlay() {
  const upVid = document.getElementById("uploadedVideo");
  if (!upVid || activeInputSource !== "video_pose") return;
  if (upVid.paused) {
    if (upVid.currentTime >= videoLoopB || upVid.ended) {
      upVid.currentTime = videoLoopA;
    }
    upVid.play();
    document.getElementById("vidPlayPauseBtn").textContent = "⏸️ 一時停止";
  } else {
    upVid.pause();
    document.getElementById("vidPlayPauseBtn").textContent = "▶️ 再生";
  }
}

function seekUploadedVideo(val) {
  const upVid = document.getElementById("uploadedVideo");
  if (!upVid || activeInputSource !== "video_pose") return;
  upVid.currentTime = Number(val);
  updateVideoTimeUI();
}

function stepVideoFrame(deltaSec) {
  const upVid = document.getElementById("uploadedVideo");
  if (!upVid || activeInputSource !== "video_pose") return;
  upVid.pause();
  document.getElementById("vidPlayPauseBtn").textContent = "▶️ 再生";
  const nextT = Math.max(0, Math.min(upVid.duration || 10, upVid.currentTime + deltaSec));
  upVid.currentTime = nextT;
  updateVideoTimeUI();
}

function cycleVideoSpeed() {
  const rates = [1.0, 0.5, 0.25];
  const idx = rates.indexOf(videoPlaybackRate);
  videoPlaybackRate = rates[(idx + 1) % rates.length];
  const upVid = document.getElementById("uploadedVideo");
  if (upVid) upVid.playbackRate = videoPlaybackRate;
  document.getElementById("vidSpeedBtn").textContent = `🐢 速度: ${videoPlaybackRate}x`;
}

function setVideoLoopPoint(point) {
  const upVid = document.getElementById("uploadedVideo");
  if (!upVid || activeInputSource !== "video_pose") return;
  const cur = upVid.currentTime;
  if (point === "A") {
    videoLoopA = Math.min(cur, videoLoopB - 0.3);
    document.getElementById("loopABtn").textContent = `📍 開始A: ${videoLoopA.toFixed(1)}s`;
  } else {
    videoLoopB = Math.max(cur, videoLoopA + 0.3);
    document.getElementById("loopBBtn").textContent = `🏁 終了B: ${videoLoopB.toFixed(1)}s`;
  }
}

function reanalyzeUploadedVideo() {
  const upVid = document.getElementById("uploadedVideo");
  if (!upVid || activeInputSource !== "video_pose") return;
  upVid.currentTime = videoLoopA;
  upVid.play();
  document.getElementById("vidPlayPauseBtn").textContent = "⏸️ 一時停止";
  startImmediateVideoDiagnosis();
}

function updateVideoTimeUI() {
  const upVid = document.getElementById("uploadedVideo");
  if (!upVid) return;
  const cur = upVid.currentTime || 0;
  const dur = upVid.duration || 0;
  const slider = document.getElementById("vidSeekSlider");
  if (slider && !slider.matches(":active")) {
    slider.value = String(cur.toFixed(2));
  }
  const readout = document.getElementById("vidTimeReadout");
  if (readout) {
    readout.textContent = `${cur.toFixed(1)}s / ${dur.toFixed(1)}s`;
  }
  // 区間Bに達したら自動完了
  if (activeInputSource === "video_pose" && !upVid.paused && cur >= videoLoopB) {
    upVid.pause();
    document.getElementById("vidPlayPauseBtn").textContent = "▶️ 再生";
    if (isDiagnosing10Sec) {
      finalizePoseDiagnosis();
    }
  }
}

function cycleDelayMode() {
  const modes = [0, 3, 5];
  delaySeconds = modes[(modes.indexOf(delaySeconds) + 1) % modes.length];
  delayFrameQueue = [];
  document.getElementById("poseDelayBtn").textContent =
    delaySeconds === 0 ? "⏪ ディレイ: OFF" : `⏪ ディレイ: ${delaySeconds}秒遅れ`;
}

/* ---------------------------------------------------------
   7. 骨格角度・リストスタンド・抜重・初速の幾何計算エンジン
   --------------------------------------------------------- */
function calcAngle3D(a, b, c) {
  if (!a || !b || !c) return 0;
  const abx = a.x - b.x;
  const aby = a.y - b.y;
  const cbx = c.x - b.x;
  const cby = c.y - b.y;
  const dot = abx * cbx + aby * cby;
  const mag = Math.hypot(abx, aby) * Math.hypot(cbx, cby);
  if (mag < 1e-6) return 0;
  const cos = Math.max(-1, Math.min(1, dot / mag));
  return Math.round((Math.acos(cos) * 180) / Math.PI);
}

let prevWristPt = null;
let prevHipCenterY = null;
let prevFrameTime = 0;

let poseMaxStats = {
  maxElbow: 0,
  minElbow: 180,
  maxLift: 0,
  minKnee: 180,
  maxSpeedPt: 0
};

function resetPoseMaxStats() {
  poseMaxStats = {
    maxElbow: 0,
    minElbow: 180,
    maxLift: 0,
    minKnee: 180,
    maxSpeedPt: 0
  };
}

function computeFrameBiomechanics(lm) {
  const member = getActiveMember();
  const isRight = member.hand !== "left";

  const shoulder = isRight ? lm[12] : lm[11];
  const oppShoulder = isRight ? lm[11] : lm[12];
  const elbow = isRight ? lm[14] : lm[13];
  const wrist = isRight ? lm[16] : lm[15];
  const indexFinger = isRight ? lm[20] : lm[19];
  const hip = isRight ? lm[24] : lm[23];
  const oppHip = isRight ? lm[23] : lm[24];
  const knee = isRight ? lm[26] : lm[25];
  const ankle = isRight ? lm[28] : lm[27];
  const oppAnkle = isRight ? lm[27] : lm[28];
  const nose = lm[0];

  // ① 肘角度（肩-肘-手首）
  const elbowAngle = calcAngle3D(shoulder, elbow, wrist);
  // ② 肩挙上角（股関節-肩-肘）
  const liftAngle = calcAngle3D(hip, shoulder, elbow);
  // ③ 膝の沈み込み角（股関節-膝-足首）
  const kneeAngle = calcAngle3D(hip, knee, ankle);
  // ④ リストスタンド角（肘-手首-人差し指）
  const wristAngle = calcAngle3D(elbow, wrist, indexFinger);

  // ⑤ 体幹の中心長（カメラ向きで変わらない基準長）と軸の傾き角
  const midShoulderX = (shoulder.x + oppShoulder.x) / 2;
  const midShoulderY = (shoulder.y + oppShoulder.y) / 2;
  const midHipX = (hip.x + oppHip.x) / 2;
  const midHipY = (hip.y + oppHip.y) / 2;
  const torsoLen = Math.max(0.12, Math.hypot(midShoulderX - midHipX, midShoulderY - midHipY));

  const trunkTiltDeg = Math.round(
    (Math.atan2(Math.abs(midShoulderX - midHipX), Math.abs(midHipY - midShoulderY) + 1e-5) * 180) / Math.PI
  );

  // ⑥ 手首（ラケット）がみぞおち・胸の高さより上にあるか
  // y座標は上が小さく下が大きい
  const sternumY = midShoulderY + torsoLen * 0.58;
  const isRacketUp = wrist.y <= sternumY;

  // ⑦ スタンス幅比（肩幅に対する足幅の倍率）
  const shoulderWidth = Math.max(0.08, Math.hypot(shoulder.x - oppShoulder.x, shoulder.y - oppShoulder.y));
  const ankleSpan = Math.hypot(ankle.x - oppAnkle.x, ankle.y - oppAnkle.y);
  const stanceRatio = Number((ankleSpan / shoulderWidth).toFixed(2));

  // ⑧ 体幹長正規化スイング＆抜重初速
  const now = performance.now();
  let speedScore = 50;
  let hipVertDelta = 0;

  if (prevWristPt && prevFrameTime > 0) {
    const dt = Math.max(0.016, (now - prevFrameTime) / 1000);
    const wristDist = Math.hypot(wrist.x - prevWristPt.x, wrist.y - prevWristPt.y);
    const normVel = (wristDist / torsoLen) / dt;
    speedScore = Math.min(100, Math.round(normVel * 18));
    if (prevHipCenterY !== null) {
      hipVertDelta = Math.abs(midHipY - prevHipCenterY) / torsoLen;
    }
  }
  prevWristPt = { x: wrist.x, y: wrist.y };
  prevHipCenterY = midHipY;
  prevFrameTime = now;

  // MAX統計更新
  if (elbowAngle > poseMaxStats.maxElbow) poseMaxStats.maxElbow = elbowAngle;
  if (elbowAngle > 20 && elbowAngle < poseMaxStats.minElbow) poseMaxStats.minElbow = elbowAngle;
  if (liftAngle > poseMaxStats.maxLift) poseMaxStats.maxLift = liftAngle;
  if (kneeAngle > 40 && kneeAngle < poseMaxStats.minKnee) poseMaxStats.minKnee = kneeAngle;
  if (speedScore > poseMaxStats.maxSpeedPt) poseMaxStats.maxSpeedPt = speedScore;

  return {
    elbowAngle,
    liftAngle,
    kneeAngle,
    wristAngle,
    trunkTiltDeg,
    isRacketUp,
    sternumY,
    stanceRatio,
    speedScore,
    hipVertDelta,
    midHipY,
    noseY: nose ? nose.y : midShoulderY,
    shoulder,
    elbow,
    wrist,
    hip,
    knee,
    ankle,
    oppAnkle
  };
}

/* ---------------------------------------------------------
   8. 10種目の理想基準値 ＆ 5局面原因特定・ジュニア感覚ワード・処方箋データ
   --------------------------------------------------------- */
const CHECK_TYPE_SPECS = {
  ready_stance: {
    title: "基本の構え・レディポジション",
    idealLift: 65,
    idealElbow: 105,
    idealKnee: 140,
    idealWrist: 145,
    recommendedFw: "sides"
  },
  footwork_step: {
    title: "フットワーク・ランジ＆リカバリー",
    idealLift: 75,
    idealElbow: 110,
    idealKnee: 118,
    idealWrist: 148,
    recommendedFw: "cross_r"
  },
  smash: {
    title: "オーバーヘッド・スマッシュ",
    idealLift: 152,
    idealElbow: 168,
    idealKnee: 132,
    idealWrist: 152,
    recommendedFw: "rear_only"
  },
  high_clear: {
    title: "ハイクリアー",
    idealLift: 155,
    idealElbow: 170,
    idealKnee: 128,
    idealWrist: 150,
    recommendedFw: "front_back_r"
  },
  drop_cut: {
    title: "ドロップ＆カット",
    idealLift: 148,
    idealElbow: 160,
    idealKnee: 136,
    idealWrist: 148,
    recommendedFw: "cross_l"
  },
  drive: {
    title: "ドライブ",
    idealLift: 88,
    idealElbow: 125,
    idealKnee: 138,
    idealWrist: 155,
    recommendedFw: "sides"
  },
  push_net: {
    title: "プッシュ＆ネット前アタック",
    idealLift: 98,
    idealElbow: 135,
    idealKnee: 122,
    idealWrist: 158,
    recommendedFw: "front_only"
  },
  receive_lob: {
    title: "レシーブ＆ロブ",
    idealLift: 72,
    idealElbow: 118,
    idealKnee: 124,
    idealWrist: 150,
    recommendedFw: "sides"
  },
  hairpin: {
    title: "ヘアピン",
    idealLift: 82,
    idealElbow: 132,
    idealKnee: 115,
    idealWrist: 155,
    recommendedFw: "front_only"
  },
  high_serve: {
    title: "ハイサーブ＆ロングサーブ",
    idealLift: 95,
    idealElbow: 148,
    idealKnee: 138,
    idealWrist: 152,
    recommendedFw: "clockwise"
  }
};

// 5つの弱点原因ごとの「ジュニア感覚ワード解説」＆「3段階の改善練習メニュー処方箋」
const CAUSE_PRESCRIPTIONS = {
  racket_drop: {
    causeName: "ラケット下がり・手首の寝すぎ（リストスタンド不足）",
    juniorSense:
      "「動いている時にラケットが腰の下まで落ちているよ！」球際でラケットを上げる時間がもったいない！『手首をキュッと立てて（リストスタンド）、みぞおちの前で構えたまま』足を動かそう！",
    drillTitle: "📋 処方メニュー：『ラケット胸前固定ステップ ➔ 至近距離・手投げ連続レシーブ』",
    step1:
      "Step 1 (分解・素振り): グリップエンドをおへそ〜みぞおちの前に向け、手首を立ててラケットヘッドを目の高さに保ったまま左右へシャッセで動く（10往復）。",
    step2:
      "Step 2 (手投げノック): 3〜4mの至近距離からテンポよく手投げでシャトルを出してもらい、大振りせずに「立てた手首の指先の握り込み（回内・回外）だけ」で前に弾き返す（15球×2）。",
    step3:
      "Step 3 (基礎打ち・パターン): ドライブまたはプッシュの基礎打ちに入り、1球ごとに打った直後のラケットが腰の下へ落ちないかチェックする。",
    fwPreset: "front_only"
  },
  excess_bounce: {
    causeName: "待機中の小刻みな上下バウンド（抜重タイミングのズレ）",
    juniorSense:
      "「待つときにピョンピョン跳ねちゃっているよ！」空中にいる瞬間は足が動かせません。『静かにピタッと待って、相手が打つ瞬間にだけフッと足の裏の力を抜いて2cm沈む（抜重）』を意識しよう！",
    drillTitle: "📋 処方メニュー：『無反動ストップ＆ゴー（抜重感覚づくり）』",
    step1:
      "Step 1 (分解・素振り): リズム取りのジャンプを禁止し、膝を軽く曲げた静止状態から合図で「上に跳ねずに2cmスッと沈んで1歩目を踏み出す」練習（5回×2セット）。",
    step2:
      "Step 2 (手投げノック): 静止した構えから、前に軽く手投げしてもらったシャトルへ無反動の1歩で入ってラケット面を合わせる確認ノック。",
    step3:
      "Step 3 (基礎打ち・パターン): レシーブ＆ロブの基礎打ちで、相手がインパクトする瞬間に空中に浮いていないかタイミングを合わせる。",
    fwPreset: "sides"
  },
  lunge_lean: {
    causeName: "踏み込み（ランジ）時の頭・上体の突っ込み＆膝の浅さ",
    juniorSense:
      "「止まる時にアタマが膝より前に突っ込んでいるよ！」頭が前に倒れるとブレーキが効かず、次の1歩が戻りません。『おへその下に重心を落として、胸を張ってカカトから着地してピタッと止まる』とバネのように戻れるよ！",
    drillTitle: "📋 処方メニュー：『ランジ2秒ピタ止め ➔ 手投げタッチ＆蹴り戻し』",
    step1:
      "Step 1 (分解・素振り): 右前・左前へ踏み込んだ瞬間、すぐ戻らずに「胸を起こし、カカトから着地して2秒間ピタッと静止」して頭が突っ込まない姿勢を体に覚えさせる。",
    step2:
      "Step 2 (手投げノック): ネット前から手投げでシャトルを出してもらい、上体を倒さず手首を立てたままシャトルを捉え、前足の蹴り戻し1発でセンターへ戻る。",
    step3:
      "Step 3 (基礎打ち・パターン): カット＆ネット（または対角線クロス）のパターン練習に移り、実戦スピードでも上体が前に崩れないか確認する。",
    fwPreset: "cross_r"
  },
  low_contact: {
    causeName: "打点の低下・テイクバックでの肘下がり（押し出し打ち）",
    juniorSense:
      "「打つ時にヒジが肩より下がって、前に押し出す打ち方になっているよ！」パワーが逃げてネットにかかりやすい形です。『最初にヒジを耳の横まで高く上げて、胸を開いてからうちわを仰ぐように上へ振る』イメージで打ってみよう！",
    drillTitle: "📋 処方メニュー：『トップ固定の分解スイング ➔ 手投げハイキャッチ＆ストローク』",
    step1:
      "Step 1 (分解・素振り): テイクバックを省略し、最初から「右肘を肩より高く上げ、左手を前に伸ばしたトップの形」を作って2秒止まり、そこから一気に振る分解素振り（8回）。",
    step2:
      "Step 2 (手投げノック): 斜め前から山なりに手投げしてもらったシャトルを、落ちてくるのを待たずに「一番高い打点（額の斜め前）でキャッチ／軽く打つ」ドリル。",
    step3:
      "Step 3 (基礎打ち・パターン): クリア・スマッシュの基礎打ちに入り、手投げで確認した一番高い打点でシャトルを捉え続ける。",
    fwPreset: "rear_only"
  },
  slow_recovery: {
    causeName: "踏み込み最深点からの蹴り戻し（リカバリー）と後半の姿勢崩れ",
    juniorSense:
      "「1歩目は速いけれど、打ったあとにその場で居座っちゃっているよ！」また、後半になると少しずつラケットが下がっています。『打つ瞬間と前足で床を蹴り戻す瞬間をセットにする』意識でセンターへ素早く戻ろう！",
    drillTitle: "📋 処方メニュー：『着地即キックバック ➔ 連続前後手投げノック』",
    step1:
      "Step 1 (分解・素振り): 踏み込みの足が床につく「タン・タン」のリズムで、2拍目で必ず元の構え位置へ跳ね返るステップ反復。",
    step2:
      "Step 2 (手投げノック): ネット前に手投げ ➔ センターへ戻る ➔ すぐ逆サイドへ手投げの連続2球ノックで、戻りの1歩目を速くする。",
    step3:
      "Step 3 (基礎打ち・パターン): 6点順番送りまたは前後ストレート反復コース（20秒連続）で、後半もラケットの高さを落とさず動き切る。",
    fwPreset: "front_back_r"
  }
};

/* ---------------------------------------------------------
   9. 10秒間 / 動画連動 精密測定セッション管理
   --------------------------------------------------------- */
let isDiagnosing10Sec = false;
let diagnosisFrames = [];
let diagnosisTimerId = null;
let bestMomentDataUrl = null;
let bestMomentFrameScore = -1;
let recommendedFwKey = "cross_r";

function onPoseCheckTypeChange() {
  resetPoseMaxStats();
  updateSavedBestBadge();
  // 動画読込中に種目を変えた場合は自動的に先頭(開始A)へ巻き戻して即座に再診断
  if (activeInputSource === "video_pose") {
    reanalyzeUploadedVideo();
  }
}

function onPoseCriteriaModeChange() {
  if (activeInputSource === "video_pose") {
    reanalyzeUploadedVideo();
  }
}

function startImmediateVideoDiagnosis() {
  if (diagnosisTimerId) clearTimeout(diagnosisTimerId);
  resetPoseMaxStats();
  diagnosisFrames = [];
  bestMomentDataUrl = null;
  bestMomentFrameScore = -1;
  isDiagnosing10Sec = true;

  const btn = document.getElementById("poseMeasureBtn");
  if (btn) btn.textContent = "⏳ 動画を自動診断中...（終了時に結果確定）";

  // 動画が10秒より長い場合も最大10秒（または動画終了/区間B到達）で自動集計
  diagnosisTimerId = setTimeout(() => {
    if (isDiagnosing10Sec) finalizePoseDiagnosis();
  }, 10000);
}

function start10SecDiagnosis() {
  ensureAudioContext();
  ensurePoseInitialized();

  // 動画モードならカウントダウンなしで先頭(開始A)へ巻き戻して即時診断
  if (activeInputSource === "video_pose") {
    reanalyzeUploadedVideo();
    return;
  }

  if (activeInputSource !== "camera_pose") {
    alert("先に「📷 AIカメラ起動」を押すか、「📁 動画読込」から動画を選択してください。");
    return;
  }

  runOverlayCountdown(
    "poseCountdownOverlay",
    "poseCountdownNum",
    "poseCountdownLabel",
    3,
    "測定ポジションに構えてください",
    () => {
      resetPoseMaxStats();
      diagnosisFrames = [];
      bestMomentDataUrl = null;
      bestMomentFrameScore = -1;
      isDiagnosing10Sec = true;
      document.getElementById("poseMeasureBtn").textContent = "🔥 10秒間 精密測定中...";
      diagnosisTimerId = setTimeout(() => {
        if (isDiagnosing10Sec) finalizePoseDiagnosis();
      }, 10000);
    }
  );
}

function finalizePoseDiagnosis() {
  isDiagnosing10Sec = false;
  if (diagnosisTimerId) {
    clearTimeout(diagnosisTimerId);
    diagnosisTimerId = null;
  }
  playBeep(1180, 220, "triangle");

  const btn = document.getElementById("poseMeasureBtn");
  if (btn) btn.textContent = "▶️ もう一度測定する（動画は先頭から再診断）";

  const checkKey = document.getElementById("poseCheckTypeSelect").value;
  const criteriaMode = document.getElementById("poseCriteriaModeSelect").value;
  const spec = CHECK_TYPE_SPECS[checkKey] || CHECK_TYPE_SPECS.smash;

  if (diagnosisFrames.length === 0) {
    document.getElementById("aiHeadlineText").textContent =
      "⚠️ 全身の骨格が十分に検出されませんでした";
    document.getElementById("aiTechDetailText").textContent =
      "頭から足首まで全身が画面に入る位置（約3m）で再度お試しください。";
    return;
  }

  // 基準モードに応じた補正係数
  const toleranceBonus = criteriaMode === "junior_basic" ? 8 : criteriaMode === "doubles_front" ? -4 : 0;

  // フレーム集計
  const n = diagnosisFrames.length;
  const half = Math.max(1, Math.floor(n / 2));

  let maxLift = 0;
  let maxElbow = 0;
  let minKnee = 180;
  let avgKnee = 0;
  let avgWrist = 0;
  let avgTilt = 0;
  let maxTilt = 0;
  let racketUpCount = 0;
  let firstHalfRacketUp = 0;
  let secondHalfRacketUp = 0;
  let bounceCount = 0;
  let deepLungeFrames = 0;
  let maxSpeed = 0;

  diagnosisFrames.forEach((f, idx) => {
    if (f.liftAngle > maxLift) maxLift = f.liftAngle;
    if (f.elbowAngle > maxElbow) maxElbow = f.elbowAngle;
    if (f.kneeAngle < minKnee) minKnee = f.kneeAngle;
    avgKnee += f.kneeAngle;
    avgWrist += f.wristAngle;
    avgTilt += f.trunkTiltDeg;
    if (f.trunkTiltDeg > maxTilt) maxTilt = f.trunkTiltDeg;
    if (f.isRacketUp) {
      racketUpCount += 1;
      if (idx < half) firstHalfRacketUp += 1;
      else secondHalfRacketUp += 1;
    }
    if (f.hipVertDelta > 0.042) bounceCount += 1;
    if (f.kneeAngle < 126) deepLungeFrames += 1;
    if (f.speedScore > maxSpeed) maxSpeed = f.speedScore;
  });

  avgKnee = Math.round(avgKnee / n);
  avgWrist = Math.round(avgWrist / n);
  avgTilt = Math.round(avgTilt / n);
  const racketUpRate = Math.round((racketUpCount / n) * 100);
  const firstHalfRate = Math.round((firstHalfRacketUp / half) * 100);
  const secondHalfRate = Math.round((secondHalfRacketUp / Math.max(1, n - half)) * 100);
  const bounceRate = Math.round((bounceCount / n) * 100);
  const deepStayRatio = Math.round((deepLungeFrames / n) * 100);

  // 5局面の個別100点スコア算出
  const isOverhead = ["smash", "high_clear", "drop_cut", "high_serve"].includes(checkKey);

  // 局面1: 打点・肘の伸展
  const liftDiff = Math.abs(maxLift - spec.idealLift);
  const elbowDiff = Math.abs(maxElbow - spec.idealElbow);
  const scoreContact = Math.min(100, Math.max(35, Math.round(100 - liftDiff * 0.75 - elbowDiff * 0.45 + toleranceBonus)));

  // 局面2: ラケット高さ維持＆リストスタンド
  const wristDiff = Math.max(0, spec.idealWrist - avgWrist);
  const scoreRacketWrist = Math.min(
    100,
    Math.max(35, Math.round(racketUpRate * 0.65 + (100 - wristDiff * 1.4) * 0.35 + toleranceBonus))
  );

  // 局面3: 踏み込み（ランジ）の深さ＆上体突っ込み抑止
  const targetKnee = checkKey === "ready_stance" ? avgKnee : minKnee;
  const kneeDiff = Math.abs(targetKnee - spec.idealKnee);
  const tiltPenalty = Math.max(0, maxTilt - 10) * 2.2;
  const scoreLungeTilt = Math.min(100, Math.max(35, Math.round(100 - kneeDiff * 1.15 - tiltPenalty + toleranceBonus)));

  // 局面4: 始動の静かさ（無駄な上下バウンド抑止）
  const scoreUnweight = Math.min(100, Math.max(40, Math.round(100 - bounceRate * 1.6 + toleranceBonus)));

  // 局面5: 蹴り戻しスピード＆後半の姿勢維持
  const lateDropPenalty = Math.max(0, firstHalfRate - secondHalfRate) * 0.55;
  const stayPenalty = checkKey === "footwork_step" && deepStayRatio > 45 ? (deepStayRatio - 45) * 0.8 : 0;
  const scoreRecoverySpeed = Math.min(
    100,
    Math.max(40, Math.round(maxSpeed * 0.75 + 25 - lateDropPenalty - stayPenalty + toleranceBonus))
  );

  // 3大カテゴリ内訳 (40pt / 30pt / 30pt)
  const part1 = Math.round(((isOverhead ? scoreContact * 0.65 + scoreRacketWrist * 0.35 : scoreRacketWrist * 0.7 + scoreContact * 0.3) / 100) * 40);
  const part2 = Math.round(((scoreLungeTilt * 0.7 + scoreUnweight * 0.3) / 100) * 30);
  const part3 = Math.round(((scoreRecoverySpeed * 0.65 + scoreRacketWrist * 0.35) / 100) * 30);
  const totalScore = Math.min(100, Math.max(40, part1 + part2 + part3));

  document.getElementById("poseTotalScoreBadge").textContent = `総合スコア: ${totalScore} pt`;
  document.getElementById("breakdownRow1").innerHTML = `① 上半身・打点＆ラケット高さ (40%): <strong>${part1} / 40 pt</strong>`;
  document.getElementById("breakdownRow2").innerHTML = `② 下半身・膝のタメ＆体幹軸安定度 (30%): <strong>${part2} / 30 pt</strong>`;
  document.getElementById("breakdownRow3").innerHTML = `③ リスト角度・抜重・スイング初速 (30%): <strong>${part3} / 30 pt</strong>`;

  // 5局面から「今回の最大の長所」と「一番足を引っ張った原因（最優先課題）」を特定
  const factorList = [
    {
      key: "low_contact",
      score: isOverhead ? scoreContact : scoreContact + 10,
      goodMsg: `最高打点（肩挙上角 ${maxLift}°・肘伸展 ${maxElbow}°）が非常に高く、威力のあるトップが作れています`
    },
    {
      key: "racket_drop",
      score: scoreRacketWrist,
      goodMsg: `ラケット高さキープ率（${racketUpRate}%）とリストスタンド角（平均 ${avgWrist}°）が安定しています`
    },
    {
      key: "lunge_lean",
      score: scoreLungeTilt,
      goodMsg: `膝の沈み込み（${targetKnee}°）に対して体幹の傾きが最大 ${maxTilt}° 以内に収まり、頭が突っ込まない軸が作れています`
    },
    {
      key: "excess_bounce",
      score: scoreUnweight,
      goodMsg: `待機中の無駄な上下バウンドが少なく（静止安定度 ${scoreUnweight}pt）、スムーズな抜重ができています`
    },
    {
      key: "slow_recovery",
      score: scoreRecoverySpeed,
      goodMsg: `スイング・蹴り戻しの初動速度（指数 ${maxSpeed}pt）が鋭く、後半までフォームが崩れていません`
    }
  ];

  factorList.sort((a, b) => b.score - a.score);
  const bestFactor = factorList[0];
  const worstFactor = factorList[factorList.length - 1];
  const prescription = CAUSE_PRESCRIPTIONS[worstFactor.key] || CAUSE_PRESCRIPTIONS.racket_drop;
  recommendedFwKey = prescription.fwPreset || spec.recommendedFw;

  // 過去ベストとの比較・更新
  const member = getActiveMember();
  const prevBest = member.bests[checkKey];
  let bestDiffText = "（初回ベースライン記録）";
  if (prevBest) {
    const diff = totalScore - prevBest.score;
    bestDiffText = diff >= 0 ? `（自己ベスト +${diff}pt 更新！）` : `（自己ベスト比 ${diff}pt / 最高打点差 ${maxLift - prevBest.maxLift}°）`;
  }

  if (!prevBest || totalScore >= prevBest.score) {
    member.bests[checkKey] = {
      score: totalScore,
      maxLift,
      maxElbow,
      minKnee: targetKnee,
      avgWrist,
      date: new Date().toLocaleDateString("ja-JP")
    };
    saveState();
  }
  updateSavedBestBadge();
  renderMemberBestRecords();

  // 理想 vs 自己ベスト vs 今回の比較テーブル更新
  const currentBest = member.bests[checkKey];
  document.getElementById("poseComparisonTable").innerHTML =
    `🎯 <strong>理想基準</strong>: 打点 ${spec.idealLift}° / 肘 ${spec.idealElbow}° / 膝 ${spec.idealKnee}° / 手首 ${spec.idealWrist}°<br/>` +
    `🏆 <strong>自己ベスト (${currentBest.score}pt)</strong>: 打点 ${currentBest.maxLift}° / 肘 ${currentBest.maxElbow}° / 膝 ${currentBest.minKnee}°<br/>` +
    `📍 <strong>今回の測定 (${totalScore}pt)</strong>: 打点 ${maxLift}° / 肘 ${maxElbow}° / 膝 ${targetKnee}° / ラケット維持 ${racketUpRate}% ${bestDiffText}`;

  // 後半のスタミナ・集中力変化コメント
  const staminaNote =
    firstHalfRate - secondHalfRate >= 18
      ? `また、測定の前半（ラケット維持 ${firstHalfRate}%）に比べて後半（${secondHalfRate}%）に手が下がる傾向が見られます。`
      : `測定の前半から後半まで（維持率 ${firstHalfRate}% ➔ ${secondHalfRate}%）集中力が途切れず安定しています。`;

  // 原因特定型AIフィードバック表示
  document.getElementById("aiHeadlineText").textContent =
    `📌 診断結果：${totalScore} pt ｜ 最優先課題「${prescription.causeName}」`;
  document.getElementById("aiTechDetailText").innerHTML =
    `<strong>【最大の長所】</strong> ${bestFactor.goodMsg}。<br/>` +
    `<strong>【減点の主原因】</strong> 今回は5局面のうち「${prescription.causeName}（評価 ${worstFactor.score}pt）」が最もスコアを押し下げています。${staminaNote}`;

  document.getElementById("aiJuniorSenseText").textContent = prescription.juniorSense;
  document.getElementById("aiDrillTitle").textContent = prescription.drillTitle;
  document.getElementById("aiDrillStep1").innerHTML = `<strong>${prescription.step1.split(":")[0]}:</strong>${prescription.step1.split(":")[1]}`;
  document.getElementById("aiDrillStep2").innerHTML = `<strong>${prescription.step2.split(":")[0]}:</strong>${prescription.step2.split(":")[1]}`;
  document.getElementById("aiDrillStep3").innerHTML = `<strong>${prescription.step3.split(":")[0]}:</strong>${prescription.step3.split(":")[1]}`;

  const jumpBtn = document.getElementById("aiJumpFwBtn");
  if (jumpBtn) jumpBtn.style.display = "inline-flex";

  // 自動キャプチャ画像の表示
  const capBox = document.getElementById("bestCaptureBox");
  if (bestMomentDataUrl && capBox) {
    document.getElementById("bestCaptureImg").src = bestMomentDataUrl;
    document.getElementById("bestCaptureDownload").href = bestMomentDataUrl;
    capBox.classList.add("show");
  }
}

function updateSavedBestBadge() {
  const member = getActiveMember();
  const checkKey = document.getElementById("poseCheckTypeSelect").value;
  const best = member.bests && member.bests[checkKey];
  const badge = document.getElementById("poseBestBadge");
  if (badge) {
    badge.textContent = best ? `🏆 過去ベスト: ${best.score} pt (${best.maxLift}°)` : "🏆 過去ベスト: -- pt";
  }
}

function jumpToRecommendedFootwork() {
  switchTab("tab-footwork");
  const sel = document.getElementById("fwPatternSelect");
  if (sel) {
    sel.value = recommendedFwKey;
    applyFwPreset();
  }
  const durSel = document.getElementById("fwModeDurationSelect");
  if (durSel) durSel.value = "time_30";
}

/* ---------------------------------------------------------
   10. TAB 2: 初速AI判定（ミリ秒リアクション ＆ 待機中の構え同時チェック）
   --------------------------------------------------------- */
let rxRunning = false;
let rxTimerId = null;
let rxWaitingMovement = false;
let rxCueTime = 0;
let rxCurrentDir = "";
let rxBaseHipX = null;
let rxBaseHipY = null;
let rxResults = [];
let rxStanceSamples = [];

async function toggleReactionCamera() {
  ensurePoseInitialized();
  stopUploadedVideoOnly();

  if (activeInputSource === "camera_rx" && cameraStream) {
    stopCameraStreamOnly();
    activeInputSource = "idle";
    document.getElementById("rxCamBtn").textContent = "📷 カメラ起動";
    document.getElementById("rxPlaceholder").classList.remove("hidden");
    return;
  }

  try {
    stopCameraStreamOnly();
    const stream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: "user", width: { ideal: 640 }, height: { ideal: 480 } },
      audio: false
    });
    cameraStream = stream;
    const camVid = document.getElementById("cameraVideo");
    camVid.srcObject = stream;
    await camVid.play();

    activeInputSource = "camera_rx";
    document.getElementById("rxPlaceholder").classList.add("hidden");
    document.getElementById("rxCamBtn").textContent = "⏹️ カメラ停止";
    ensureVisionLoop();
  } catch (e) {
    alert("カメラの起動に失敗しました。");
  }
}

function startReactionDrill() {
  stopReactionDrill();
  ensureAudioContext();
  requestWakeLock();

  const totalCount = Number(document.getElementById("rxCountSelect").value || 8);
  rxRunning = true;
  rxResults = [];
  rxStanceSamples = [];
  let currentTrial = 0;

  document.getElementById("rxStatusBadge").textContent = `⚡ 測定中 (0/${totalCount})`;
  document.getElementById("rxDirectionDisplay").textContent = "🛡️ センターに静かに構えて待機...";

  const scheduleNextTrial = () => {
    if (!rxRunning) return;
    if (currentTrial >= totalCount) {
      finishReactionDrill();
      return;
    }

    rxWaitingMovement = false;
    document.getElementById("rxDirectionDisplay").textContent = "👀 構えて待ってください...";

    const randomWaitMs = 1500 + Math.random() * 1900;
    rxTimerId = setTimeout(() => {
      if (!rxRunning) return;
      currentTrial += 1;
      const dirs = [
        { key: "right", label: "➡️ 右（フォア側）！" },
        { key: "left", label: "⬅️ 左（バック/ラウンド側）！" },
        { key: "front_r", label: "↗️ 右前（ネット前）！" },
        { key: "front_l", label: "↖️ 左前（ネット前）！" }
      ];
      const chosen = dirs[Math.floor(Math.random() * dirs.length)];
      rxCurrentDir = chosen.key;
      document.getElementById("rxDirectionDisplay").textContent = chosen.label;
      document.getElementById("rxStatusBadge").textContent = `⚡ 測定中 (${currentTrial}/${totalCount})`;
      playBeep(980, 100, "triangle");

      rxCueTime = performance.now();
      if (latestLandmarks) {
        const lHip = latestLandmarks[23];
        const rHip = latestLandmarks[24];
        rxBaseHipX = (lHip.x + rHip.x) / 2;
        rxBaseHipY = (lHip.y + rHip.y) / 2;
        rxWaitingMovement = true;
      } else {
        // カメラ未起動時は自動テンポ送り
        setTimeout(scheduleNextTrial, 1400);
      }
    }, randomWaitMs);
  };

  scheduleNextTrial();
  window._rxNextCallback = scheduleNextTrial;
}

function stopReactionDrill() {
  rxRunning = false;
  rxWaitingMovement = false;
  if (rxTimerId) {
    clearTimeout(rxTimerId);
    rxTimerId = null;
  }
  document.getElementById("rxStatusBadge").textContent = "⚡ 初速AI待機中";
}

function finishReactionDrill() {
  rxRunning = false;
  rxWaitingMovement = false;
  playBeep(1240, 220, "triangle");

  if (rxResults.length === 0) {
    document.getElementById("rxDirectionDisplay").textContent = "✅ リアクション練習完了！";
    return;
  }

  const times = rxResults.map(r => r.ms);
  const best = Math.min(...times);
  const avg = Math.round(times.reduce((a, b) => a + b, 0) / times.length);

  const rightTimes = rxResults.filter(r => r.dir.includes("r")).map(r => r.ms);
  const leftTimes = rxResults.filter(r => r.dir.includes("l")).map(r => r.ms);
  const avgR = rightTimes.length ? Math.round(rightTimes.reduce((a, b) => a + b, 0) / rightTimes.length) : avg;
  const avgL = leftTimes.length ? Math.round(leftTimes.reduce((a, b) => a + b, 0) / leftTimes.length) : avg;

  const avgStance = rxStanceSamples.length
    ? Math.round(rxStanceSamples.reduce((a, b) => a + b, 0) / rxStanceSamples.length)
    : 85;

  document.getElementById("rxBestMs").textContent = `${best} ms`;
  document.getElementById("rxAvgMs").textContent = `平均: ${avg} ms (${rxResults.length}回)`;
  document.getElementById("rxDirDiff").textContent = `右:${avgR}ms / 左:${avgL}ms`;
  document.getElementById("rxStanceScore").textContent = `${avgStance} pt`;

  const diffRL = Math.abs(avgR - avgL);
  const slowerSide = avgL > avgR ? "左（バック・ラウンド側）" : "右（フォア側）";
  document.getElementById("rxWeakDir").textContent =
    diffRL >= 25 ? `⚠️ ${slowerSide}が ${diffRL}ms 遅め` : "🟢 左右バランス良好";

  document.getElementById("rxDirectionDisplay").textContent = `🎉 測定完了！ 平均 ${avg}ms / 最速 ${best}ms`;

  // ジュニア向け具体的な初速フィードバック生成
  let advice = "";
  if (avgStance < 75) {
    advice =
      `🗣️ <strong>待っている間の構えに注意！</strong>（構え安定度 ${avgStance}pt）：矢印を待つ間にラケットが下がるか、小刻みに跳ねるクセが出ています。ピタッと静かに待って「膝の力を抜く（抜重）」だけで一歩目がさらに30ms速くなります！`;
  } else if (diffRL >= 25) {
    advice =
      `🗣️ <strong>左右の反応差を発見！</strong>：右方向（${avgR}ms）に比べて、<strong>${slowerSide}への一歩目（${Math.max(avgR, avgL)}ms）が ${diffRL}ms 遅れています</strong>。${slowerSide}へ出る時に頭が先に倒れず、反対側の足で床を強く蹴り出す練習を取り入れましょう！`;
  } else {
    advice =
      `🗣️ <strong>素晴らしい初動リアクションです！</strong>：左右の反応差も少なく（右 ${avgR}ms / 左 ${avgL}ms）、静かな構えから素早く抜重できています。この感覚のまま6点フットワークへ繋げましょう！`;
  }
  document.getElementById("rxJuniorAdvice").innerHTML = advice;
}

/* ---------------------------------------------------------
   11. リアルタイム描画＆骨格レーザーガイド・ループ
   --------------------------------------------------------- */
function ensureVisionLoop() {
  if (visionLoopActive) return;
  visionLoopActive = true;
  requestAnimationFrame(visionRenderTick);
}

async function visionRenderTick() {
  if (activeInputSource === "idle") {
    visionLoopActive = false;
    return;
  }

  const isPoseTab = activeInputSource === "camera_pose" || activeInputSource === "video_pose";
  const videoEl =
    activeInputSource === "video_pose"
      ? document.getElementById("uploadedVideo")
      : document.getElementById("cameraVideo");
  const canvasEl = isPoseTab
    ? document.getElementById("poseCanvas")
    : document.getElementById("rxCanvas");

  if (videoEl && canvasEl && videoEl.readyState >= 2) {
    if (activeInputSource === "video_pose") {
      updateVideoTimeUI();
    }

    // MediaPipeへフレーム送信（多重送信ロック付き）
    if (isPoseReady && !isProcessingPoseFrame) {
      isProcessingPoseFrame = true;
      try {
        await poseInstance.send({ image: videoEl });
      } catch (_) {}
      isProcessingPoseFrame = false;
    }

    drawVisionStage(videoEl, canvasEl, isPoseTab);
  }

  requestAnimationFrame(visionRenderTick);
}

function drawVisionStage(videoEl, canvasEl, isPoseTab) {
  const ctx = canvasEl.getContext("2d");
  const w = canvasEl.width;
  const h = canvasEl.height;

  ctx.clearRect(0, 0, w, h);

  // ディレイ再生モード対応
  if (isPoseTab && activeInputSource === "camera_pose" && delaySeconds > 0) {
    const offscreen = document.createElement("canvas");
    offscreen.width = w;
    offscreen.height = h;
    offscreen.getContext("2d").drawImage(videoEl, 0, 0, w, h);
    const now = performance.now();
    delayFrameQueue.push({ time: now, canvas: offscreen });
    while (delayFrameQueue.length > 1 && now - delayFrameQueue[0].time > delaySeconds * 1000) {
      delayFrameQueue.shift();
    }
    ctx.drawImage(delayFrameQueue[0].canvas, 0, 0, w, h);
  } else {
    ctx.drawImage(videoEl, 0, 0, w, h);
  }

  if (!latestLandmarks) return;

  const bio = computeFrameBiomechanics(latestLandmarks);

  if (isPoseTab) {
    updatePoseLiveMetricsUI(bio);
    drawPoseOverlays(ctx, w, h, latestLandmarks, bio);

    if (isDiagnosing10Sec) {
      diagnosisFrames.push(bio);
      const instantScore = bio.liftAngle * 0.45 + bio.speedScore * 0.35 + (bio.isRacketUp ? 25 : 0);
      if (instantScore > bestMomentFrameScore) {
        bestMomentFrameScore = instantScore;
        try {
          bestMomentDataUrl = canvasEl.toDataURL("image/png");
        } catch (_) {}
      }
    }
  } else {
    // 初速AIタブの待機中構えチェック＆初動検知
    processReactionFrame(ctx, w, h, latestLandmarks, bio);
  }
}

function updatePoseLiveMetricsUI(bio) {
  document.getElementById("mVal1").textContent = `${bio.elbowAngle}°`;
  document.getElementById("mSub1").textContent = `MAX: ${poseMaxStats.maxElbow}° / 最小: ${poseMaxStats.minElbow === 180 ? "--" : poseMaxStats.minElbow}°`;
  document.getElementById("mScore1").textContent = `リスト角: ${bio.wristAngle}°`;

  document.getElementById("mVal2").textContent = `${bio.liftAngle}°`;
  document.getElementById("mSub2").textContent = `MAX最高打点: ${poseMaxStats.maxLift}°`;
  document.getElementById("mScore2").textContent = bio.isRacketUp ? "🟢 ラケット高位置キープ" : "⚠️ ラケット低下注意";

  document.getElementById("mVal3").textContent = `${bio.kneeAngle}°`;
  document.getElementById("mSub3").textContent = `最深タメ: ${poseMaxStats.minKnee === 180 ? "--" : poseMaxStats.minKnee}°`;
  document.getElementById("mScore3").textContent = `スタンス比: ${bio.stanceRatio}倍`;

  document.getElementById("mVal4").textContent = `${bio.speedScore} pt`;
  document.getElementById("mSub4").textContent = `手首角: ${bio.wristAngle}° / 軸傾き: ${bio.trunkTiltDeg}°`;
  document.getElementById("mScore4").textContent = `MAX速度: ${poseMaxStats.maxSpeedPt} pt`;
}

function drawPoseOverlays(ctx, w, h, lm, bio) {
  const guideMode = document.getElementById("poseGuideModeSelect").value;
  const checkKey = document.getElementById("poseCheckTypeSelect").value;
  const spec = CHECK_TYPE_SPECS[checkKey] || CHECK_TYPE_SPECS.smash;

  // 1. 身体追従レーザーガイド（肩から理想打点角度レーザー ＆ みぞおちラケット高さライン）
  if (guideMode === "both" || guideMode === "laser") {
    const sx = bio.shoulder.x * w;
    const sy = bio.shoulder.y * h;
    const idealRad = ((-spec.idealLift + 90) * Math.PI) / 180;
    const tx = sx + Math.cos(idealRad) * 135;
    const ty = sy - Math.sin(idealRad) * 135;

    ctx.save();
    ctx.strokeStyle = "rgba(56, 189, 248, 0.85)";
    ctx.lineWidth = 3;
    ctx.setLineDash([6, 4]);
    ctx.beginPath();
    ctx.moveTo(sx, sy);
    ctx.lineTo(tx, ty);
    ctx.stroke();

    // ラケット高さ基準の水平レーザーライン
    const stY = bio.sternumY * h;
    ctx.strokeStyle = bio.isRacketUp ? "rgba(16, 185, 129, 0.75)" : "rgba(244, 63, 94, 0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(w * 0.15, stY);
    ctx.lineTo(w * 0.85, stY);
    ctx.stroke();
    ctx.restore();
  }

  // 2. 現在の骨格ライン描画
  const connections = [
    [11, 12], [11, 13], [13, 15], [12, 14], [14, 16],
    [11, 23], [12, 24], [23, 24],
    [23, 25], [25, 27], [24, 26], [26, 28]
  ];

  ctx.save();
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = bio.isRacketUp ? "#10b981" : "#f5c451";
  connections.forEach(([i, j]) => {
    const p1 = lm[i];
    const p2 = lm[j];
    if (p1 && p2 && p1.visibility > 0.35 && p2.visibility > 0.35) {
      ctx.beginPath();
      ctx.moveTo(p1.x * w, p1.y * h);
      ctx.lineTo(p2.x * w, p2.y * h);
      ctx.stroke();
    }
  });

  // 主要関節ポイント
  [bio.shoulder, bio.elbow, bio.wrist, bio.hip, bio.knee, bio.ankle].forEach(pt => {
    if (!pt) return;
    ctx.fillStyle = "#38bdf8";
    ctx.beginPath();
    ctx.arc(pt.x * w, pt.y * h, 5.5, 0, Math.PI * 2);
    ctx.fill();
  });
  ctx.restore();
}

function processReactionFrame(ctx, w, h, lm, bio) {
  drawPoseOverlays(ctx, w, h, lm, bio);

  // 待機中の構えスコア算出
  const stancePt =
    (bio.isRacketUp ? 45 : 15) +
    (bio.kneeAngle >= 125 && bio.kneeAngle <= 156 ? 35 : 15) +
    (bio.hipVertDelta < 0.04 ? 20 : 5);
  rxStanceSamples.push(stancePt);

  const banner = document.getElementById("rxStanceLiveBanner");
  if (banner) {
    if (!bio.isRacketUp) {
      banner.textContent = "⚠️ 待機中：ラケット（手首）が下がっています！胸の前へ上げよう";
      banner.style.color = "#fda4af";
    } else if (bio.kneeAngle > 160) {
      banner.textContent = "⚠️ 待機中：膝が伸びて棒立ちになっています！少し膝を緩めよう";
      banner.style.color = "#fde047";
    } else {
      banner.textContent = `🟢 構え良好（ラケット高位置キープ・膝 ${bio.kneeAngle}°）`;
      banner.style.color = "#6ee7b7";
    }
  }

  if (rxWaitingMovement && rxBaseHipX !== null) {
    const lHip = lm[23];
    const rHip = lm[24];
    const curX = (lHip.x + rHip.x) / 2;
    const curY = (lHip.y + rHip.y) / 2;
    const dist = Math.hypot(curX - rxBaseHipX, curY - rxBaseHipY);

    if (dist > 0.036) {
      const reactMs = Math.max(110, Math.round(performance.now() - rxCueTime));
      rxWaitingMovement = false;
      rxResults.push({ ms: reactMs, dir: rxCurrentDir });
      document.getElementById("rxLastMs").textContent = `${reactMs} ms`;
      document.getElementById("rxLastJudge").textContent =
        reactMs <= 220 ? "🔥 超速リアクション！" : reactMs <= 280 ? "🟢 良好な初速" : "🐢 抜重を意識しよう";
      playBeep(1320, 80, "sine");

      if (typeof window._rxNextCallback === "function") {
        setTimeout(window._rxNextCallback, 900);
      }
    }
  }
}

/* ---------------------------------------------------------
   12. 画面上の線引き（ドローイング）モード（OFF時はスクロール優先）
   --------------------------------------------------------- */
let isDrawModeOn = false;
let drawStrokeColor = "#f43f5e";
let isDrawingNow = false;

function toggleDrawMode() {
  isDrawModeOn = !isDrawModeOn;
  const drawCv = document.getElementById("drawCanvas");
  const btn = document.getElementById("drawToggleBtn");
  if (drawCv) drawCv.classList.toggle("drawing-enabled", isDrawModeOn);
  if (btn) {
    btn.textContent = isDrawModeOn
      ? "✏️ 線引きモード: ON (画面に描画中)"
      : "✏️ 線引きモード: OFF (スクロール優先)";
  }
}

function setDrawColor(color, dotEl) {
  drawStrokeColor = color;
  document.querySelectorAll(".color-dot").forEach(d => d.classList.remove("active"));
  if (dotEl) dotEl.classList.add("active");
}

function clearDrawingCanvas() {
  const drawCv = document.getElementById("drawCanvas");
  if (!drawCv) return;
  drawCv.getContext("2d").clearRect(0, 0, drawCv.width, drawCv.height);
}

function initDrawingCanvasEvents() {
  const drawCv = document.getElementById("drawCanvas");
  if (!drawCv) return;
  const ctx = drawCv.getContext("2d");

  const getPt = e => {
    const rect = drawCv.getBoundingClientRect();
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    return {
      x: ((clientX - rect.left) / rect.width) * drawCv.width,
      y: ((clientY - rect.top) / rect.height) * drawCv.height
    };
  };

  const start = e => {
    if (!isDrawModeOn) return;
    e.preventDefault();
    isDrawingNow = true;
    const pt = getPt(e);
    ctx.strokeStyle = drawStrokeColor;
    ctx.lineWidth = 4;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(pt.x, pt.y);
  };

  const move = e => {
    if (!isDrawModeOn || !isDrawingNow) return;
    e.preventDefault();
    const pt = getPt(e);
    ctx.lineTo(pt.x, pt.y);
    ctx.stroke();
  };

  const end = () => {
    isDrawingNow = false;
  };

  drawCv.addEventListener("mousedown", start);
  drawCv.addEventListener("mousemove", move);
  window.addEventListener("mouseup", end);
  drawCv.addEventListener("touchstart", start, { passive: false });
  drawCv.addEventListener("touchmove", move, { passive: false });
  window.addEventListener("touchend", end);
}

/* ---------------------------------------------------------
   13. TAB 4: ラケット＆ガット相性診断（YONEX / Mizuno / GOSEN / LI-NING）
   --------------------------------------------------------- */
const RACKET_CATALOG = [
  {
    brand: "YONEX",
    name: "NANOFLARE 800 GAME (ナノフレア800ゲーム)",
    styles: ["speed_drive", "all_control", "junior_stepup"],
    swings: ["fast", "medium"],
    stringRec: "EXBOLT 65 (エクスボルト65) / 22〜25 lbs",
    desc: "極細カミソリフレームによる圧倒的な振り抜きの速さと、ドライブ・プッシュの鋭い弾きを両立。エクスボルト65との組み合わせで球持ちと弾きのバランスが最高峰に仕上がります。"
  },
  {
    brand: "YONEX",
    name: "ASTROX 88D GAME / PRO (アストロクス88D)",
    styles: ["power_smash", "all_control"],
    swings: ["fast", "medium"],
    stringRec: "EXBOLT 65 または AEROBITE / 23〜26 lbs",
    desc: "後衛からの角度のあるパワースマッシュと、相手のレシーブを押し込む重い球質を実現する攻撃型モデル。"
  },
  {
    brand: "YONEX",
    name: "ARCSABER 11 PLAY / PRO (アークセイバー11)",
    styles: ["all_control", "junior_stepup"],
    swings: ["medium", "smooth"],
    stringRec: "EXBOLT 63 または BG66 ULTIMAX / 21〜24 lbs",
    desc: "シャトルを面でくわえ込むホールド感に優れ、コースを突くクリアやカット、レシーブの安定感が抜群のコントロールモデル。"
  },
  {
    brand: "Mizuno",
    name: "ACROSPEED 0 / 1 DRIVE (アクロスピード)",
    styles: ["speed_drive", "junior_stepup"],
    swings: ["fast", "medium", "smooth"],
    stringRec: "M-SMOOTH 65H / 21〜24 lbs",
    desc: "ミズノ独自のエネルギーフレーム設計により、小さな振りのリストワークでも鋭く弾き返すスピード系ラケット。"
  },
  {
    brand: "GOSEN",
    name: "GRAVITAS / INFERNO SMART (インフェルノ スマート)",
    styles: ["all_control", "speed_drive"],
    swings: ["medium", "smooth"],
    stringRec: "G-TONE 5 (ジートーン5) / 21〜24 lbs",
    desc: "独特のフレーム形状で振り抜き抵抗を極限まで減らし、連続ドライブや前衛の素早いタッチに強いモデル。"
  },
  {
    brand: "LI-NING",
    name: "HALBERTEC 8000 / BLADEX 700",
    styles: ["speed_drive", "power_smash", "all_control"],
    swings: ["fast", "medium"],
    stringRec: "LI-NING No.1 または EXBOLT 65 / 23〜26 lbs",
    desc: "高弾性カーボンによる強い復元力で、高速ラリーの中のカウンタードライブやスマッシュ連打に威力を発揮します。"
  }
];

function runRacketDiagnosis() {
  const style = document.getElementById("rkStyleSelect").value;
  const swing = document.getElementById("rkSwingSelect").value;
  const brand = document.getElementById("rkBrandSelect").value;

  let matched = RACKET_CATALOG.filter(r => {
    const brandOk = brand === "ALL" || r.brand === brand;
    const styleOk = r.styles.includes(style);
    const swingOk = r.swings.includes(swing);
    return brandOk && (styleOk || swingOk);
  });

  if (matched.length === 0) matched = RACKET_CATALOG.slice(0, 3);

  const container = document.getElementById("racketResultList");
  container.innerHTML = matched
    .map(
      r => `
      <div class="diagnosis-card" style="margin-top:0;">
        <div style="display:flex; justify-content:space-between; align-items:center; gap:6px; flex-wrap:wrap;">
          <span style="font-weight:900; color:var(--gold-bright); font-size:0.9rem;">🏸 [${r.brand}] ${r.name}</span>
          <span class="badge">推奨ガット: ${r.stringRec}</span>
        </div>
        <div style="font-size:0.8rem; color:#e2e8f0; margin-top:6px;">${r.desc}</div>
      </div>
    `
    )
    .join("");
}

/* ---------------------------------------------------------
   14. TAB 5: スコア＆サーブ位置ナビ（シングルス/ダブルス/Undo完全対応）
   --------------------------------------------------------- */
let matchFormat = "doubles"; // 'doubles' | 'singles'
let scoreA = 0;
let scoreB = 0;
let servingTeam = "A";
let posA = { right: 0, left: 1 }; // 0: playerA1, 1: playerA2
let posB = { right: 0, left: 1 };
let scoreHistory = [];

function toggleMatchFormat() {
  matchFormat = matchFormat === "doubles" ? "singles" : "doubles";
  document.getElementById("matchTypeBtn").textContent =
    matchFormat === "doubles" ? "👥 ダブルス" : "👤 シングルス";
  document.getElementById("playerA2").style.display = matchFormat === "doubles" ? "block" : "none";
  document.getElementById("playerB2").style.display = matchFormat === "doubles" ? "block" : "none";
  resetScoreMatch();
}

function addPoint(winner) {
  scoreHistory.push({
    scoreA,
    scoreB,
    servingTeam,
    posA: { ...posA },
    posB: { ...posB }
  });

  if (winner === "A") {
    scoreA += 1;
    if (servingTeam === "A" && matchFormat === "doubles") {
      const tmp = posA.right;
      posA.right = posA.left;
      posA.left = tmp;
    }
    servingTeam = "A";
  } else {
    scoreB += 1;
    if (servingTeam === "B" && matchFormat === "doubles") {
      const tmp = posB.right;
      posB.right = posB.left;
      posB.left = tmp;
    }
    servingTeam = "B";
  }
  renderServiceCourt();
}

function undoScore() {
  if (scoreHistory.length === 0) return;
  const prev = scoreHistory.pop();
  scoreA = prev.scoreA;
  scoreB = prev.scoreB;
  servingTeam = prev.servingTeam;
  posA = prev.posA;
  posB = prev.posB;
  renderServiceCourt();
}

function resetScoreMatch() {
  scoreA = 0;
  scoreB = 0;
  servingTeam = "A";
  posA = { right: 0, left: 1 };
  posB = { right: 0, left: 1 };
  scoreHistory = [];
  renderServiceCourt();
}

function renderServiceCourt() {
  document.getElementById("scoreNumA").textContent = String(scoreA);
  document.getElementById("scoreNumB").textContent = String(scoreB);
  document.getElementById("teamBoxA").classList.toggle("serving", servingTeam === "A");
  document.getElementById("teamBoxB").classList.toggle("serving", servingTeam === "B");

  const namesA = [
    document.getElementById("playerA1").value || "A1",
    document.getElementById("playerA2").value || "A2"
  ];
  const namesB = [
    document.getElementById("playerB1").value || "B1",
    document.getElementById("playerB2").value || "B2"
  ];

  const serverScore = servingTeam === "A" ? scoreA : scoreB;
  const isEven = serverScore % 2 === 0;

  const boxAL = document.getElementById("courtPosALeft");
  const boxAR = document.getElementById("courtPosARight");
  const boxBL = document.getElementById("courtPosBLeft");
  const boxBR = document.getElementById("courtPosBRight");

  [boxAL, boxAR, boxBL, boxBR].forEach(b => {
    b.classList.remove("server-box", "receiver-box");
  });

  if (matchFormat === "singles") {
    boxAR.innerHTML = `<div style="font-size:0.72rem; color:#cbd5e1;">自コート右(偶数)</div><strong>${isEven ? namesA[0] : "—"}</strong>`;
    boxAL.innerHTML = `<div style="font-size:0.72rem; color:#cbd5e1;">自コート左(奇数)</div><strong>${!isEven ? namesA[0] : "—"}</strong>`;
    boxBL.innerHTML = `<div style="font-size:0.72rem; color:#cbd5e1;">相手右(偶数)</div><strong>${isEven ? namesB[0] : "—"}</strong>`;
    boxBR.innerHTML = `<div style="font-size:0.72rem; color:#cbd5e1;">相手左(奇数)</div><strong>${!isEven ? namesB[0] : "—"}</strong>`;
  } else {
    boxAR.innerHTML = `<div style="font-size:0.72rem; color:#cbd5e1;">自コート右(偶数)</div><strong>${namesA[posA.right]}</strong>`;
    boxAL.innerHTML = `<div style="font-size:0.72rem; color:#cbd5e1;">自コート左(奇数)</div><strong>${namesA[posA.left]}</strong>`;
    boxBL.innerHTML = `<div style="font-size:0.72rem; color:#cbd5e1;">相手コート右(偶数)</div><strong>${namesB[posB.right]}</strong>`;
    boxBR.innerHTML = `<div style="font-size:0.72rem; color:#cbd5e1;">相手コート左(奇数)</div><strong>${namesB[posB.left]}</strong>`;
  }

  let serverName = "";
  let receiverName = "";

  if (servingTeam === "A") {
    if (isEven) {
      boxAR.classList.add("server-box");
      boxBL.classList.add("receiver-box");
      serverName = matchFormat === "singles" ? namesA[0] : namesA[posA.right];
      receiverName = matchFormat === "singles" ? namesB[0] : namesB[posB.right];
    } else {
      boxAL.classList.add("server-box");
      boxBR.classList.add("receiver-box");
      serverName = matchFormat === "singles" ? namesA[0] : namesA[posA.left];
      receiverName = matchFormat === "singles" ? namesB[0] : namesB[posB.left];
    }
  } else {
    if (isEven) {
      boxBL.classList.add("server-box");
      boxAR.classList.add("receiver-box");
      serverName = matchFormat === "singles" ? namesB[0] : namesB[posB.right];
      receiverName = matchFormat === "singles" ? namesA[0] : namesA[posA.right];
    } else {
      boxBR.classList.add("server-box");
      boxAL.classList.add("receiver-box");
      serverName = matchFormat === "singles" ? namesB[0] : namesB[posB.left];
      receiverName = matchFormat === "singles" ? namesA[0] : namesA[posA.left];
    }
  }

  document.getElementById("serveGuideHeadline").textContent =
    `🏸 サーバー: ${serverName} ➔ レシーバー: ${receiverName}`;
  document.getElementById("serveGuideDetail").textContent =
    `${servingTeam === "A" ? "自チーム" : "相手チーム"}が ${serverScore}点（${isEven ? "偶数＝右サービスコート" : "奇数＝左サービスコート"}）から対角線へサーブします。`;
}

/* ---------------------------------------------------------
   15. TAB 6: メンバー管理 ＆ iPhone⇄iPad同期コード書き出し/読み込み
   --------------------------------------------------------- */
function renderMemberDropdown() {
  const sel = document.getElementById("memberSelectDropdown");
  if (!sel) return;
  sel.innerHTML = appState.members
    .map(
      m =>
        `<option value="${m.id}" ${m.id === appState.activeMemberId ? "selected" : ""}>${m.name} (${m.hand === "left" ? "左利き" : "右利き"})</option>`
    )
    .join("");

  const active = getActiveMember();
  document.getElementById("headerMemberName").textContent = active.name;
  document.getElementById("headerMemberHand").textContent = active.hand === "left" ? "左利き" : "右利き";
  updateSavedBestBadge();
  renderMemberBestRecords();
}

function selectActiveMember(memberId) {
  appState.activeMemberId = memberId;
  saveState();
  renderMemberDropdown();
}

function addNewMember() {
  const nameInput = document.getElementById("newMemberName");
  const handSelect = document.getElementById("newMemberHand");
  const name = (nameInput.value || "").trim();
  if (!name) {
    alert("選手名を入力してください。");
    return;
  }
  const id = "m_" + Date.now();
  appState.members.push({
    id,
    name,
    hand: handSelect.value || "right",
    bests: {}
  });
  appState.activeMemberId = id;
  nameInput.value = "";
  saveState();
  renderMemberDropdown();
}

function deleteCurrentMember() {
  if (appState.members.length <= 1) {
    alert("最低1名の選手データが必要です。");
    return;
  }
  appState.members = appState.members.filter(m => m.id !== appState.activeMemberId);
  appState.activeMemberId = appState.members[0].id;
  saveState();
  renderMemberDropdown();
}

function renderMemberBestRecords() {
  const member = getActiveMember();
  const listEl = document.getElementById("memberBestRecordsList");
  if (!listEl) return;

  const entries = Object.entries(member.bests || {});
  if (entries.length === 0) {
    listEl.innerHTML = `<div style="color:var(--text-sub);">まだ測定記録がありません。「🎥 3.構え＆骨格AI」で測定すると自動保存されます。</div>`;
    return;
  }

  listEl.innerHTML = entries
    .map(([key, rec]) => {
      const spec = CHECK_TYPE_SPECS[key];
      const name = spec ? spec.title : key;
      return `<div>🏅 <strong>${name}</strong>: <strong>${rec.score} pt</strong> (最高打点 ${rec.maxLift}° / 膝 ${rec.minKnee}° / ${rec.date || ""})</div>`;
    })
    .join("");
}

function exportSyncData() {
  const jsonStr = JSON.stringify(appState);
  const encoded = btoa(unescape(encodeURIComponent(jsonStr)));
  const area = document.getElementById("syncDataTextarea");
  area.value = encoded;
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(encoded).catch(() => {});
  }
  alert("引き継ぎコードを作成し、クリップボードにコピーしました！iPadや別端末の同じ欄に貼り付けて「読み込む」を押してください。");
}

function importSyncData() {
  const area = document.getElementById("syncDataTextarea");
  const raw = (area.value || "").trim();
  if (!raw) {
    alert("引き継ぎコードをテキスト欄に貼り付けてください。");
    return;
  }
  try {
    const jsonStr = decodeURIComponent(escape(atob(raw)));
    const parsed = JSON.parse(jsonStr);
    if (Array.isArray(parsed.members) && parsed.members.length > 0) {
      appState = parsed;
      saveState();
      renderMemberDropdown();
      alert("データの引き継ぎが完了しました！");
    } else {
      alert("コードの形式が正しくありません。");
    }
  } catch (e) {
    alert("コードの読み込みに失敗しました。全文がコピーされているか確認してください。");
  }
}

/* ---------------------------------------------------------
   16. アプリ初期起動処理
   --------------------------------------------------------- */
window.addEventListener("DOMContentLoaded", () => {
  loadState();
  renderMemberDropdown();
  renderFwZoneStates();
  initDrawingCanvasEvents();
  runRacketDiagnosis();
  renderServiceCourt();
});
