/** Fixed-timestep accumulator. Clamps long frames to avoid a death spiral. */
export class FixedStepper {
  private acc = 0;
  constructor(private readonly step = 1 / 60, private readonly maxFrame = 0.25) {}

  /** Runs tick(step) for each whole step elapsed; returns interpolation alpha in [0,1). */
  advance(elapsedSec: number, tick: (dt: number) => void): number {
    this.acc += Math.min(Math.max(elapsedSec, 0), this.maxFrame);
    const eps = 1e-9;
    while (this.acc >= this.step - eps) {
      tick(this.step);
      this.acc -= this.step;
    }
    if (this.acc < 0) this.acc = 0;
    return this.acc / this.step;
  }
}
