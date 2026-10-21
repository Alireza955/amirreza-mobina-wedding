const $ = (selector) => document.querySelector(selector);
const clamp = (value, min = 0, max = 1) => Math.min(max, Math.max(min, value));
const range = (value, start, end) => clamp((value - start) / (end - start));
const mix = (from, to, progress) => from + (to - from) * progress;
const VIDEO_FPS = 24;
const FRAME_DURATION = 1 / VIDEO_FPS;
const MIN_SEEK_INTERVAL_MS = 70;

const dom = {
  body: document.body,
  loader: $("#loader"),
  loaderPercent: $("#loaderPercent"),
  experience: $("#experience"),
  film: $("#weddingFilm"),
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
  const filmProgress = range(state.progress, 0, 0.84);
  state.targetTime = filmProgress * Math.max(state.duration - 0.035, 0);

  const darken = range(state.progress, 0.76, 0.86);
  const cardReveal = range(state.progress, 0.855, 0.96);

  dom.filmShade.style.opacity = String(mix(0, 1, darken));
  dom.filmLayer.style.opacity = String(1 - range(state.progress, 0.86, 0.93));
  dom.cardLayer.style.visibility = cardReveal > 0.002 ? "visible" : "hidden";
  dom.cardLayer.style.opacity = String(cardReveal);
  dom.cardLayer.style.transform = `scale(${mix(1.025, 1, cardReveal)})`;
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

function renderVideoFrame(now) {
  if (state.ready && !state.reducedMotion.matches) {
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
