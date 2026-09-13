import { acceptHotUpdate } from "@threenative/core/hot";
import game from "./game.js";
import { createDomShell } from "./ui/dom.js";
import { setShell } from "./ui/port.js";
import "./style.css";

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
setShell(createDomShell());
void game.start();
