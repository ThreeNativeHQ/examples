export type GameState = {
  /** 1..8, the experiment on screen. */
  experiment: number;
  /** Quality preset: 0 light, 1 balanced, 2 high. */
  quality: number;
  steps: number;
  /** Live particles (the ocean reports 0). */
  particles: number;
  /** Mean max(0, density - 1) over live particles; 0 is incompressible. */
  compression: number;
  maxSpeed: number;
  /** Wave energy of the ocean's ripple field. */
  waveEnergy: number;
  /** 1 once the experiment holds particles or waves, whatever else it does. */
  alive: number;
  /** 1 once the experiment has moved: a particle speed over 0.2 m/s, or any wave energy. */
  moved: number;
  /** Times the experiment's action ran. */
  actions: number;
  /** Rigid bodies the experiment drives. */
  bodies: number;
  fps: number;
};
