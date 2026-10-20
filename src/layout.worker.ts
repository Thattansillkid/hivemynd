import { createSim, LayoutMode } from './layout';

// Runs the force simulation off the UI thread and streams positions back ~20x/s.
self.onmessage = (e: MessageEvent<{ n: number; links: [number, number][]; cached: (number[] | null)[]; mode?: LayoutMode }>) => {
  const { n, links, cached, mode } = e.data;
  const { sim, write } = createSim(n, links, cached, mode);
  const post = (done: boolean) => {
    const positions = new Float32Array(n * 3);
    write(positions);
    (self as unknown as Worker).postMessage({ positions, done }, [positions.buffer]);
  };
  const run = () => {
    const t0 = performance.now();
    while (performance.now() - t0 < 50 && sim.alpha() > sim.alphaMin()) sim.tick();
    const done = sim.alpha() <= sim.alphaMin();
    post(done);
    if (!done) setTimeout(run, 0);
  };
  run();
};
