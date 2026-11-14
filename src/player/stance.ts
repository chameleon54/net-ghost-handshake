import { playerConfig } from '../config/player';

// Standing, crouching and sliding, as a small state machine with no browser or three.js code.
// Standing up is refused while a ceiling is in the way (canStand false), so crouching under a low beam keeps you crouched.

export type Stance = 'standing' | 'crouching' | 'sliding';

export interface StanceSettings {
  slideDurationSec: number;
  slideCooldownSec: number;
  slideEntrySpeedMps: number;
  slideBlockedSpeedMps: number;
  slideStartSpeedMps: number;
  slideEndSpeedMps: number;
}

export interface StanceInput {
  /** C is held. */
  crouchHeld: boolean;
  /** C went down since the last update. */
  crouchPressed: boolean;
  /** Shift is held. */
  sprintHeld: boolean;
  /** W minus S: above 0 means moving forward. */
  forwardInput: number;
  /** There is room to stand at full height here. */
  canStand: boolean;
}

export class StanceMachine {
  stance: Stance = 'standing';
  /** True while sprinting: standing, Shift held and moving forward. */
  sprinting = false;
  /** True only for the update in which a slide began. */
  slideStarted = false;

  private slideElapsedSec = 0;
  private cooldownLeftSec = 0;

  constructor(private readonly settings: StanceSettings = playerConfig) {}

  /** Speed the slide should have right now. */
  get slideSpeedMps(): number {
    const progress = Math.min(this.slideElapsedSec / this.settings.slideDurationSec, 1);
    return this.settings.slideStartSpeedMps + (this.settings.slideEndSpeedMps - this.settings.slideStartSpeedMps) * progress;
  }

  /** Back to standing, with no slide and no cooldown (instant restart). */
  reset(): void {
    this.stance = 'standing';
    this.sprinting = false;
    this.slideStarted = false;
    this.slideElapsedSec = 0;
    this.cooldownLeftSec = 0;
  }

  /** `measuredSpeedMps` is how fast the player really moved last update, after walls. */
  update(input: StanceInput, dtSec: number, measuredSpeedMps: number): void {
    this.slideStarted = false;

    if (this.stance === 'sliding') {
      this.slideElapsedSec += dtSec;
      const finished = this.slideElapsedSec >= this.settings.slideDurationSec;
      const blocked = measuredSpeedMps < this.settings.slideBlockedSpeedMps;
      if (finished || blocked) {
        // Releasing C does not cancel a slide, but C still decides crouch or stand once it ends.
        this.stance = input.crouchHeld || !input.canStand ? 'crouching' : 'standing';
        this.cooldownLeftSec = this.settings.slideCooldownSec;
      }
    } else {
      this.cooldownLeftSec = Math.max(0, this.cooldownLeftSec - dtSec);
      const sprintingForward = input.sprintHeld && input.forwardInput > 0;
      const canSlide =
        this.stance === 'standing' &&
        input.crouchPressed &&
        sprintingForward &&
        measuredSpeedMps >= this.settings.slideEntrySpeedMps &&
        this.cooldownLeftSec <= 0;

      if (canSlide) {
        this.stance = 'sliding';
        this.slideElapsedSec = 0;
        this.slideStarted = true;
      } else {
        this.stance = input.crouchHeld || !input.canStand ? 'crouching' : 'standing';
      }
    }

    this.sprinting = this.stance === 'standing' && input.sprintHeld && input.forwardInput > 0;
  }
}
