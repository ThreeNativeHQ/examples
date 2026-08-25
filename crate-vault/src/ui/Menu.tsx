import { useUiIntent } from "@threenative/ui";
import { type KeyboardEvent, useState } from "react";

export function Menu() {
  const [paused, setPaused] = useState(false);
  // Intents, not method calls: on native this component runs in the platform's web view, in a
  // different realm from the game, and cannot hold a reference to it. The game decides what
  // pausing and restarting mean; this only says which one the player asked for.
  const sendIntent = useUiIntent();
  const togglePause = () => {
    sendIntent(paused ? "resume" : "pause");
    setPaused((value) => !value);
  };
  const restart = () => {
    sendIntent("restart");
    setPaused(false);
  };
  const handleKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    togglePause();
  };

  return (
    <div className="pointer-events-none absolute bottom-6 right-6 flex items-center gap-3 border border-line bg-panel/75 px-4 py-3 text-[11px] uppercase tracking-[0.14em] text-dim">
      <span>shove crates onto the pad</span>
      <button
        className="pointer-events-auto border border-line px-2 py-1 text-text hover:border-lume"
        aria-pressed={paused}
        onClick={togglePause}
        onKeyDown={handleKeyDown}
        type="button"
      >
        {paused ? "resume" : "pause"}
      </button>
      <button
        className="pointer-events-auto border border-line px-2 py-1 text-text hover:border-lume"
        onClick={restart}
        type="button"
      >
        restart
      </button>
    </div>
  );
}
