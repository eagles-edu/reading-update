(() => {
  'use strict';

  const EQ_DB_PER_STEP = 1.25;
  const EQ_LIMIT = 12;
  const TONE_SRC = 'https://cdn.jsdelivr.net/npm/tone@15.1.22/build/Tone.js';
  const TONE_INTEGRITY = 'sha384-NWoslxaf/3dYwQk+uGziDYJFdsjBpVlU1WpFRexuDFcIk/5PJpCbpVXia2Uikeix';
  const controllers = new WeakMap();
  let toneLoadPromise = null;

  function svgMarkup(path) {
    return `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="${path}"></path></svg>`;
  }

  function createElement(tagName, className, attributes = {}) {
    const element = document.createElement(tagName);
    if (className) element.className = className;
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    return element;
  }

  function loadTone() {
    if (window.Tone) return Promise.resolve(window.Tone);
    if (toneLoadPromise) return toneLoadPromise;

    toneLoadPromise = new Promise((resolve, reject) => {
      const script = createElement('script', '', {
        src: TONE_SRC,
        integrity: TONE_INTEGRITY,
        crossorigin: 'anonymous',
      });
      script.onload = () => {
        if (window.Tone) resolve(window.Tone);
        else reject(new Error('Tone.js loaded without exposing the Tone API'));
      };
      script.onerror = () => reject(new Error('Tone.js failed to load'));
      document.head.appendChild(script);
    }).catch((error) => {
      toneLoadPromise = null;
      throw error;
    });

    return toneLoadPromise;
  }

  function formatTime(seconds) {
    if (!Number.isFinite(seconds) || seconds < 0) return '0:00';
    const minutes = Math.floor(seconds / 60);
    const remainder = Math.floor(seconds % 60);
    return `${minutes}:${String(remainder).padStart(2, '0')}`;
  }

  function createControls(shell) {
    const controls = createElement('div', 'player-controls', { 'data-player-controls': '' });
    const playButton = createElement('button', 'play-btn', { 'aria-label': 'Play', type: 'button' });
    playButton.innerHTML = `${svgMarkup('M8 5v14l11-7z')}<span class="sr-only">Play</span>`;
    const pauseIcon = createElement('span', 'pause-icon', { 'aria-hidden': 'true' });
    pauseIcon.innerHTML = svgMarkup('M6 19h4V5H6v14zm8-14v14h4V5h-4z');
    pauseIcon.hidden = true;
    playButton.appendChild(pauseIcon);

    const timeline = createElement('div', 'timeline-container');
    const currentTime = createElement('span', 'current-time', { 'data-current-time': '' });
    currentTime.textContent = '0:00';
    const progress = createElement('input', '', {
      'data-progress': '', type: 'range', min: '0', max: '100', value: '0', 'aria-label': 'Progress',
    });
    const duration = createElement('span', 'duration', { 'data-duration': '' });
    duration.textContent = '0:00';
    timeline.append(currentTime, progress, duration);

    const volume = createElement('div', 'volume-container');
    const volumeIcon = createElement('div', 'volume-icon', { 'aria-hidden': 'true' });
    volumeIcon.innerHTML = svgMarkup('M3 9v6h4l5 5V4L7 9H3zm13.5 3c0-1.77-1.02-3.29-2.5-4.03v8.05c1.48-.73 2.5-2.25 2.5-4.02z');
    const volumeSlider = createElement('input', '', {
      'data-volume': '', type: 'range', min: '0', max: '1', step: '0.05', value: '0.8', 'aria-label': 'Volume',
    });
    volume.append(volumeIcon, volumeSlider);
    controls.append(playButton, timeline, volume);

    const eqSection = createElement('div', 'eq-section', {
      role: 'group', 'aria-label': 'Low, mid, and high EQ controls',
    });
    const eqGrid = createElement('div', 'eq-stepper-grid');
    for (const [band, label] of [['low', 'Lo'], ['mid', 'Mid'], ['high', 'Hi']]) {
      const stepper = createElement('div', 'eq-stepper', { 'data-band': band });
      const eqLabel = createElement('span', 'eq-label');
      eqLabel.textContent = label;
      const lower = createElement('button', 'eq-stepper-btn', {
        type: 'button', 'data-band': band, 'data-step': '-1', 'aria-label': `Lower ${label.toLowerCase()}`,
      });
      lower.textContent = '<';
      const output = createElement('output', 'eq-value', {
        'data-eq-value': band, 'aria-label': `${label} setting`,
      });
      output.textContent = '0';
      const raise = createElement('button', 'eq-stepper-btn', {
        type: 'button', 'data-band': band, 'data-step': '1', 'aria-label': `Raise ${label.toLowerCase()}`,
      });
      raise.textContent = '>';
      stepper.append(eqLabel, lower, output, raise);
      eqGrid.appendChild(stepper);
    }
    eqSection.appendChild(eqGrid);
    shell.append(controls, eqSection);

    return { controls, playButton, pauseIcon, progress, currentTime, duration, volumeSlider };
  }

  function findExistingControls(shell) {
    const controls = shell.querySelector('[data-player-controls], .player-controls');
    if (!controls) return null;
    const playButton = controls.querySelector('#play-pause-btn, .play-btn');
    const pauseIcon = controls.querySelector('#pause-icon, .pause-icon');
    const progress = controls.querySelector('#progress, [data-progress]');
    const currentTime = controls.querySelector('#current-time, [data-current-time]');
    const duration = controls.querySelector('#duration, [data-duration]');
    const volumeSlider = controls.querySelector('#volume, [data-volume]');
    if (!playButton || !pauseIcon || !progress || !currentTime || !duration || !volumeSlider) return null;
    return { controls, playButton, pauseIcon, progress, currentTime, duration, volumeSlider };
  }

  function setPlayState(parts, isPlaying) {
    const playIcon = parts.playButton.querySelector('svg');
    if (playIcon) playIcon.hidden = isPlaying;
    parts.pauseIcon.hidden = !isPlaying;
    parts.playButton.setAttribute('aria-label', isPlaying ? 'Pause' : 'Play');
  }

  function ensureAudioGraph(state, toneApi) {
    if (state.graphReady) return;
    state.eq = new toneApi.EQ3({ low: 0, mid: 0, high: 0 });
    state.volumeNode = new toneApi.Volume(0);
    state.mediaSource = toneApi.getContext().createMediaElementSource(state.audio);
    toneApi.connect(state.mediaSource, state.eq);
    state.eq.connect(state.volumeNode);
    state.volumeNode.toDestination();
    state.graphReady = true;
  }

  function syncAudioSettings(state) {
    const volumeValue = Number(state.parts.volumeSlider.value);
    state.audio.volume = volumeValue;
    if (!state.graphReady) return;
    state.eq.low.value = state.eqValues.low * EQ_DB_PER_STEP;
    state.eq.mid.value = state.eqValues.mid * EQ_DB_PER_STEP;
    state.eq.high.value = state.eqValues.high * EQ_DB_PER_STEP;
    state.volumeNode.volume.value = (volumeValue - 1) * 20;
  }

  function updateTimeDisplay(state) {
    const duration = Number.isFinite(state.audio.duration) ? state.audio.duration : 0;
    state.parts.currentTime.textContent = formatTime(state.audio.currentTime);
    state.parts.duration.textContent = formatTime(duration);
    state.parts.progress.value = duration > 0 ? (state.audio.currentTime / duration) * 100 : 0;
  }

  function bindController(state) {
    const { audio, parts } = state;
    parts.playButton.addEventListener('click', async () => {
      try {
        if (audio.paused) {
          parts.playButton.disabled = true;
          await audio.play();
          const toneApi = await loadTone();
          await toneApi.start();
          ensureAudioGraph(state, toneApi);
          syncAudioSettings(state);
          setPlayState(parts, true);
        } else {
          audio.pause();
          setPlayState(parts, false);
        }
      } catch (error) {
        if (error && error.name !== 'AbortError') console.error('Audio playback error:', error);
        audio.pause();
        setPlayState(parts, false);
      } finally {
        parts.playButton.disabled = false;
      }
    });

    audio.addEventListener('play', () => setPlayState(parts, true));
    audio.addEventListener('pause', () => setPlayState(parts, false));
    audio.addEventListener('loadedmetadata', () => updateTimeDisplay(state));
    audio.addEventListener('durationchange', () => updateTimeDisplay(state));
    audio.addEventListener('timeupdate', () => updateTimeDisplay(state));
    parts.progress.addEventListener('input', () => {
      if (Number.isFinite(audio.duration)) {
        audio.currentTime = (Number(parts.progress.value) / 100) * audio.duration;
        updateTimeDisplay(state);
      }
    });
    parts.volumeSlider.addEventListener('input', () => syncAudioSettings(state));

    state.shell.querySelectorAll('.eq-stepper-btn').forEach((button) => {
      button.addEventListener('click', () => {
        const band = button.dataset.band;
        state.eqValues[band] = Math.max(
          -EQ_LIMIT,
          Math.min(EQ_LIMIT, state.eqValues[band] + Number(button.dataset.step)),
        );
        const output = state.shell.querySelector(`[data-eq-value="${band}"]`) || button.parentElement.querySelector('.eq-value');
        output.value = state.eqValues[band];
        output.textContent = state.eqValues[band];
        syncAudioSettings(state);
      });
    });

    parts.volumeSlider.dispatchEvent(new Event('input'));
    updateTimeDisplay(state);
  }

  function prepareShell(audio) {
    const existingShell = audio.closest('.eagles-player-shell');
    if (existingShell) return existingShell;

    const possibleProofShell = audio.closest('.audio-player');
    if (possibleProofShell && findExistingControls(possibleProofShell)) {
      possibleProofShell.classList.add('eagles-player-shell');
      return possibleProofShell;
    }

    const shell = createElement('div', 'audio-player eagles-player-shell', {
      'aria-label': 'Audio player with EQ controls',
    });
    audio.parentNode.insertBefore(shell, audio);
    shell.appendChild(audio);
    createControls(shell);
    return shell;
  }

  function mountAudioPlayer(audio) {
    if (!(audio instanceof HTMLAudioElement) || controllers.has(audio)) return null;
    audio.setAttribute('crossorigin', audio.crossOrigin || 'anonymous');
    const shell = prepareShell(audio);
    const parts = findExistingControls(shell) || createControls(shell);
    audio.classList.add('eagles-audio-source');
    audio.controls = false;
    audio.dataset.eaglesPlayerMounted = 'v1';
    const state = {
      audio, shell, parts, eq: null, volumeNode: null, mediaSource: null, graphReady: false,
      eqValues: { low: 0, mid: 0, high: 0 },
    };
    controllers.set(audio, state);
    bindController(state);
    return state;
  }

  function mountAll() {
    document.querySelectorAll('audio[data-eagles-audio], audio.audio-player, .eagles-player-shell audio').forEach(mountAudioPlayer);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', mountAll, { once: true });
  else mountAll();

  window.EaglesAudioPlayer = Object.freeze({ mount: mountAudioPlayer, mountAll });
})();
