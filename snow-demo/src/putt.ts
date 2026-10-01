/**
 * Snow Putt: the rules. Push the ball through deep powder into the cup pressed into the snow,
 * within par and before the round's clock runs out. Pure data and arithmetic — the scene feeds it
 * the ball's solved pose each fixed step and draws what it reports.
 */
export const PAR = 6;
export const ROUND_SECONDS = 90;
/** Where the cup is pressed into the snow, and how close the ball's centre must rest to it. */
export const CUP = { radius: 0.55, x: -2.2, z: -6.2 } as const;
/** Where the ball starts each round. */
export const TEE = { x: 2.2, z: -2 } as const;
/** The explorer must stand this close to the ball's centre to push it. */
export const REACH = 1.6;
/** The ball counts as resting below this speed, m/s. */
const RESTING = 0.3;
/** After the last push, the ball must sit still this long before the round is called lost. */
const SETTLE_SECONDS = 1.5;

export type PuttStatus = "playing" | "won" | "lost";

export class PuttRound {
  pushes = 0;
  timeLeft = ROUND_SECONDS;
  status: PuttStatus = "playing";
  reason: "" | "time" | "pushes" = "";
  /** Metres from the ball's centre to the cup's centre, on the ground plane. */
  distance = Math.hypot(CUP.x - TEE.x, CUP.z - TEE.z);
  #still = 0;

  /** Counts a push. Returns false when the round is over and the push must not happen. */
  push(): boolean {
    if (this.status !== "playing") return false;
    this.pushes += 1;
    this.#still = 0;
    return true;
  }

  update(dt: number, ball: { readonly x: number; readonly z: number; readonly speed: number }) {
    if (this.status !== "playing") return;
    this.distance = Math.hypot(CUP.x - ball.x, CUP.z - ball.z);
    if (this.distance <= CUP.radius && ball.speed < RESTING) {
      this.status = "won";
      return;
    }
    this.timeLeft = Math.max(0, this.timeLeft - dt);
    if (this.timeLeft === 0) {
      this.status = "lost";
      this.reason = "time";
      return;
    }
    this.#still = ball.speed < 0.05 ? this.#still + dt : 0;
    if (this.pushes >= PAR && this.#still >= SETTLE_SECONDS) {
      this.status = "lost";
      this.reason = "pushes";
    }
  }
}
