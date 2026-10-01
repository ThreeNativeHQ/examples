import type { GameState } from "../state.js";

const clock = (seconds: number) =>
  `${Math.floor(seconds / 60)}:${String(Math.ceil(seconds) % 60).padStart(2, "0")}`;

/** The round's scorecard: pushes against par, distance to the cup, and the clock. */
export function PuttCard({ state }: { readonly state: GameState }) {
  const { distance, par, pushes, timeLeft } = state.putt;
  const late = timeLeft < 20;
  return (
    <section
      aria-label="Snow Putt scorecard"
      className="absolute right-[34px] top-[103px] w-[236px] rounded-[15px] border border-line bg-panel p-4 text-right backdrop-blur-xl max-[1100px]:w-[216px] max-[850px]:right-4 max-[850px]:top-[84px] max-[850px]:w-[176px] max-[850px]:p-3"
    >
      <div className="mb-2 text-[9px] tracking-[0.2em] text-[#c2d6e0]">SNOW PUTT · PAR {par}</div>
      <div className="flex items-end justify-between gap-3">
        <div className="text-left">
          <div className="text-[28px] font-light leading-none tabular-nums">
            {pushes}
            <small className="ml-0.5 text-[11px] opacity-70">/{par}</small>
          </div>
          <div className="mt-1.5 text-[9px] tracking-[0.18em] opacity-80">PUSHES</div>
        </div>
        <div>
          <div
            className={`text-[28px] font-light leading-none tabular-nums ${late ? "text-[#f0b48c]" : ""}`}
          >
            {clock(timeLeft)}
          </div>
          <div className="mt-1.5 text-[9px] tracking-[0.18em] opacity-80">BEFORE IT SNOWS IN</div>
        </div>
      </div>
      <div className="mt-3 flex justify-between border-t border-line pt-3 text-[10px] text-[#9ebac8]">
        <span>To the cup</span>
        <span className="tabular-nums text-[#d0e7e7]">{distance.toFixed(1)} m</span>
      </div>
    </section>
  );
}

/** Shown once the round ends; the button starts a new one with fresh snow. */
export function RoundOver({
  onAgain,
  state,
}: {
  readonly onAgain: () => void;
  readonly state: GameState;
}) {
  const { par, pushes, reason, status } = state.putt;
  if (status === "playing") return null;
  const won = status === "won";
  const title = won ? "In the cup." : reason === "time" ? "The cup snowed in." : "Out of pushes.";
  const detail = won
    ? `${pushes} ${pushes === 1 ? "push" : "pushes"} on a par ${par}${pushes < par ? " — under par." : "."}`
    : "Fresh snow and a new cup are one press away.";
  return (
    <div className="pointer-events-auto absolute left-1/2 top-[96px] z-30 w-[min(340px,calc(100vw-32px))] -translate-x-1/2 rounded-[15px] max-[850px]:top-auto max-[850px]:bottom-[84px] border border-line bg-[rgb(16_35_46/0.9)] p-6 text-center backdrop-blur-xl">
      <h2 className="m-0 text-[26px] font-[450] tracking-[-0.03em]">{title}</h2>
      <p className="mb-5 mt-2 text-[12px] leading-[1.6] opacity-90">{detail}</p>
      <button
        className="min-h-11 rounded-[9px] border border-line bg-[rgb(199_115_55/0.9)] px-5 text-[12px] font-medium tracking-[0.06em] transition hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
        data-tn-interactive
        onClick={onAgain}
        type="button"
      >
        Play again (R)
      </button>
    </div>
  );
}
