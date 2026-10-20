// Samples system and brain health once a second for the Brain Monitor window.
// CPU and RAM come from Node's os module; the GPU from a single long-running
// `nvidia-smi` stream (no per-sample process spawn). Runs only while a monitor
// view is open.

export interface BrainStats {
  fps: number;
  frameMs: number;
  spikesPerSec: number;
  sparksPerSec: number;
  nodes: number;
  links: number;
  ambient: number;
  facets: number;
}

export interface Sample {
  t: number;
  cpu: number | null; // % of all cores
  ram: number | null; // % used
  gpu: number | null; // % utilisation
  gpuMem: number | null; // MiB used
  gpuMemTotal: number | null;
  gpuTemp: number | null; // °C
  gpuPower: number | null; // W
  fps: number | null;
  frameMs: number | null;
  spikes: number | null;
  sparks: number | null;
}

const HISTORY = 180;

export class Monitor {
  readonly samples: Sample[] = [];
  gpuName = '';
  gpuStatus: 'starting' | 'ok' | 'unavailable' = 'starting';
  ramTotalGb = 0;
  private users = 0;
  private timer: number | null = null;
  private smi: any = null;
  private lastCpu: { idle: number; total: number } | null = null;
  private gpuLatest: Partial<Sample> = {};
  private listeners = new Set<() => void>();

  constructor(private brain: () => BrainStats | null) {}

  onSample(fn: () => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  acquire() {
    if (this.users++ === 0) this.start();
  }

  release() {
    if (--this.users <= 0) { this.users = 0; this.stop(); }
  }

  private start() {
    this.startGpu();
    this.timer = window.setInterval(() => this.tick(), 1000);
  }

  private stop() {
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    try { this.smi?.kill(); } catch { /* already gone */ }
    this.smi = null;
    this.gpuStatus = 'starting';
  }

  private startGpu() {
    const cp = (window as any).require?.('child_process');
    if (!cp) { this.gpuStatus = 'unavailable'; return; }
    try {
      const smi = cp.spawn('nvidia-smi', [
        '--query-gpu=utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,name',
        '--format=csv,noheader,nounits',
        '-lms', '1000',
      ], { windowsHide: true });
      let buf = '';
      smi.stdout.setEncoding('utf8');
      smi.stdout.on('data', (chunk: string) => {
        buf += chunk;
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          const f = line.split(',').map((x) => x.trim());
          if (f.length < 6) continue;
          const num = (x: string) => (Number.isFinite(Number(x)) ? Number(x) : null);
          this.gpuLatest = { gpu: num(f[0]), gpuMem: num(f[1]), gpuMemTotal: num(f[2]), gpuTemp: num(f[3]), gpuPower: num(f[4]) };
          this.gpuName = f.slice(5).join(',');
          this.gpuStatus = 'ok';
        }
      });
      smi.on('error', () => { this.gpuStatus = 'unavailable'; this.smi = null; });
      smi.on('exit', () => { if (this.gpuStatus !== 'ok') this.gpuStatus = 'unavailable'; this.smi = null; });
      this.smi = smi;
    } catch {
      this.gpuStatus = 'unavailable';
    }
  }

  private tick() {
    const os = (window as any).require?.('os');
    let cpu: number | null = null;
    let ram: number | null = null;
    if (os) {
      let idle = 0, total = 0;
      for (const c of os.cpus()) {
        const t = c.times;
        idle += t.idle;
        total += t.user + t.nice + t.sys + t.irq + t.idle;
      }
      if (this.lastCpu && total > this.lastCpu.total) cpu = 100 * (1 - (idle - this.lastCpu.idle) / (total - this.lastCpu.total));
      this.lastCpu = { idle, total };
      this.ramTotalGb = os.totalmem() / 1024 ** 3;
      ram = 100 * (1 - os.freemem() / os.totalmem());
    }
    const b = this.brain();
    const g = this.gpuStatus === 'ok' ? this.gpuLatest : {};
    this.samples.push({
      t: Date.now(),
      cpu,
      ram,
      gpu: g.gpu ?? null,
      gpuMem: g.gpuMem ?? null,
      gpuMemTotal: g.gpuMemTotal ?? null,
      gpuTemp: g.gpuTemp ?? null,
      gpuPower: g.gpuPower ?? null,
      fps: b?.fps ?? null,
      frameMs: b?.frameMs ?? null,
      spikes: b?.spikesPerSec ?? null,
      sparks: b?.sparksPerSec ?? null,
    });
    if (this.samples.length > HISTORY) this.samples.shift();
    for (const fn of this.listeners) fn();
  }
}
