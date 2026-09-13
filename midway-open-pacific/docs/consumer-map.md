# Consumer map — asset/battle integration Phase 2

Read-only survey. Every citation is `path:line`. "not present" means the thing does not exist.

## 1. LOADOUTS in src/sim/armament.ts — every entry, id, and field

`ILoadout` fields are declared at `src/sim/armament.ts:6-14`; the frozen `LOADOUTS` map is
`src/sim/armament.ts:16-35`.

| id | airframe | name | description | bombs | torpedo | kind |
|---|---|---|---|---|---|---|
| `bomb` | `sbd` | SBD Dauntless | Dive strike · 1 heavy + 2 light bombs | 3 | 0 | `bomber` |
| `torpedo` | `tbd` | TBD Devastator | Torpedo strike · 1 Mark 13 | 0 | 1 | `torpedo` |

```ts
// src/sim/armament.ts:17-25
bomb: {
  id: "bomb", airframe: "sbd", name: "SBD Dauntless",
  description: "Dive strike · 1 heavy + 2 light bombs",
  bombs: 3, torpedo: 0, kind: "bomber",
},
```

`applyLoadout` copies `loadout`, `airframe`, `kind`, `bombs`, `torpedo` onto the player
(`src/sim/armament.ts:40-46`) and `updateStores` derives `payloadMass`/`payloadDrag`
(`src/sim/armament.ts:59-63`).

## 2. Battle.selectLoadout — what it sets and who calls it

`src/sim/battle.ts:200-207`:

```ts
selectLoadout(id: string): boolean {
  const p = this.player;
  if (!["briefing", "playing"].includes(this.status) || p.mode !== "deck" || (p.deckSpeed || 0) >= 0.5 || !["bomb", "torpedo"].includes(id))
    return false;
  const ok = applyLoadout(p, id);
  if (ok) this.playerFlight.setAirframe(p.airframe);
  return ok;
}
```

It sets, via `applyLoadout`: `p.loadout`, `p.airframe`, `p.kind`, `p.bombs`, `p.torpedo`
(`src/sim/armament.ts:40-46`), plus `payloadMass`/`payloadDrag` (`src/sim/armament.ts:59-63`);
for `torpedo` it also clears `brakes`/`brakePos` (`src/sim/armament.ts:47-50`). Then it calls
`this.playerFlight.setAirframe(p.airframe)` (`src/sim/battle.ts:205`).

Call sites:
- `src/scenes/Midway.ts:376` (fresh start: `this.battle.selectLoadout(choice)`)
- `src/scenes/Midway.ts:445` (private wrapper; returns false → "LOADOUT LOCKED")
- wrapper invoked from DOM handlers `src/scenes/Midway.ts:141` and `src/scenes/Midway.ts:149`
- `scripts/check-flight.mjs:55` and `scripts/check-flight.mjs:99`

## 3. WorldView.setAirframe — the model branch

`src/render/world.ts:208-221`:

```ts
setAirframe(): void {
  const type = this.battle.player.airframe || "sbd";
  if (this.playerMesh?.userData.airframe === type) return;
  if (this.playerMesh) {
    this.playerMesh.removeFromParent();
    if (this.playerMesh.userData.importedAircraft) disposeDouglas(this.playerMesh);
    else this.disposeModel(this.playerMesh);
  }
  this.playerMesh = type === "sbd" ? createDouglas(true) : makeDauntless(true);
  this.playerMesh.userData.airframe = type;
```

Only `type === "sbd"` gets the imported Douglas; **every other airframe** (currently the `tbd`
torpedo loadout) gets the procedural `makeDauntless(true)`. Condition quoted above at
`src/render/world.ts:216`.

## 4. buildAircraft — carried torpedo geometry

`src/render/world.ts:549-556`:

```ts
if (a.kind === "torpedo") {
  const load = m.userData.load as T.Object3D | undefined;
  if (load) load.visible = false;
  const torpedo = makeTorpedoModel();
  torpedo.position.set(0, -1.03, -0.1);
  m.add(torpedo);
  m.userData.torpedoLoad = torpedo;
}
```

Yes — attached directly to the aircraft group `m` via `m.add(torpedo)` and stored as
`m.userData.torpedoLoad`. `makeTorpedoModel` is imported from `./model-damage.js`
(`src/render/world.ts:11`). The torpedo is shown/hidden from the sim's `a.torpedo` count in
`src/render/world.ts:342`.

## 5. animateDouglas / disposeDouglas — every call site

Definitions: `animateDouglas` `src/render/imported-aircraft.ts:236`; `disposeDouglas`
`src/render/imported-aircraft.ts:264`.

`animateDouglas(root, p, dt)` calls:
- `src/render/imported-aircraft.ts:219` (inside `createDouglas`)
- `src/render/world.ts:289` (parked deck aircraft: `{ rpm: .12, gearPos: 1 }`)
- `src/render/world.ts:335` (AI Douglas in flight)
- `src/render/world.ts:367` (player Douglas)
- `scripts/check-aircraft.mjs:136`, `:145`, `:187`, `:205`, `:219`

`disposeDouglas(root)` calls:
- `src/render/world.ts:213` (replacing the player mesh in `setAirframe`)
- `src/render/world.ts:563` (`releaseAircraft`, when an AI mesh is dropped)
- `scripts/check-aircraft.mjs:221`, `:222`

## 6. imported-aircraft.ts — which models it loads, and what selects between them

It loads exactly one model: `/assets/aircraft.douglas-sbd3.glb` (`src/render/imported-aircraft.ts:46`,
`createDouglas` at `:64`). There is no selection between models inside this file.

Selection between imported airframes lives in `src/render/world.ts:24-33`, keyed by **team and
kind** (not an explicit id):

```ts
function importedAircraftFor(a: { team: string; kind: string }): (() => T.Group) | undefined {
  if (a.team === "jp" && a.kind === "fighter") return createZero;
  if (a.team === "us" && a.kind === "bomber")
    return () => {
      const douglas = createDouglas();
      douglas.userData.douglas = true;
      return douglas;
    };
  return undefined;
}
```

`buildAircraft` calls it at `src/render/world.ts:541`; `wantsDetail` gates it at
`src/render/world.ts:534-538` (`importedAircraftFor(a)` truthy, range < 1500 when had, else
range < 1100 and granted < 10).

## 7. sizeCarrier — fields written, and when

`src/render/world.ts:47-59`.

Writes on the sim ship record:
- `ship.visualLength` — `src/render/world.ts:51`
- `ship.length` — `src/render/world.ts:53` (home) or `:56` (target)
- `ship.width` — `src/render/world.ts:54` (home) or `:57` (target)

```ts
ship.visualLength = japanese && ijn ? ijn.length : DECKS[id].visualLength;
if (isHome) {
  ship.length = DECKS[id].length;
  ship.width = DECKS[id].width;
} else {
  ship.length = ship.visualLength;
  ship.width = japanese && ijn ? ijn.beam : 32.4;
}
```

Point in the frame: it is **not** in `update()`. It is called once when the world is built
(`src/render/world.ts:177`, inside `makeWorld`) and again on restart
(`src/render/world.ts:252`, inside `reset`).

## 8. setupFleet — every ship and its dimension fields

`src/sim/battle.ts:224-278`. The `add` helper sets common fields at `src/sim/battle.ts:228-256`:
`length` = `cv ? 250 : sub ? 92 : 112` (`:239`), `width` = `cv ? 35 : sub ? 9 : 13` (`:240`),
`hp`/`maxHp` = `cv ? 340 : sub ? 90 : 145` (`:241-242`), `speed`/`baseSpeed` =
`sub ? 4 : cv ? 8 : 10` (`:237-238`), `reserve: cv ? 12 : 0` (`:247`).

Created ships (`src/sim/battle.ts:261-277`):

| name | team | kind | x | z | heading |
|---|---|---|---|---|---|
| USS Enterprise | us | carrier | 0 | 7000 | 0 |
| USS Hornet | us | carrier | 1450 | 7950 | 0 |
| USS Yorktown | us | carrier | -1900 | 7700 | 0 |
| USS Northampton | us | cruiser | -950 | 6150 | 0 |
| USS Phelps | us | destroyer | 800 | 5900 | 0 |
| USS Hammann | us | destroyer | -2400 | 6750 | 0 |
| USS Balch | us | destroyer | 2200 | 7350 | 0 |
| Akagi | jp | carrier | -4300 | -9200 | 2.85 |
| Kaga | jp | carrier | -6100 | -8500 | 2.85 |
| Soryu | jp | carrier | -3550 | -11150 | 2.85 |
| Hiryu | jp | carrier | -5700 | -11400 | 2.85 |
| Tone | jp | cruiser | -2500 | -8900 | 2.85 |
| Chikuma | jp | cruiser | -6900 | -9950 | 2.85 |
| Arashi | jp | destroyer | -5000 | -7300 | 2.85 |
| Nowaki | jp | destroyer | -7350 | -7800 | 2.85 |
| I-168 | jp | sub | -2100 | 3000 | 0.05 |
| USS Nautilus | us | sub | -8000 | -6400 | 1.65 |

## 9. launch — where the "reserve of 12" comes from, and what decrements it

Origin: `src/sim/battle.ts:247` (`reserve: cv ? 12 : 0`) — carriers start at 12, everything else
at 0.

Decrements:
- `src/sim/battle.ts:564` (`launch`: `s.reserve -= 1`), gated by `s.reserve < 1` at `:563`
- `src/sim/battle.ts:961` (bomb damage: `s.reserve = Math.max(0, s.reserve - Math.ceil(amount / 40))`)
- `src/sim/battle.ts:991` (strafing: `if (this.random() < 0.03 && s.reserve > 0) s.reserve -= 1`)

Also incremented when an AI aircraft recovers (`src/sim/tactics.ts:207`, `h.reserve += 1`) and
read to size the deck park (`src/render/world.ts:287`, `i < Math.ceil(s.reserve / 2)`).

## 10. updateShips — the modulo expression choosing aircraft types

`src/sim/battle.ts:1125`:

```ts
const kind = s.launchCount % 4 === 0 ? "fighter" : s.launchCount % 3 === 0 ? "torpedo" : "bomber";
```

Context: `updateShips`, `src/sim/battle.ts:1122-1128`, fires when `s.nextLaunch <= 0` and
resets `s.nextLaunch = 23 + this.random() * 12`.

## 11. updateIntel and recordContact — fields copied, and from where

`recordContact(s, source = "visual")` `src/sim/battle.ts:832-867` writes **two** records from the
live ship `s`:

- `teamIntel.us` (`:833-847`): `id, name, kind, x, z, heading, speed, width, length, deck, sunk,
  time, confidence`
- `contacts` (`:849-861`): `id, name, kind, x, z, heading, speed, time, confidence, source,
  reported`

```ts
this.contacts.set(s.id, {
  id: s.id, name: s.name, kind: s.kind, x: s.x, z: s.z,
  heading: s.heading, speed: s.speed, time: this.time,
  confidence: source === "visual" ? 1 : 0.83,
  source, reported: prev?.reported || false,
});
```

`updateIntel()` `src/sim/battle.ts:1708-1746` copies into `teamIntel[team]` from the live
`target` (`:1718-1732`): same field set as `recordContact`'s teamIntel entry. Detection is
`seen` at `src/sim/battle.ts:1713-1716`; player visual contact calls `recordContact(s)` at
`:1739`, PBY contact calls `recordContact(s, "PBY reconnaissance")` at `:1742`.

## 12. selectNavalTarget — file, and whether it reads contacts or live entities

File: `src/sim/tactics.ts:21`. It reads the **per-team intel map** (`b.teamIntel[a.team]`), not
`b.contacts` and not live ship entities:

```ts
// src/sim/tactics.ts:22-26
const known = b.teamIntel[a.team];
if (!known) return null;
const candidates = [...known.values()].filter(
  (c: Any) => c.kind === "carrier" && !c.sunk && b.time - c.time < 240,
);
```

Returned targets are `contactEstimate(c, b.time)` plus the original `c.id`
(`src/sim/tactics.ts:29`, `:39`, `:55`). Called from `src/sim/tactics.ts:387`.

## 13. Submarine behaviour in battle.ts — surfacing expression and target selection

`src/sim/battle.ts:1130-1143`:

```ts
if (s.kind === "sub") {
  s.surfaced = Math.sin(this.time / 70 + s.baseX) > 0.1;
  s.torpTimer -= dt;
  const targets = this.ships.filter((t) => t.team !== s.team && !t.sunk && t.kind === "carrier").sort((a, b) => distance2(s, a) - distance2(s, b));
  const t = targets[0];
  if (t) {
    s.heading = wrap(s.heading + clamp(angleDelta(bearing(s, t), s.heading), -0.06 * dt, 0.06 * dt));
    if (s.torpTimer <= 0 && distance2(s, t) < 4800) {
      for (const off of [-0.025, 0, 0.025]) this.spawnTorpedo(s, bearing(s, t) + off);
```

Surfacing: `s.surfaced = Math.sin(this.time / 70 + s.baseX) > 0.1;` (`:1131`). Target selection:
nearest non-sunk enemy **carrier** (`:1133-1134`), steered by `s.heading` (`:1136`); fires a
three-torpedo spread under 4800 m (`:1137-1138`).

## 14. finalReady — full signature and every call site

Signature, `src/sim/recovery.ts:78`:

```ts
export function finalReady(p: Any, s: Any): boolean
```

Body gates on `s` live, `p.mode === "flight"`, `p.gear`, and the `FINAL` envelope
(`src/sim/recovery.ts:79-89`).

Call sites:
- `src/sim/recovery.ts:114` — inside `approach()`, which sets the `ready` flag and the
  `"READY FOR L"` cue (`:129`)
- `src/sim/battle.ts:1468` — inside `assistRecovery()`
- indirect: the HUD reaches it through `b.approach()` (`src/hud.ts:190` → `src/sim/battle.ts:443`
  → `src/sim/recovery.ts:114`)

## 15. imported-ships.ts DECKS — who reads height, length, width, visualLength

`DECKS` definition: `src/render/imported-ships.ts:8-13`.

- `visualLength`: written/read in `src/render/world.ts:51`; read from the ship in
  `src/render/ocean.ts:150` (`s.visualLength ?? s.length`) via the `vessels` type
  `src/render/ocean.ts:143`.
- `length`: `src/render/world.ts:53` (`ship.length = DECKS[id].length`); also `IJN_CARRIERS`
  lengths at `src/render/imported-ships.ts:73` and `src/render/world.ts:51`. Consumed as
  `ship.length` in `src/sim/math.ts:35`, `src/sim/battle.ts:1681`, `src/render/assets.ts:454-460`,
  `src/render/ocean.ts:150`; copied by `recordContact`/`updateIntel` (`src/sim/battle.ts:842`,
  `:1727`).
- `width`: `src/render/world.ts:54` (`ship.width = DECKS[id].width`) and `:57`; consumed as
  `ship.width` in `src/sim/math.ts:35`, `src/sim/gunnery.ts:62,64,98,100`,
  `src/render/world.ts:57`, `src/render/ocean.ts:151`, `src/render/assets.ts:454-466`; copied by
  `recordContact`/`updateIntel` (`src/sim/battle.ts:841`, `:1726`).
- `height`: **not present** as a reader — it is only defined (`src/render/imported-ships.ts:9,10,12`).
  The parked-aircraft Y uses a literal `20.06` instead (`src/render/world.ts:187`).

## 16. Where B-25s are parked, and the condition deciding which carriers get them

`src/render/world.ts:182-193`, inside the `s.kind === "carrier"` branch, added to the detailed
carrier group `detailed.add(plane)`:

```ts
for (let i = 0; i < (s.team === "us" ? (id === "enterprise" ? 2 : 3) : 0); i++) {
  const plane = id === "hornet" ? createMitchell() : createDouglas();
  plane.userData.parkedDouglas = id !== "hornet";
  plane.position.set(
    id === "enterprise" ? -4.5 : -1,
    20.06 + (id === "enterprise" ? 1.82 : 0),
    72 + i * 16,
  );
  if (id === "enterprise") plane.rotation.x = .22;
  detailed.add(plane);
  mesh.userData.parked.push(plane);
}
```

The carrier id is resolved at `src/render/world.ts:168`:
`const id = japanese ? "akagi" : s.name === "USS Enterprise" ? "enterprise" : "hornet";`.
So only `id === "hornet"` gets `createMitchell()` (B-25) — which is **both USS Hornet and USS
Yorktown**, since only Enterprise is special-cased. Enterprise gets 2 procedural Douglas; the
three IJN carriers get 0.

## 17. ocean.ts — wake slot limit (20), and how a ship is chosen for a slot

Slot limit: `src/render/ocean.ts:21-22` allocate 20 `Vector4` ships/sizes, and the shader loop
runs `for (let i = 0; i < ships.length; i++)` (`src/render/ocean.ts:108`, `:147`).

How a ship is chosen (`src/render/ocean.ts:147-153`):

```ts
for (let i = 0; i < ships.length; i++) {
  const s = vessels[i];
  if (s && !s.sunk && (s.kind !== "sub" || s.surfaced)) {
    ships[i].set(s.x, s.z, s.heading, s.visualLength ?? s.length);
    sizes[i].set(s.width, s.speed, Math.min(1, s.speed / 8), 0);
  } else sizes[i].z = 0;
}
```

The slot is positional: `vessels[i]` is the i-th entry of the array passed in, which is
`b.ships` (`src/render/world.ts:374`, `this.ocean.update(this.camera.position, time, b.ships)`).
A ship occupies its index unless it is `sunk` or a submerged `sub`, in which case the slot is
zeroed (`sizes[i].z = 0`).

## 18. sortie.ts — assignment kinds and the target-kind/id contract used by HUD and map

Assignment kinds (`src/sim/sortie.ts:8`):

```ts
export type Assignment = "strike" | "recon" | "operation";
```

Named in `ASSIGNMENTS` (`src/sim/sortie.ts:15-28`): `strike` = `CARRIER STRIKE`, `recon` =
`SCOUT AND REPORT`, `operation` = `OPEN PACIFIC`.

Target contract:
- `ISortie.target` is a **ship id** (`string | null`) — `src/sim/sortie.ts:65`.
- A stamped weapon carries the same `target` id (`IStamp.target`, `src/sim/sortie.ts:31-35`;
  `stamp`, `:94-96`).
- `hitQualifies` requires the ship be an enemy carrier and the id match
  (`src/sim/sortie.ts:113-114`):

```ts
if (!ship || ship.kind !== "carrier" || ship.team === "us") return false;
return mark.target === ship.id;
```

HUD use:
- `src/hud.ts:199-200` — looks the target up by id: `b.ships.find((s: any) => s.id === sortie.target)`;
  prints `ASSIGNMENTS[sortie.assignment].name · TARGET <name>`.
- `src/hud.ts:95`, `:313`, `:352` — `b.contacts.get(b.target)`.
- Map highlight by id: `src/hud.ts:667` (`e.id === b.target ? 12 : 9`).
- Map/contact list filters on `kind === "carrier"`: `src/hud.ts:691`.
- Target cycling filters contacts on `kind === "carrier"` and sets `battle.target = next.id`
  (`src/scenes/Midway.ts:469-476`).

DONE docs/consumer-map.md
