export type GameState = {
  barrierHeld: number;
  blasts: number;
  deformation: number;
  outcome: "lost" | "playing" | "won";
  solverSteps: number;
};
