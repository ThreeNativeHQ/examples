import { acceptHotUpdate } from "@threenative/core/hot";
import game from "./game.js";
import "./style.css";

import.meta.hot?.accept();
acceptHotUpdate(game, import.meta.hot);
void game.start();
