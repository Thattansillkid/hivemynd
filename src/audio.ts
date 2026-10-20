// Music reactivity: listens to an audio input (a loopback such as VB-Audio Cable,
// Virtual Audio Cable, Stereo Mix or an interface's loopback channel), splits it into
// bass / mids / highs every rendered frame, and detects kick-drum onsets.
//
// Latency: the analyser is read on the render loop, so visuals trail the captured
// audio by at most one frame (≈8 ms at 120 Hz) plus the OS capture buffer.

export interface AudioLevels {
  bass: number; // 0..1, auto-gained
  mid: number;
  high: number;
  beat: number; // 1 on a kick onset, decaying
  level: number; // overall loudness 0..1
}

const BANDS = { bass: [25, 160], mid: [160, 2000], high: [2000, 12000] } as const;
const HISTORY_MS = 600;
export const SYSTEM_AUDIO = 'system-audio';

export class AudioReactor {
  deviceLabel = '';
  error = '';
  private ctx: AudioContext | null = null;
  private stream: MediaStream | null = null;
  private analyser: AnalyserNode | null = null;
  private bins = new Uint8Array(0);
  // Sub-bass path: two stacked 12 dB/oct low-pass filters (24 dB/oct total) at the
  // cutoff, read as a time-domain envelope every frame. Steep enough that a 150-200 Hz
  // thump barely registers, and no FFT window smearing the timing of a kick.
  private lowA: BiquadFilterNode | null = null;
  private lowB: BiquadFilterNode | null = null;
  private lowAnalyser: AnalyserNode | null = null;
  private lowBuf = new Float32Array(1024);
  private lowFast = 0;
  private lowSlow = 0;
  private lowPeak = 0.05;
  private cutoff = 80;
  private sensitivity = 1;
  private armed = true;
  private lowPrev = 0;
  private fullBuf = new Float32Array(2048);
  private hitPeak = 0;
  /** Bass hits detected since start (for testing). */
  onsets = 0;
  /** Recent onset times (ms), for tempo checks on GET /audio-levels. */
  onsetTimes: number[] = [];
  private lastSampleAt = 0;
  private peaks = { bass: 0.2, mid: 0.2, high: 0.2 };
  private bassAvg = 0;
  private beat = 0;
  private lastBeat = 0;
  private history: { t: number; v: AudioLevels }[] = [];
  /** Raw detector inputs over the last ~minute, for tuning against real music (GET /audio-levels). */
  stats = { frames: 0, rms: [] as number[], share: [] as number[], full: [] as number[] };

  get running() { return !!this.analyser; }

  static async inputs(): Promise<MediaDeviceInfo[]> {
    const list = await navigator.mediaDevices.enumerateDevices();
    // Labels are hidden until capture has been allowed once; ask briefly, then re-list.
    if (list.some((d) => d.kind === 'audioinput' && !d.label)) {
      try {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach((t) => t.stop());
      } catch { /* permission denied: fall through with unlabeled devices */ }
      return (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'audioinput');
    }
    return list.filter((d) => d.kind === 'audioinput');
  }

  /** Listens to each input briefly and returns its peak level (0..1): which one carries sound right now. */
  static async probe(deviceIds: string[], ms = 600): Promise<Record<string, number>> {
    const out: Record<string, number> = {};
    await Promise.all(deviceIds.map(async (id) => {
      let stream: MediaStream | null = null;
      let ctx: AudioContext | null = null;
      try {
        stream = await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: id }, echoCancellation: false, noiseSuppression: false, autoGainControl: false } });
        ctx = new AudioContext();
        const an = ctx.createAnalyser();
        an.fftSize = 2048;
        ctx.createMediaStreamSource(stream).connect(an);
        const buf = new Float32Array(an.fftSize);
        let peak = 0;
        const end = performance.now() + ms;
        while (performance.now() < end) {
          an.getFloatTimeDomainData(buf);
          for (const v of buf) peak = Math.max(peak, Math.abs(v));
          await new Promise((r) => window.setTimeout(r, 30));
        }
        out[id] = peak;
      } catch {
        out[id] = -1;
      } finally {
        stream?.getTracks().forEach((t) => t.stop());
        void ctx?.close();
      }
    }));
    return out;
  }

  /** Peak level (0..1) of system audio over `ms`, or -1 if loopback is unavailable. */
  static async probeSystem(ms = 700): Promise<number> {
    let stream: MediaStream | null = null;
    let ctx: AudioContext | null = null;
    try {
      stream = await AudioReactor.systemAudio();
      ctx = new AudioContext();
      const an = ctx.createAnalyser();
      ctx.createMediaStreamSource(stream).connect(an);
      const buf = new Float32Array(an.fftSize);
      let peak = 0;
      const end = performance.now() + ms;
      while (performance.now() < end) {
        an.getFloatTimeDomainData(buf);
        for (const v of buf) peak = Math.max(peak, Math.abs(v));
        await new Promise((r) => window.setTimeout(r, 30));
      }
      return peak;
    } catch {
      return -1;
    } finally {
      stream?.getTracks().forEach((t) => t.stop());
      void ctx?.close();
    }
  }

  /**
   * Windows system-audio loopback through Chromium's desktop capture: hears whatever
   * the PC is playing, no virtual cable needed. Video is requested at 1 px / 1 fps
   * (Chromium requires it) and dropped immediately.
   */
  static async systemAudio(): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { mandatory: { chromeMediaSource: 'desktop' } },
      video: { mandatory: { chromeMediaSource: 'desktop', maxWidth: 1, maxHeight: 1, maxFrameRate: 1 } },
    } as any);
    stream.getVideoTracks().forEach((t) => { t.stop(); stream.removeTrack(t); });
    return stream;
  }

  async start(deviceId: string) {
    this.stop();
    this.error = '';
    if (deviceId === SYSTEM_AUDIO) {
      try {
        this.stream = await AudioReactor.systemAudio();
        this.attach('System audio (what this PC is playing)');
      } catch (err) {
        this.error = err instanceof Error ? err.message : String(err);
        this.stop();
      }
      return;
    }
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
          // Smallest capture buffer the device allows.
          latency: 0,
        } as MediaTrackConstraints,
      });
      this.attach(this.stream.getAudioTracks()[0]?.label ?? 'audio input');
    } catch (err) {
      this.error = err instanceof Error ? err.message : String(err);
      this.stop();
    }
  }

  private attach(label: string) {
    this.ctx = new AudioContext({ latencyHint: 'interactive' });
    const src = this.ctx.createMediaStreamSource(this.stream!);
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 2048;
    this.analyser.smoothingTimeConstant = 0.15; // low smoothing: snappy response
    src.connect(this.analyser);
    this.bins = new Uint8Array(this.analyser.frequencyBinCount);
    this.lowA = this.ctx.createBiquadFilter();
    this.lowB = this.ctx.createBiquadFilter();
    for (const f of [this.lowA, this.lowB]) { f.type = 'lowpass'; f.Q.value = 0.707; f.frequency.value = this.cutoff; }
    this.lowAnalyser = this.ctx.createAnalyser();
    this.lowAnalyser.fftSize = 1024; // ~21 ms of samples per read
    src.connect(this.lowA);
    this.lowA.connect(this.lowB);
    this.lowB.connect(this.lowAnalyser);
    this.lowBuf = new Float32Array(this.lowAnalyser.fftSize);
    this.deviceLabel = label;
  }

  /** Analyse an existing stream (used by the isolated bass test page). */
  startStream(stream: MediaStream, label: string) {
    this.stop();
    this.stream = stream;
    this.attach(label);
  }

  /** Low-frequency hit detection: cutoff in Hz (e.g. 80), sensitivity 0.5-2 (higher = more hits). */
  setBass(cutoffHz: number, sensitivity: number) {
    this.cutoff = cutoffHz;
    this.sensitivity = sensitivity;
    for (const f of [this.lowA, this.lowB]) f?.frequency.setValueAtTime(cutoffHz, this.ctx?.currentTime ?? 0);
  }

  stop() {
    this.stream?.getTracks().forEach((t) => t.stop());
    void this.ctx?.close();
    this.stream = null;
    this.ctx = null;
    this.analyser = null;
    this.lowA = this.lowB = this.lowAnalyser = null;
    this.history = [];
  }

  /**
   * Levels for this frame. `delayMs` holds visuals back to line up with audio that
   * reaches your ears late (Bluetooth headphones, some interfaces).
   */
  sample(delayMs = 0): AudioLevels | null {
    if (!this.analyser || !this.ctx) return null;
    const now = performance.now();
    this.analyser.getByteFrequencyData(this.bins);
    const hz = this.ctx.sampleRate / this.analyser.fftSize;
    const band = (lo: number, hi: number) => {
      const a = Math.max(1, Math.floor(lo / hz)), b = Math.min(this.bins.length - 1, Math.ceil(hi / hz));
      let sum = 0;
      for (let i = a; i <= b; i++) sum += this.bins[i];
      return sum / ((b - a + 1) * 255);
    };
    // Bass now comes from the dedicated sub-bass envelope (RMS below the cutoff).
    let rms = 0;
    if (this.lowAnalyser) {
      this.lowAnalyser.getFloatTimeDomainData(this.lowBuf);
      let sum = 0;
      for (const v of this.lowBuf) sum += v * v;
      rms = Math.sqrt(sum / this.lowBuf.length);
    }
    // Auto-gain reference: the recent loudest sub-bass, decaying over ~3 s (time-based,
    // so it behaves the same at 30 or 144 fps). The floor only keeps silence at zero:
    // real playback through system loopback can sit well under 0.01.
    const dtS = this.lastSampleAt ? Math.min(0.1, (now - this.lastSampleAt) / 1000) : 1 / 60;
    this.lastSampleAt = now;
    this.lowPeak = Math.max(rms, this.lowPeak * Math.exp(-dtS / 3), 0.0008);
    const sub = rms / this.lowPeak; // 0..1 relative to recent loudest bass
    const raw = { bass: sub, mid: band(...BANDS.mid), high: band(...BANDS.high) };
    // Auto-gain: each band is scaled against its own slowly decaying peak, so quiet
    // and loud tracks both drive the brain through its full range.
    const norm = (k: keyof typeof raw) => {
      this.peaks[k] = Math.max(raw[k], this.peaks[k] * 0.996, 0.04);
      return Math.min(1, Math.pow(raw[k] / this.peaks[k], 1.6));
    };
    const v: AudioLevels = { bass: norm('bass'), mid: norm('mid'), high: norm('high'), beat: 0, level: (raw.bass + raw.mid + raw.high) / 3 };

    // Low hit = all three at once:
    //  1. a sharp rise in sub-bass level (so a ringing tail never retriggers),
    //  2. sub-bass is a real share of everything playing right now (so a 120-200 Hz
    //     thump, with only filter leakage below the cutoff, is ignored),
    //  3. above an absolute floor (silence and hiss don't count).
    // After firing it re-arms once the level falls below half that hit's peak and at
    // least 90 ms have passed, so fast double kicks still both register.
    let full = 0;
    if (this.analyser) {
      if (this.fullBuf.length !== this.analyser.fftSize) this.fullBuf = new Float32Array(this.analyser.fftSize);
      this.analyser.getFloatTimeDomainData(this.fullBuf);
      // Same span as the sub-bass window (the newest samples), so the share compares like with like.
      const span = Math.min(this.lowBuf.length, this.fullBuf.length);
      let sum = 0;
      for (let i = this.fullBuf.length - span; i < this.fullBuf.length; i++) sum += this.fullBuf[i] * this.fullBuf[i];
      full = Math.sqrt(sum / span);
    }
    const share = rms / (full + 1e-6);
    const st = this.stats;
    st.frames++;
    st.rms.push(rms); st.share.push(share); st.full.push(full);
    if (st.rms.length > 4000) { st.rms.shift(); st.share.shift(); st.full.shift(); }
    // Every test is relative to this track's own recent bass level, so quiet and loud
    // playback both work; only the silence gate is absolute. Tuned on live system
    // audio where sub-bass RMS ran ~0.002-0.013 (the old absolute 0.012 floor and
    // +0.002 rise step let through 1 hit in 12 s).
    const level = rms / this.lowPeak;
    const rising = rms > this.lowPrev * 1.3 + this.lowPeak * 0.04;
    this.lowPrev = this.lowPrev * 0.5 + rms * 0.5;
    // Re-arm when the hit has decayed, or after 350 ms on long 808 tails that never dip.
    if (!this.armed && now - this.lastBeat > 90 && (rms < this.hitPeak * 0.5 || (now - this.lastBeat > 350 && rms < this.hitPeak * 0.8))) this.armed = true;
    if (!this.armed) this.hitPeak = Math.max(this.hitPeak, rms);
    const sens = this.sensitivity;
    const audible = full > 0.002 && rms > 0.0006;
    if (this.armed && rising && audible && level > 0.45 / sens && share > 0.22 / sens) {
      this.beat = 1;
      this.lastBeat = now;
      this.onsets++;
      this.onsetTimes.push(now);
      if (this.onsetTimes.length > 128) this.onsetTimes.shift();
      this.armed = false;
      this.hitPeak = rms;
    } else {
      this.beat *= 0.86;
    }
    v.beat = this.beat;

    if (delayMs <= 0) return v;
    this.history.push({ t: now, v });
    while (this.history.length && now - this.history[0].t > HISTORY_MS) this.history.shift();
    const target = now - delayMs;
    let pick = this.history[0];
    for (const h of this.history) { if (h.t <= target) pick = h; else break; }
    return pick?.v ?? v;
  }
}
