import { Scene, type SceneFrame } from "@threenative/core";
import type { IPhysicsContext } from "@threenative/physics";
import { Color } from "three";
import { EXPERIMENTS, type GameCtx, type IRun, QUALITIES } from "../experiments.js";
import type { GameState } from "../state.js";

const SPEED_THAT_COUNTS_AS_MOVING = 0.2;
const query = (name: string): string | null =>
  new URLSearchParams(globalThis.location?.search ?? "").get(name);

export class Lab extends Scene<GameState, IPhysicsContext> {
  static override readonly initialState: GameState = {
    actions: 0,
    alive: 0,
    bodies: 0,
    compression: 1,
    experiment: 1,
    fps: 0,
    maxSpeed: 0,
    moved: 0,
    particles: 0,
    quality: 1,
    steps: 0,
    waveEnergy: 0,
  };

  override enter(ctx: GameCtx): SceneFrame<GameState, IPhysicsContext> {
    ctx.scene.background = new Color(0x05070e);
    let quality = Math.min(2, Math.max(0, ["light", "balanced", "high"].indexOf(query("quality") ?? "balanced")));
    if (query("quality") === null) quality = 1;
    let index = Math.min(7, Math.max(0, Number(query("exp") ?? "1") - 1));
    let run: IRun | undefined;
    let peak = 0;
    let actions = 0;
    let steps = 0;

    const start = (next: number): void => {
      run?.dispose();
      index = next;
      peak = 0;
      actions = 0;
      run = (EXPERIMENTS[index] ?? EXPERIMENTS[0]!).start({
        ctx,
        quality: QUALITIES[quality] ?? QUALITIES[1]!,
        restart: () => start(index),
      });
    };
    start(index);

    if (query("bench") !== null) {
      // Back-to-back solver steps timed to GPU completion: one fixed step's cost, with no
      // presentation in the number. `?bench=1&exp=2&quality=high` is the measured case.
      const device = (ctx.renderer.raw as { backend?: { device?: { queue: { onSubmittedWorkDone(): Promise<void> } } } })
        .backend?.device;
      (globalThis as Record<string, unknown>).__fluidBench = async (count: number) => {
        await device?.queue.onSubmittedWorkDone();
        const begin = performance.now();
        for (let step = 0; step < count; step += 1) run?.water?.process(ctx.renderer);
        await device?.queue.onSubmittedWorkDone();
        return (performance.now() - begin) / count;
      };
    }

    return (frame, dt) => {
      for (let key = 1; key <= EXPERIMENTS.length; key += 1)
        if (frame.input.justPressed(`exp${key}`)) start(key - 1);
      if (frame.input.justPressed("quality")) {
        quality = (quality + 1) % QUALITIES.length;
        start(index);
      }
      if (frame.input.justPressed("act")) {
        run?.act();
        actions += 1;
      }
      if (frame.input.justPressed("toggle")) run?.toggle();

      steps += 1;
      const stats = run?.water?.stats;
      const energy = run?.ripple?.energy() ?? 0;
      peak = Math.max(peak, stats?.maxSpeed ?? 0);
      const particles = stats?.count ?? 0;
      frame.state.set({
        actions,
        alive: particles > 0 || energy > 0 ? 1 : 0,
        bodies: run?.bodyCount() ?? 0,
        compression: stats?.meanCompression ?? 1,
        experiment: index + 1,
        fps: dt > 0 ? Math.round(1 / dt) : 0,
        maxSpeed: stats?.maxSpeed ?? 0,
        moved: peak > SPEED_THAT_COUNTS_AS_MOVING || energy > 0 ? 1 : 0,
        particles,
        quality,
        steps,
        waveEnergy: energy,
      });
    };
  }
}
