/** A small illustrative hydraulic loop. Fixed-step state is the single source for all visuals.
 * Two equal-area vessels exchange liquid. Motor inertia, head and valve resistance
 * determine flow; no independently animated levels or invented telemetry. */
export class HydraulicLoop {
  readonly capacity = 1.8;
  readonly totalVolume = 2.1;
  speed = .64;
  target = .64;
  valve = 1;
  left = 1.12;
  right = .98;
  inlet = 0;
  outlet = 0;
  pressure = 0;
  phase = 0;
  time = 0;

  step(dt: number) {
    if (!Number.isFinite(dt) || dt <= 0 || dt > .1) return;
    this.speed += (this.target - this.speed) * (1 - Math.exp(-dt / 1.6));
    const head = Math.max(0, 17 * this.speed * this.speed - Math.max(0, this.left - this.right));
    this.inlet = .014 * Math.sqrt(head) * Math.min(1, this.right * 5);
    this.outlet = .05 * this.valve * Math.sqrt(Math.max(0, this.left - this.right + .35));
    const transfer = Math.max(-Math.min(this.left, this.capacity - this.right),
      Math.min(Math.min(this.right, this.capacity - this.left), (this.inlet - this.outlet) * dt));
    // Saturation limits actual transport as well as levels, so telemetry conserves volume.
    const requested = (this.inlet - this.outlet) * dt;
    if (transfer < requested) this.inlet = this.outlet + transfer / dt;
    if (transfer > requested) this.outlet = this.inlet - transfer / dt;
    this.left += transfer;
    this.right = this.totalVolume - this.left;
    this.pressure = head * .0981; // Metres of water head → bar.
    this.phase += this.speed * dt;
    this.time += dt;
  }

  get rpm() { return Math.round(this.speed * 2900); }
  get flow() { return this.inlet * 1000; } // m³/s → L/s; tank cross-section is 1 m².
  reset() {
    this.speed = this.target = .64;
    this.valve = 1;
    this.left = 1.12;
    this.right = .98;
    this.time = this.phase = 0;
    this.step(1 / 60);
  }
}
