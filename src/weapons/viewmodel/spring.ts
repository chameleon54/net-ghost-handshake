// A spring that pulls a value toward a target and overshoots slightly before settling: the "snap" of gun motion.
// Described by how fast it swings (frequency) and how quickly the swinging dies out (damping ratio):
// 1 settles with no overshoot, 0.5 overshoots a little, 0 never settles. No drawing code here.
const maxStepRadians = 0.05; // each step turns the spring by at most this much of a swing: accurate and stable, even after a slow frame

export class Spring {
  value = 0;
  velocity = 0;
  target = 0;

  constructor(
    public frequencyHz: number,
    public dampingRatio: number,
  ) {}

  /**
   * Push the spring so it swings out to about `peak` and then comes home (a shot kicks the gun back). A push, not a
   * jump, so the motion is seen over a few frames instead of flashing for one.
   */
  impulse(peak: number): void {
    const omega = 2 * Math.PI * this.frequencyHz;
    this.velocity += (peak * omega) / this.peakPerVelocity();
  }

  /** How far out a unit push goes, in units of velocity / omega: a property of the damping alone. */
  private peakPerVelocity(): number {
    const zeta = this.dampingRatio;
    if (zeta >= 1) return Math.E ** -1; // fully damped: peaks at 1/e
    return Math.exp((-zeta * Math.acos(zeta)) / Math.sqrt(1 - zeta * zeta));
  }

  update(dtSec: number): void {
    const omega = 2 * Math.PI * this.frequencyHz;
    let left = dtSec;
    while (left > 0) {
      const step = Math.min(left, maxStepRadians / omega);
      const acceleration = omega * omega * (this.target - this.value) - 2 * this.dampingRatio * omega * this.velocity;
      this.velocity += acceleration * step;
      this.value += this.velocity * step;
      left -= step;
    }
  }

  reset(): void {
    this.value = 0;
    this.velocity = 0;
  }
}
