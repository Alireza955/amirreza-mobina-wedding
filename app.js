const $ = (selector) => document.querySelector(selector);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const range = (value, start, end) => clamp((value - start) / (end - start));
const mix = (from, to, progress) => from + (to - from) * progress;
const VIDEO_FPS = 24;
const FRAME_DURATION = 1 / VIDEO_FPS;
const MIN_SEEK_INTERVAL_MS = 70;
const ANDROID_FRAME_COUNT = 56;
const ANDROID_FRAME_FPS = 8;
const forceFrameMode = new URLSearchParams(window.location.search).has("forceFrames");
const isAndroidFrameMode = /Android/i.test(navigator.userAgent) || forceFrameMode;

const dom = {
  body: document.body,
  loader: $("#loader"),
  loaderPercent: $("#loaderPercent"),
  experience: $("#experience"),
  film: $("#weddingFilm"),
  frameCanvas: $("#frameCanvas"),
  filmLayer: $("#filmLayer"),
  filmShade: $(".film-shade"),
  cardLayer: $("#cardLayer"),
  scrollCue: $("#scrollCue"),
  scrollMessage: $("#scrollMessage"),
  scrollProgress: $("#scrollProgress"),
  startButton: $("#startButton"),
  music: $("#backgroundMusic"),
  soundToggle: $("#soundToggle"),
  soundIcon: $(".sound-button__icon"),
};

const state = {
  duration: 7.072,
  targetTime: 0,
  renderedTime: 0,
  progress: 0,
  ready: false,
  ticking: false,
  seeking: false,
  lastSeekAt: 0,
  useFrameSequence: isAndroidFrameMode,
  requestedFrame: -1,
  renderedFrame: -1,
  frameCache: new Map(),
  pendingFrames: new Map(),
  musicStarted: false,
  reducedMotion: window.matchMedia("(prefers-reduced-motion: reduce)"),
};

async function startMusic() {
  if (state.musicStarted) return true;

  try {
    dom.music.volume = 0.46;
    await dom.music.play();
    state.musicStarted = true;
    dom.soundToggle.classList.add("is-playing");
    dom.soundToggle.setAttribute("aria-label", "قطع موسیقی");
    dom.soundToggle.setAttribute("aria-pressed", "true");
    removeMusicStartListeners();
    return true;
  } catch {
    return false;
  }
}

function requestMusicStart(event) {
  if (event.target instanceof Element && event.target.closest("#soundToggle")) return;
  startMusic();
}

function removeMusicStartListeners() {
  window.removeEventListener("pointerdown", requestMusicStart);
  window.removeEventListener("touchstart", requestMusicStart);
  window.removeEventListener("wheel", requestMusicStart);
  window.removeEventListener("keydown", requestMusicStart);
}

function initialiseMusic() {
  window.addEventListener("pointerdown", requestMusicStart, { passive: true });
  window.addEventListener("touchstart", requestMusicStart, { passive: true });
  window.addEventListener("wheel", requestMusicStart, { passive: true });
  window.addEventListener("keydown", requestMusicStart);

  dom.soundToggle.addEventListener("click", async () => {
    if (!state.musicStarted) {
      await startMusic();
      return;
    }

    dom.music.muted = !dom.music.muted;
    const isAudible = !dom.music.muted;
    dom.soundToggle.classList.toggle("is-playing", isAudible);
    dom.soundToggle.classList.toggle("is-muted", !isAudible);
    dom.soundToggle.setAttribute("aria-label", isAudible ? "قطع موسیقی" : "پخش موسیقی");
    dom.soundToggle.setAttribute("aria-pressed", String(isAudible));
    dom.soundIcon.textContent = isAudible ? "♪" : "×";
  });
}

function toPersianNumber(value) {
  return String(value).replace(/\d/g, (digit) => "۰۱۲۳۴۵۶۷۸۹"[digit]);
}

function setLoaderProgress(percent) {
  dom.loaderPercent.textContent = `${toPersianNumber(Math.round(percent))}٪`;
}

function updateScrollProgress() {
  const rect = dom.experience.getBoundingClientRect();
  const scrollDistance = Math.max(dom.experience.offsetHeight - window.innerHeight, 1);
  state.progress = clamp(-rect.top / scrollDistance);

  // The film occupies the first 84% of the scroll. The remainder creates a
  // deliberate, quiet transition from its final black frame into the card.
  const filmProgress = range(state.progress, 0, 0.98);
  state.targetTime = filmProgress * Math.max(state.duration - 0.035, 0);

  dom.filmShade.style.opacity = String(range(state.progress, 0.9, 1));
  dom.filmLayer.style.opacity = "1";
  dom.scrollProgress.style.transform = `scaleX(${state.progress})`;
  dom.scrollCue.style.opacity = String(1 - range(state.progress, 0.76, 0.88));

  if (state.progress < 0.08) dom.scrollMessage.textContent = "برای آغاز، آرام اسکرول کنید";
  else if (state.progress < 0.72) dom.scrollMessage.textContent = "برای ادامه اسکرول کنید";
  else dom.scrollMessage.textContent = "دعوت ما برای شما";
}

function onScroll() {
  if (state.ticking) return;
  state.ticking = true;
  requestAnimationFrame(() => {
    updateScrollProgress();
    state.ticking = false;
  });
}

function frameUrl(index) {
  return `./assets/invitation/frames/frame-${String(index + 1).padStart(3, "0")}.webp?v=3`;
}

function trimFrameCache(centerIndex) {
  if (state.frameCache.size <= 9) return;
  const indexes = [...state.frameCache.keys()].sort(
    (left, right) => Math.abs(right - centerIndex) - Math.abs(left - centerIndex),
  );

  while (state.frameCache.size > 9 && indexes.length) {
    state.frameCache.delete(indexes.shift());
  }
}

function loadFrame(index) {
  const safeIndex = Math.max(0, Math.min(ANDROID_FRAME_COUNT - 1, index));
  if (state.frameCache.has(safeIndex)) return Promise.resolve(state.frameCache.get(safeIndex));
  if (state.pendingFrames.has(safeIndex)) return state.pendingFrames.get(safeIndex);

  const pending = new Promise((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => {
      state.pendingFrames.delete(safeIndex);
      state.frameCache.set(safeIndex, image);
      trimFrameCache(state.requestedFrame < 0 ? safeIndex : state.requestedFrame);
      resolve(image);
    };
    image.onerror = () => {
      state.pendingFrames.delete(safeIndex);
      reject(new Error(`Frame ${safeIndex + 1} could not be loaded.`));
    };
    image.src = frameUrl(safeIndex);
  });

  state.pendingFrames.set(safeIndex, pending);
  return pending;
}

async function drawFrame(index) {
  const safeIndex = Math.max(0, Math.min(ANDROID_FRAME_COUNT - 1, index));
  state.requestedFrame = safeIndex;

  try {
    const image = await loadFrame(safeIndex);
    if (state.requestedFrame !== safeIndex) return;
    const context = dom.frameCanvas.getContext("2d", { alpha: false });
    context.drawImage(image, 0, 0, dom.frameCanvas.width, dom.frameCanvas.height);
    dom.frameCanvas.dataset.frame = String(safeIndex);
    state.renderedFrame = safeIndex;

    for (let offset = 1; offset <= 3; offset += 1) {
      loadFrame(safeIndex + offset).catch(() => {});
      loadFrame(safeIndex - offset).catch(() => {});
    }
  } catch {
    // Keep the last successfully rendered frame visible.
  }
}

async function prefetchFrameFiles() {
  let cursor = 1;
  let completed = 1;

  const worker = async () => {
    while (cursor < ANDROID_FRAME_COUNT) {
      const index = cursor;
      cursor += 1;
      try {
        const response = await fetch(frameUrl(index), { cache: "force-cache" });
        if (response.ok) await response.blob();
      } catch {
        // A missed prefetch can still be loaded on demand while scrolling.
      }
      completed += 1;
      setLoaderProgress(15 + (completed / ANDROID_FRAME_COUNT) * 80);
    }
  };

  await Promise.all(Array.from({ length: 5 }, () => worker()));
}

async function initialiseFrameSequence() {
  dom.film.pause();
  dom.film.querySelectorAll("source").forEach((source) => source.remove());
  dom.film.removeAttribute("src");
  dom.film.hidden = true;
  dom.frameCanvas.hidden = false;
  dom.frameCanvas.dataset.renderer = "Android frame sequence";

  try {
    await drawFrame(0);
    setLoaderProgress(15);
    // Begin immediately; load only nearby frames instead of blocking on all files.
    state.duration = (ANDROID_FRAME_COUNT - 1) / ANDROID_FRAME_FPS;
    state.ready = true;
    finishLoading();
  } catch {
    dom.frameCanvas.hidden = true;
    dom.cardLayer.style.visibility = "visible";
    dom.cardLayer.style.opacity = "1";
    dom.cardLayer.style.transform = "none";
    dom.scrollCue.hidden = true;
    finishLoading();
  }
}

function renderVideoFrame(now) {
  if (state.ready && !state.reducedMotion.matches) {
    if (state.useFrameSequence) {
      const desiredFrame = Math.round((state.targetTime / state.duration) * (ANDROID_FRAME_COUNT - 1));
      if (desiredFrame !== state.requestedFrame) drawFrame(desiredFrame);
      requestAnimationFrame(renderVideoFrame);
      return;
    }

    // Quantising to real video frames and limiting seek frequency avoids
    // overwhelming Android hardware decoders during rapid touch scrolling.
    const desiredTime = Math.round(state.targetTime * VIDEO_FPS) / VIDEO_FPS;
    const distance = desiredTime - state.renderedTime;

    if (
      Math.abs(distance) >= FRAME_DURATION * 0.75 &&
      !state.seeking &&
      now - state.lastSeekAt >= MIN_SEEK_INTERVAL_MS
    ) {
      state.seeking = true;
      state.lastSeekAt = now;
      state.renderedTime = desiredTime;
      try {
        dom.film.currentTime = desiredTime;
      } catch {
        state.seeking = false;
      }
    }
  }
  requestAnimationFrame(renderVideoFrame);
}

function finishLoading() {
  if (!dom.body.classList.contains("is-loading")) return;
  setLoaderProgress(100);
  window.setTimeout(() => {
    dom.body.classList.remove("is-loading");
    dom.loader.classList.add("is-complete");
  }, 240);
}

function initialiseFilm() {
  if (state.reducedMotion.matches) {
    finishLoading();
    return;
  }

  if (state.useFrameSequence) {
    initialiseFrameSequence();
    return;
  }

  dom.film.preload = "auto";

  const markReady = () => {
    state.duration = Number.isFinite(dom.film.duration) ? dom.film.duration : state.duration;
    state.ready = true;
    dom.startButton.hidden = true;
    dom.film.pause();
    dom.film.currentTime = 0.001;
    setLoaderProgress(100);
    finishLoading();
  };

  dom.film.addEventListener("loadedmetadata", () => setLoaderProgress(45), { once: true });
  dom.film.addEventListener("loadeddata", () => setLoaderProgress(75), { once: true });
  dom.film.addEventListener("canplay", markReady, { once: true });
  dom.film.addEventListener("seeked", () => { state.seeking = false; });

  dom.film.addEventListener("error", () => {
    console.warn("Video could not be loaded; showing the invitation card instead.");
    dom.filmLayer.hidden = true;
    dom.cardLayer.style.visibility = "visible";
    dom.cardLayer.style.opacity = "1";
    dom.cardLayer.style.transform = "none";
    dom.scrollCue.hidden = true;
    state.ready = false;
    finishLoading();
  }, { once: true });

  dom.film.load();
  window.setTimeout(() => {
    if (!state.ready) {
      dom.startButton.hidden = false;
      dom.startButton.addEventListener("click", async () => {
        dom.startButton.hidden = true;
        try {
          await dom.film.play();
          dom.film.pause();
          markReady();
        } catch {
          finishLoading();
        }
      }, { once: true });
      finishLoading();
    }
  }, 3500);
}

window.addEventListener("scroll", onScroll, { passive: true });
window.addEventListener("resize", onScroll, { passive: true });
state.reducedMotion.addEventListener?.("change", () => window.location.reload());

updateScrollProgress();
initialiseFilm();
initialiseMusic();
requestAnimationFrame(renderVideoFrame);
