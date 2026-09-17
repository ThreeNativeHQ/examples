import { acceptHotUpdate } from "@threenative/core/hot";
import game from "./game.js";
import { createDomShell } from "./ui/dom.js";
import { setShell } from "./ui/port.js";

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
// The DOM in index.html is this game's UI, and only the web entry knows about it. The native
// entry (src/game.ts) keeps the null shell and runs the same simulation with no UI.
setShell(createDomShell());
void game.start();
