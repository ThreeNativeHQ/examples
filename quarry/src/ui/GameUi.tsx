import { UiLayer } from "@threenative/ui";

export function GameUi() {
  return <UiLayer><header><span>FIELD NOTES / 01</span><h1>QUARRY</h1><p>A walk through stone</p></header><footer><span>W A S D — WALK</span><span>Q / E — TURN</span><span>SPACE — JUMP</span></footer><div className="crosshair">·</div></UiLayer>;
}
