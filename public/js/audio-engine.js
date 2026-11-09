/**
 * AylusMusic - Web Audio Engine
 * Audio pipeline: MediaElement -> Preamp -> 10-Band EQ -> Clarity Shelf -> Master Gain -> Limiter -> Analyser -> Destination
 */

import { Toast } from './toast.js';

export const EQ_FREQUENCIES = [32, 64, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

export const EQ_PRESETS = {
  jernih: {
    name: 'Jernih (Default)',
    gains: [2.5, 2.0, 1.0, 0.5, 1.5, 2.0, 2.5, 3.0, 3.5, 4.0]
  },
  flat: {
    name: 'Flat',
    gains: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]
  },
  bass: {
    name: 'Bass Boost',
    gains: [6.0, 5.5, 4.0, 2.0, 0.5, 0.0, 0.0, 0.5, 1.0, 1.0]
  },
  vokal: {
    name: 'Vokal',
    gains: [-2.0, -1.0, 0.0, 1.5, 3.5, 4.0, 3.0, 1.5, 0.5, 0.0]
  },
  treble: {
    name: 'Treble Boost',
    gains: [-1.0, -1.0, 0.0, 0.5, 1.0, 2.0, 3.5, 5.0, 6.0, 6.5]
  },
  akustik: {
    name: 'Akustik',
    gains: [3.0, 2.5, 1.5, 1.0, 1.5, 2.0, 2.5, 3.0, 3.5, 3.0]
  }
};

class AudioEngine {
  constructor() {
    this.audioContext = null;
    this.audioElement = null;
    this.sourceNode = null;
    this.preampGain = null;
    this.eqFilters = [];
    this.clarityFilter = null;
    this.masterGain = null;
    this.limiter = null;
    this.analyser = null;

    this.isInitialized = false;
    this.volume = 0.85; // 0.0 to 3.0 (0% - 300%)
    this.currentPreset = 'jernih';
    this.customGains = [...EQ_PRESETS.jernih.gains];
    this.clarityEnabled = true;
    this.sessionHearingWarningShown = false;

    // Visualizer RAF
    this.visualizerCanvas = null;
    this.visualizerCtx = null;
    this.visualizerAnimationId = null;

    this._initAudioElement();
  }

  _initAudioElement() {
    if (typeof Audio === 'undefined') return;
    this.audioElement = new Audio();
    this.audioElement.crossOrigin = 'anonymous';
    this.audioElement.preload = 'metadata';

    // Resume audio context when page becomes visible or tab switches back
    if (typeof document !== 'undefined') {
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden && this.audioContext && this.audioContext.state === 'suspended') {
          this.audioContext.resume().catch(e => console.warn('Resume on visible:', e));
        }
      });
    }
  }

  /**
   * Initializes AudioContext upon user gesture
   */
  async ensureAudioContext() {
    if (this.isInitialized) {
      if (this.audioContext && this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }
      return;
    }

    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      this.audioContext = new AudioCtx();

      // Create nodes
      this.sourceNode = this.audioContext.createMediaElementSource(this.audioElement);
      this.preampGain = this.audioContext.createGain();
      this.preampGain.gain.value = 1.0;

      // 10 Biquad Filters for Equalizer
      this.eqFilters = EQ_FREQUENCIES.map((freq, index) => {
        const filter = this.audioContext.createBiquadFilter();
        if (index === 0) {
          filter.type = 'lowshelf';
        } else if (index === EQ_FREQUENCIES.length - 1) {
          filter.type = 'highshelf';
        } else {
          filter.type = 'peaking';
          filter.Q.value = 1.4;
        }
        filter.frequency.value = freq;
        filter.gain.value = this.customGains[index] || 0;
        return filter;
      });

      // Clarity high-shelf enhancer filter
      this.clarityFilter = this.audioContext.createBiquadFilter();
      this.clarityFilter.type = 'highshelf';
      this.clarityFilter.frequency.value = 10000;
      this.clarityFilter.gain.value = this.clarityEnabled ? 2.5 : 0;

      // Master gain node (volume up to 3.0 / 300%)
      this.masterGain = this.audioContext.createGain();
      this.masterGain.gain.value = this.volume;

      // Dynamics Compressor acting as soft limiter in boost zone
      this.limiter = this.audioContext.createDynamicsCompressor();
      this.limiter.threshold.value = -3.0; // dB
      this.limiter.knee.value = 8.0;
      this.limiter.ratio.value = 20.0;
      this.limiter.attack.value = 0.003; // 3ms
      this.limiter.release.value = 0.15; // 150ms

      // Analyser Node for Visualizer
      this.analyser = this.audioContext.createAnalyser();
      this.analyser.fftSize = 128;
      this.analyser.smoothingTimeConstant = 0.82;

      // Connect Graph:
      // source -> preamp -> EQ[0..9] -> clarity -> masterGain -> limiter -> analyser -> destination
      let lastNode = this.sourceNode;
      lastNode.connect(this.preampGain);
      lastNode = this.preampGain;

      for (const filter of this.eqFilters) {
        lastNode.connect(filter);
        lastNode = filter;
      }

      lastNode.connect(this.clarityFilter);
      this.clarityFilter.connect(this.masterGain);
      this.masterGain.connect(this.limiter);
      this.limiter.connect(this.analyser);
      this.analyser.connect(this.audioContext.destination);

      if (this.audioContext.state === 'suspended') {
        await this.audioContext.resume();
      }

      this.isInitialized = true;
      console.log('[AudioEngine] Web Audio graph initialized successfully with 10-band EQ & limiter');
    } catch (err) {
      console.warn('[AudioEngine] Web Audio graph fallback to standard audio element:', err.message);
    }
  }

  /**
   * Set volume with Boost zone up to 300%
   * @param {number} level 0.0 to 3.0
   * @param {boolean} isGuest 
   */
  setVolume(level, isGuest = false) {
    let target = Math.max(0, Math.min(3.0, level));

    // Guest mode limit to 150% (1.5)
    if (isGuest && target > 1.5) {
      target = 1.5;
    }

    this.volume = target;

    // Warning once per session when crossing 100% (1.0)
    if (target > 1.0 && !this.sessionHearingWarningShown) {
      this.sessionHearingWarningShown = true;
      Toast.warning('Zona Boost (>100%) aktif. Limiter otomatis menjaga audio tidak pecah. Gunakan dengan bijak untuk menjaga kesehatan pendengaran Anda.', 'Peringatan Volume Boost');
    }

    if (this.masterGain && this.audioContext) {
      this.masterGain.gain.setValueAtTime(this.volume, this.audioContext.currentTime);

      // Tighten compressor threshold during extreme boost so no distortion happens
      if (this.limiter) {
        if (this.volume > 1.8) {
          this.limiter.threshold.setValueAtTime(-6.0, this.audioContext.currentTime);
          this.limiter.ratio.setValueAtTime(24.0, this.audioContext.currentTime);
        } else {
          this.limiter.threshold.setValueAtTime(-3.0, this.audioContext.currentTime);
          this.limiter.ratio.setValueAtTime(20.0, this.audioContext.currentTime);
        }
      }
    } else if (this.audioElement) {
      // Fallback: standard audio element caps at 1.0
      this.audioElement.volume = Math.min(1.0, this.volume);
    }

    localStorage.setItem('aylus_volume', this.volume.toString());
    return this.volume;
  }

  getVolume() {
    return this.volume;
  }

  /**
   * Set 10-band EQ Preset
   * @param {string} presetKey 
   */
  setPreset(presetKey) {
    const preset = EQ_PRESETS[presetKey];
    if (!preset) return;
    this.currentPreset = presetKey;
    this.customGains = [...preset.gains];
    this._applyEQGains();
  }

  /**
   * Set specific EQ band gain
   * @param {number} index 0..9
   * @param {number} gainDb -12 to +12
   */
  setBandGain(index, gainDb) {
    if (index < 0 || index >= this.eqFilters.length) return;
    this.currentPreset = 'custom';
    this.customGains[index] = Math.max(-12, Math.min(12, gainDb));
    this._applyEQGains();
  }

  _applyEQGains() {
    if (!this.eqFilters.length || !this.audioContext) return;
    this.eqFilters.forEach((filter, idx) => {
      const targetGain = this.customGains[idx] || 0;
      filter.gain.setValueAtTime(targetGain, this.audioContext.currentTime);
    });
  }

  /**
   * Toggle Clarity Enhancer
   * @param {boolean} enabled 
   */
  setClarityEnhancer(enabled) {
    this.clarityEnabled = !!enabled;
    if (this.clarityFilter && this.audioContext) {
      this.clarityFilter.gain.setValueAtTime(this.clarityEnabled ? 2.5 : 0, this.audioContext.currentTime);
    }
    localStorage.setItem('aylus_clarity', this.clarityEnabled ? 'true' : 'false');
  }

  /**
   * Attach canvas for visualizer rendering
   * @param {HTMLCanvasElement} canvas 
   */
  attachVisualizer(canvas) {
    this.visualizerCanvas = canvas;
    if (!canvas) {
      if (this.visualizerAnimationId) {
        cancelAnimationFrame(this.visualizerAnimationId);
        this.visualizerAnimationId = null;
      }
      return;
    }

    this.visualizerCtx = canvas.getContext('2d');
    this._startVisualizerLoop();
  }

  _startVisualizerLoop() {
    if (this.visualizerAnimationId) {
      cancelAnimationFrame(this.visualizerAnimationId);
    }

    const render = () => {
      this.visualizerAnimationId = requestAnimationFrame(render);
      if (!this.visualizerCanvas || !this.visualizerCtx) return;

      const canvas = this.visualizerCanvas;
      const ctx = this.visualizerCtx;
      const width = canvas.width = canvas.clientWidth * (window.devicePixelRatio || 1);
      const height = canvas.height = canvas.clientHeight * (window.devicePixelRatio || 1);

      ctx.clearRect(0, 0, width, height);

      if (!this.analyser || this.audioElement.paused) {
        // Subtle resting wave
        ctx.beginPath();
        ctx.strokeStyle = 'rgba(15, 181, 174, 0.25)';
        ctx.lineWidth = 2;
        const cy = height / 2;
        ctx.moveTo(0, cy);
        ctx.lineTo(width, cy);
        ctx.stroke();
        return;
      }

      const bufferLength = this.analyser.frequencyBinCount;
      const dataArray = new Uint8Array(bufferLength);
      this.analyser.getByteFrequencyData(dataArray);

      // Tosca to Gold gradient bars
      const barCount = 36;
      const barSpacing = 4 * (window.devicePixelRatio || 1);
      const barWidth = (width - (barCount - 1) * barSpacing) / barCount;

      const gradient = ctx.createLinearGradient(0, height, 0, 0);
      gradient.addColorStop(0, '#0FB5AE'); // Tosca
      gradient.addColorStop(0.65, '#86EFAC'); // Light green
      gradient.addColorStop(1, '#F5C542'); // Gold

      ctx.fillStyle = gradient;

      for (let i = 0; i < barCount; i++) {
        // Map bar to frequency bin
        const binIndex = Math.floor((i / barCount) * (bufferLength * 0.75));
        const val = dataArray[binIndex] || 0;
        const percent = val / 255;
        const barHeight = Math.max(3, percent * (height * 0.92));

        const x = i * (barWidth + barSpacing);
        const y = height - barHeight;

        // Rounded bar
        ctx.beginPath();
        const r = Math.min(barWidth / 2, 4);
        ctx.roundRect(x, y, barWidth, barHeight, [r, r, 0, 0]);
        ctx.fill();
      }
    };

    render();
  }
}

export const audioEngine = new AudioEngine();
