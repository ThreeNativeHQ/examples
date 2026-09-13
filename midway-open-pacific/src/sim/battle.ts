/** Pure deterministic game state. Rendering, audio and browser APIs stay outside this module. */
import { updateGunnery, updateEvasion } from "./gunnery.js";
import { rearGunner, updateTacticalAircraft } from "./tactics.js";
import {
  aircraftHit,
  aircraftWorld,
  applyAircraftHit,
  damageSummary,
  initDamage,
  stepDamage,
  stepWheels,
  DAMAGE_ZONES,
  ZONE_POSITIONS,
  type DamageZone,
} from "./damage.js";
import { applyLoadout, torpedoEnvelope, type ILoadout, LOADOUTS } from "./armament.js";
import {
  AircraftFlight,
  airDensity,
  attitudeAxes,
  DECK_HEIGHT,
  gearClearance,
  setAttitude,
  SEA_WIND,
} from "./flight.js";
import {
  angleDelta,
  bearing,
  bombImpact,
  clamp,
  contactEstimate,
  distance2,
  distance3,
  forward,
  lerp,
  localPoint,
  onDeck,
  rng,
  wrap,
} from "./math.js";

type Any = any;

export { LOADOUTS };
export type { ILoadout };

export class Battle {
  random: () => number;
  seed: number;
  serial = 0;
  time = 0;
  status = "briefing";
  ships: Any[] = [];
  aircraft: Any[] = [];
  bullets: Any[] = [];
  bombs: Any[] = [];
  torpedoes: Any[] = [];
  airTorpedoes: Any[] = [];
  effects: Any[] = [];
  contacts = new Map<string, Any>();
  radio: Any[] = [];
  events: Any[] = [];
  reported = 0;
  score = 0;
  stats = {
    kills: 0,
    shipHits: 0,
    shipsSunk: 0,
    sorties: 1,
    bombsDropped: 0,
    torpedoesDropped: 0,
    friendlyHits: 0,
  };
  teamIntel: Record<string, Map<string, Any>> = { us: new Map(), jp: new Map() };
  command = "cover";
  target: string | null = null;
  intelTick = 0;
  reconNotice = false;
  threatNotice = false;
  island = { x: 9500, y: 0, z: 1500 };
  player: Any;
  playerFlight: AircraftFlight;
  wind = { ...SEA_WIND };
  search = { x: -4500, y: 1400, z: -9000 };
  reconLaunched = false;
  boundaryNotice = false;

  constructor(seed = 19420604) {
    this.random = rng(seed);
    this.seed = seed;
    this.setupFleet();
    const home = this.ships[0];
    this.player = {
      id: "player",
      kind: "bomber",
      team: "us",
      home: home.id,
      x: home.x,
      y: 23,
      z: home.z + 95,
      heading: home.heading,
      pitch: 0,
      roll: 0,
      speed: 0,
      throttle: 0.18,
      hp: 100,
      fuel: 100,
      ammo: 1400,
      rearAmmo: 240,
      rearTimer: 0,
      bombs: 3,
      torpedo: 0,
      gear: true,
      gearManual: false,
      autoGearPending: false,
      gearClimbTime: 0,
      brakes: false,
      mode: "deck",
      deckOffset: -55,
      vx: 0,
      vy: 0,
      vz: 0,
      gunTimer: 0,
      autopilot: false,
      nav: "search",
      serviceTime: 0,
      takeoffGrace: 0,
      heat: 0,
      payloadMass: 0,
      payloadDrag: 0,
    };
    Object.assign(this.player, {
      flaps: 0.33,
      assist: true,
      deckOffset: -55,
      deckLateral: 0,
      deckSpeed: 0,
      chocks: true,
      pitch: 0.22,
    });
    applyLoadout(this.player, "bomb");
    initDamage(this.player);
    this.playerFlight = new AircraftFlight(this.player, "sbd");
    this.playerFlight.reset();
    this.playerFlight.stepDeck(home, 0.001, {});
  }

  selectLoadout(id: string): boolean {
    const p = this.player;
    if (!["briefing", "playing"].includes(this.status) || p.mode !== "deck" || (p.deckSpeed || 0) >= 0.5 || !["bomb", "torpedo"].includes(id))
      return false;
    const ok = applyLoadout(p, id);
    if (ok) this.playerFlight.setAirframe(p.airframe);
    return ok;
  }

  toggleGear(): void {
    const p = this.player;
    p.gear = !p.gear;
    p.gearManual = true;
    p.autoGearPending = false;
  }

  releaseOrdnance(): boolean {
    return this.player.loadout === "torpedo" ? this.dropTorpedo(this.player) : this.dropBomb();
  }

  id(prefix: string): string {
    return `${prefix}-${++this.serial}`;
  }

  setupFleet(): void {
    const add = (name: string, team: string, kind: string, x: number, z: number, heading = 0) => {
      const cv = kind === "carrier";
      const sub = kind === "sub";
      const s = {
        id: this.id("ship"),
        name,
        team,
        kind,
        x,
        y: 0,
        z,
        heading,
        speed: sub ? 4 : cv ? 8 : 10,
        baseSpeed: sub ? 4 : cv ? 8 : 10,
        length: cv ? 250 : sub ? 92 : 112,
        width: cv ? 35 : sub ? 9 : 13,
        hp: cv ? 340 : sub ? 90 : 145,
        maxHp: cv ? 340 : sub ? 90 : 145,
        deck: 1,
        engine: 1,
        aa: 1,
        fire: 0,
        reserve: cv ? 12 : 0,
        nextLaunch: 22 + this.random() * 20,
        launchCount: 0,
        aaTimer: 1 + this.random() * 4,
        torpTimer: 40 + this.random() * 35,
        sunk: false,
        sink: 0,
        surfaced: true,
        baseX: x,
        baseZ: z,
      };
      this.ships.push(s);
      return s;
    };
    add("USS Enterprise", "us", "carrier", 0, 7000);
    add("USS Hornet", "us", "carrier", 1450, 7950);
    add("USS Yorktown", "us", "carrier", -1900, 7700);
    add("USS Northampton", "us", "cruiser", -950, 6150);
    add("USS Phelps", "us", "destroyer", 800, 5900);
    add("USS Hammann", "us", "destroyer", -2400, 6750);
    add("USS Balch", "us", "destroyer", 2200, 7350);
    add("Akagi", "jp", "carrier", -4300, -9200, 2.85);
    add("Kaga", "jp", "carrier", -6100, -8500, 2.85);
    add("Soryu", "jp", "carrier", -3550, -11150, 2.85);
    add("Hiryu", "jp", "carrier", -5700, -11400, 2.85);
    add("Tone", "jp", "cruiser", -2500, -8900, 2.85);
    add("Chikuma", "jp", "cruiser", -6900, -9950, 2.85);
    add("Arashi", "jp", "destroyer", -5000, -7300, 2.85);
    add("Nowaki", "jp", "destroyer", -7350, -7800, 2.85);
    add("I-168", "jp", "sub", -2100, 3000, 0.05);
    add("USS Nautilus", "us", "sub", -8000, -6400, 1.65);
  }

  start(airborne = false): void {
    if (this.status !== "briefing") return;
    this.status = "playing";
    for (const s of this.ships.filter((s) => s.kind === "carrier")) this.launch(s, "fighter");
    if (airborne) {
      this.player.mode = "spectator";
      for (let i = 0; i < 900; i += 1) this.step(1 / 30, {});
      Object.assign(this.player, {
        x: -3000,
        y: 1550,
        z: -2600,
        heading: 6.08,
        pitch: 0,
        speed: this.player.airframe === "tbd" ? 84 : 103,
        throttle: 0.9,
        gear: false,
        mode: "flight",
        takeoffGrace: 0,
      });
      this.player.flaps = 0;
      this.playerFlight.reset();
      this.radio = [];
      this.events = [];
      this.say("SCOUT CONTROL", "Search the northwest sector. No confirmed carrier positions. Scan the horizon; use R to report sightings.");
    } else
      this.say("ENTERPRISE TOWER", "Scout Two, cleared for launch. Hold W. Chocks release with power. Keep straight; ease the stick back (Down) through 90 knots. Lift, not the bow, gets you flying.");
    this.say("SCOUT THREE", "Two, we have your wing. Orders on your command.");
  }

  say(from: string, text: string, priority = false): void {
    this.radio.unshift({ id: this.id("radio"), from, text, time: this.time, priority });
    this.radio.length = Math.min(7, this.radio.length);
    this.events.push({ type: "radio", priority });
  }

  event(type: string, data: Record<string, unknown> = {}): void {
    this.events.push({ type, ...data });
    if (this.events.length > 80) this.events.shift();
  }

  fx(type: string, p: Any, size = 1): void {
    this.effects.push({
      id: this.id("fx"),
      type,
      x: p.x,
      y: p.y ?? 0,
      z: p.z,
      size,
      age: 0,
      life: type === "muzzle" ? 0.18 : type === "splash" ? 5 : type === "flak" ? 8 : type === "hit" ? 1.5 : 9,
    });
    if (this.effects.length > 140) this.effects.shift();
  }

  get home(): Any {
    return this.ships.find((s) => s.id === this.player.home);
  }

  get operationalEnemyCarriers(): Any[] {
    return this.ships.filter((s) => s.team === "jp" && s.kind === "carrier" && !s.sunk && s.deck > 0.22);
  }

  get navigationPoint(): Any {
    if (this.player.nav === "home") {
      const h = this.home;
      if (h && !h.sunk) return { ...h, y: 130 };
    }
    if (this.target) {
      const c = this.contacts.get(this.target);
      if (c) return { ...contactEstimate(c, this.time), y: 1800 };
    }
    return this.search;
  }

  setCommand(cmd: string): void {
    this.command = cmd;
    const texts: Record<string, string> = {
      cover: "Stay on my wing. Cover the Dauntless.",
      strike: "Attack the designated carrier. Break by sections.",
      engage: "Clear those fighters off our tails.",
      rtb: "All aircraft, return to your carriers.",
    };
    this.say("SCOUT TWO", texts[cmd] || cmd);
  }

  launch(s: Any, kind = "fighter"): Any {
    if (!s || s.sunk || (s.evadeUntil || 0) > this.time || s.deck < 0.35 || s.reserve < 1 || this.aircraft.filter((a) => a.hp > 0).length >= 68) return null;
    s.reserve -= 1;
    s.launchCount += 1;
    const f = forward(s.heading);
    const a: Any = {
      id: this.id("air"),
      team: s.team,
      kind,
      home: s.id,
      x: s.x + f.x * 100,
      y: 23,
      z: s.z + f.z * 100,
      heading: s.heading,
      pitch: 0.08,
      roll: 0,
      speed: 42,
      hp: kind === "fighter" ? 70 : 95,
      maxHp: kind === "fighter" ? 70 : 95,
      fuel: 520 + this.random() * 120,
      ammo: 350,
      bombs: kind === "bomber" ? 1 : 0,
      torpedo: kind === "torpedo" ? 1 : 0,
      mode: "launch",
      age: 0,
      think: 0,
      target: null,
      gunTimer: this.random(),
      attackCooldown: 0,
      wing: s.id === this.player?.home,
      phase: this.random() * 6.28,
      vx: 0,
      vy: 0,
      vz: 0,
    };
    initDamage(a);
    a.section = Math.floor((s.launchCount - 1) / 4);
    s.waveTimes ??= {};
    s.waveTimes[a.section] ??= this.time;
    a.musterUntil = s.waveTimes[a.section] + 85;
    a.fuelCapacity = a.fuel;
    a.airframe = kind === "torpedo" ? (s.team === "us" ? "tbd" : "kate") : kind === "fighter" ? (s.team === "us" ? "wildcat" : "zero") : "sbd";
    a.rearAmmo = kind === "fighter" ? 0 : 240;
    a.rearTimer = 0;
    this.aircraft.push(a);
    return a;
  }

  launchRecon(): void {
    const s = this.island;
    this.aircraft.push({
      id: this.id("air"),
      team: "us",
      kind: "recon",
      home: "midway",
      x: s.x,
      y: 25,
      z: s.z,
      heading: bearing(s, this.search),
      pitch: 0.15,
      roll: 0,
      speed: 66,
      hp: 85,
      maxHp: 85,
      fuel: 1200,
      ammo: 100,
      bombs: 0,
      torpedo: 0,
      mode: "launch",
      age: 0,
      think: 0,
      target: null,
      gunTimer: 0,
      attackCooldown: 0,
      wing: false,
      phase: 0,
      vx: 0,
      vy: 0,
      vz: 0,
    });
  }

  dropBomb(a: Any = this.player): boolean {
    if (a.mode !== "flight" && a.mode !== "attack") return false;
    if (a.bombs <= 0) {
      if (a === this.player) this.event("notice", { text: "NO BOMBS — RETURN TO A FRIENDLY CARRIER" });
      return false;
    }
    a.bombs -= 1;
    const f = forward(a.heading, a.pitch);
    const physical = Number.isFinite(a.vx);
    const heavy = a !== this.player || a.bombs >= 2;
    this.bombs.push({
      id: this.id("bomb"),
      x: a.x,
      y: a.y - 1.6,
      z: a.z,
      vx: physical ? a.vx : f.x * a.speed,
      vy: (physical ? a.vy : f.y * a.speed) - 2,
      vz: physical ? a.vz : f.z * a.speed,
      team: a.team,
      owner: a.id,
      age: 0,
      damage: heavy ? 155 : 55,
    });
    if (a === this.player) {
      this.stats.bombsDropped += 1;
      this.event("bomb");
    }
    return true;
  }

  fire(a: Any, aim: Any = null): void {
    if (a.ammo <= 0 || a.gunTimer > 0 || a.hp <= 0) return;
    a.gunTimer = a === this.player ? 0.075 : 0.2;
    a.ammo = Math.max(0, a.ammo - 2);
    let f = a === this.player && a.attitude ? attitudeAxes(a).f : forward(a.heading, a.pitch);
    if (aim) {
      const d = distance3(a, aim);
      const lead = d / 850;
      const tx = aim.x + (aim.vx || 0) * lead - a.x;
      const ty = aim.y + (aim.vy || 0) * lead - a.y;
      const tz = aim.z + (aim.vz || 0) * lead - a.z;
      const n = Math.hypot(tx, ty, tz) || 1;
      f = { x: tx / n, y: ty / n, z: tz / n };
    }
    const spread = a === this.player ? 0.003 : 0.012;
    // The player's guns are in the wings: offset along the body's own right axis so the tracers
    // leave the wing leading edge rather than the fuselage. AI aircraft keep the generic offset.
    const axes = a === this.player && a.attitude ? attitudeAxes(a) : null;
    const right = axes ? axes.r : { x: Math.cos(a.heading), y: 0, z: Math.sin(a.heading) };
    const up = axes ? axes.u : { x: 0, y: 1, z: 0 };
    const lateral = a === this.player ? 3.0 : 1.7;
    for (const side of [-1, 1]) {
      const ox = a.x + right.x * side * lateral + f.x * 5 + up.x * 0.05;
      const oy = a.y + right.y * side * lateral + f.y * 5 + up.y * 0.05;
      const oz = a.z + right.z * side * lateral + f.z * 5 + up.z * 0.05;
      this.bullets.push({
        id: this.id("bullet"),
        x: ox,
        y: oy,
        z: oz,
        vx: (f.x + (this.random() - 0.5) * spread) * 950,
        vy: (f.y + (this.random() - 0.5) * spread) * 950,
        vz: (f.z + (this.random() - 0.5) * spread) * 950,
        team: a.team,
        owner: a.id,
        ttl: 2.0,
        type: "gun",
      });
      if (a === this.player)
        this.fx("muzzle", {
          x: a.x + right.x * side * lateral + f.x * 1.7,
          y: a.y + right.y * side * lateral + f.y * 1.7,
          z: a.z + right.z * side * lateral + f.z * 1.7,
        }, 0.55);
    }
    if (a === this.player) {
      a.heat = 1;
      this.event("gun");
    }
  }

  report(): number {
    let count = 0;
    for (const [, c] of this.contacts)
      if (this.time - c.time < 4 && !c.reported) {
        c.reported = true;
        count += 1;
        this.reported += 1;
        this.score += 75;
      }
    if (count) {
      this.say("SCOUT TWO", `Enemy fleet confirmed. ${count} vessels. Transmitting bearing and course to the task force.`, true);
      this.say("ENTERPRISE", "Contact received. Strike groups are launching. Mark your target and press 2 to order the attack.");
    } else this.event("notice", { text: "NO NEW VISUAL CONTACTS TO REPORT" });
    return count;
  }

  recordContact(s: Any, source = "visual"): void {
    this.teamIntel.us.set(s.id, {
      id: s.id,
      name: s.name,
      kind: s.kind,
      x: s.x,
      z: s.z,
      heading: s.heading,
      speed: s.speed,
      width: s.width,
      length: s.length,
      deck: s.deck,
      sunk: s.sunk,
      time: this.time,
      confidence: 1,
    });
    const prev = this.contacts.get(s.id);
    this.contacts.set(s.id, {
      id: s.id,
      name: s.name,
      kind: s.kind,
      x: s.x,
      z: s.z,
      heading: s.heading,
      speed: s.speed,
      time: this.time,
      confidence: source === "visual" ? 1 : 0.83,
      source,
      reported: prev?.reported || false,
    });
    if (!prev && source === "visual" && s.kind === "carrier") {
      this.say("REAR GUNNER", `Carrier off the nose! ${s.name}, bearing ${String(Math.round((bearing(this.player, s) * 180) / Math.PI) % 360).padStart(3, "0")}. Press R to send the contact.`, true);
      if (!this.target) this.target = s.id;
    }
  }

  damagePlane(a: Any, amount: number, owner: string, zone: DamageZone = "fuselage", point: Any = null, incendiary = true): void {
    if (a.hp <= 0) return;
    const result = applyAircraftHit(a, amount, zone, this.random, incendiary);
    a.lastAttacker = owner;
    this.fx("hit", point || aircraftWorld(a, ZONE_POSITIONS[zone] || ZONE_POSITIONS.fuselage), 0.6);
    if (owner === "player" && a.team === "us") {
      this.stats.friendlyHits += 1;
      this.event("notice", { text: "CHECK FIRE — FRIENDLY AIRCRAFT" });
    }
    if (a === this.player) {
      this.event("damage");
      const summary = damageSummary(a).join(" · ");
      if (summary && this.time > (a.nextDamageRadio || 0)) {
        a.nextDamageRadio = this.time + 8;
        this.say("REAR GUNNER", `${summary}. Keep it flying. H for home; I cuts engine fuel.`, true);
      }
    }
    if (result?.killed) this.planeDestroyed(a, owner);
  }

  planeDestroyed(a: Any, owner: string): void {
    if (a.killCredited) return;
    a.killCredited = true;
    if (a === this.player) {
      this.lose("Aircraft lost to battle damage.");
      return;
    }
    a.hp = 0;
    a.mode = "crashing";
    a.crashAge = 0;
    a.vy = Math.min(-7, a.vy || 0);
    this.fx("explosion", a, 1.15);
    this.event("explosion", { distance: distance3(this.player, a) });
    if (a.damage) a.damage.engine.fire = Math.max(0.55, a.damage.engine.fire);
    if (owner === "player" && a.team === "jp") {
      this.score += 150;
      this.stats.kills += 1;
      this.event("notice", { text: "ENEMY AIRCRAFT DESTROYED  +150" });
    }
  }

  damageShip(s: Any, amount: number, point: Any, weapon = "bomb", team = "us"): void {
    if (s.sunk) return;
    s.hp = Math.max(0, s.hp - amount);
    if (weapon === "bomb") {
      s.deck = Math.max(0, s.deck - amount / 220);
      s.aa = Math.max(0.12, s.aa - amount / 600);
      s.fire = clamp(s.fire + amount / 160, 0, 2);
      s.reserve = Math.max(0, s.reserve - Math.ceil(amount / 40));
      s.engine = Math.max(0.12, s.engine - amount / 600);
      this.fx("explosion", point, weapon === "bomb" ? 3.2 : 1);
      this.event("explosion", { distance: distance3(this.player, point) });
      if (team === "us" && s.team === "jp") {
        this.stats.shipHits += 1;
        this.score += 250;
        this.event("notice", { text: `DIRECT HIT — ${s.name.toUpperCase()}  +250` });
      }
      if (s.kind === "carrier" && s.deck < 0.35 && !s.deckNotified) {
        s.deckNotified = true;
        this.say("BATTLE CONTROL", `${s.name}'s flight deck is out of action. Aircraft launches interrupted.`, true);
      }
    } else if (weapon === "torpedo") {
      if (team === "us" && s.team === "jp") {
        this.stats.shipHits += 1;
        this.score += 250;
        this.event("notice", { text: `TORPEDO HIT — ${s.name.toUpperCase()} +250` });
      }
      s.engine = Math.max(0.1, s.engine - 0.3);
      s.fire = clamp(s.fire + 0.3, 0, 2);
      this.fx("explosion", point, 2.8);
      this.event("explosion", { distance: distance3(this.player, point) });
    } else {
      s.aa = Math.max(0.1, s.aa - 0.005);
      s.deck = Math.max(0, s.deck - 0.0008);
      if (this.random() < 0.03 && s.reserve > 0) s.reserve -= 1;
      this.fx("hit", point, 0.5);
    }
    if (s.hp <= 0) {
      s.sunk = true;
      s.speed = 0;
      this.fx("explosion", s, 5);
      this.say("BATTLE CONTROL", `${s.name} is going down.`, true);
      if (team === "us" && s.team === "jp") {
        this.score += 700;
        this.stats.shipsSunk += 1;
      }
    }
  }

  lose(reason: string): void {
    if (this.status !== "playing") return;
    this.status = "lost";
    this.reason = reason;
    this.event("explosion");
    this.fx("explosion", this.player, 2.5);
  }

  reason = "";

  step(dt: number, input: Any = {}): void {
    if (this.status !== "playing") return;
    if (!Number.isFinite(dt) || dt <= 0) return;
    // Substep large caller deltas rather than letting bullets/landings tunnel through targets.
    if (dt > 0.05) {
      const n = Math.ceil(dt / 0.04);
      for (let i = 0; i < n; i += 1) this.step(dt / n, input);
      return;
    }
    this.time += dt;
    for (const fx of this.effects) fx.age += dt;
    this.effects = this.effects.filter((f) => f.age < f.life);
    this.updateShips(dt);
    this.updatePlayer(dt, input);
    stepWheels(this.player, dt);
    this.updateAircraft(dt);
    this.updateWeapons(dt);
    this.intelTick -= dt;
    if (this.intelTick <= 0) {
      this.updateIntel();
      this.intelTick = 0.35;
    }
    if (this.time > 7 && !this.reconLaunched) {
      this.reconLaunched = true;
      this.launchRecon();
      const scoutBase = this.ships.find((s) => s.name === "Hiryu");
      if (scoutBase) this.launch(scoutBase, "recon");
    }
    if (this.time > 35 && !this.reconNotice) {
      this.reconNotice = true;
      this.say("PATROL CONTROL", "Reports place the enemy northwest of the task force. Use T for course hold; hold Shift above 400 ft to accelerate quiet transit.");
    }
    if (this.time > 130 && !this.threatNotice) {
      this.threatNotice = true;
      const near = this.aircraft.some((a) => a.team === "jp" && a.kind !== "fighter" && distance2(a, this.home) < 7000);
      if (near) this.say("ENTERPRISE RADAR", "Inbound strike aircraft. Fighters, intercept before they reach the carriers.", true);
    }
    if (this.ships.filter((s) => s.kind === "carrier" && s.team === "us").every((s) => s.sunk)) this.lose("The U.S. carrier force has been lost.");
    if (this.operationalEnemyCarriers.length === 0 && !this.strikeComplete) {
      this.strikeComplete = true;
      this.say("ENTERPRISE", "All four enemy flight decks are neutralized. Return and recover to complete the operation.", true);
    }
  }

  strikeComplete = false;

  updateShips(dt: number): void {
    for (const s of this.ships) {
      if (s.sunk) {
        s.sink = Math.min(1, s.sink + dt * 0.012);
        s.y = -s.sink * 34;
        continue;
      }
      updateEvasion(this, s, dt);
      s.speed = s.baseSpeed * (0.35 + 0.65 * s.engine);
      const f = forward(s.heading);
      s.x += f.x * s.speed * dt;
      s.z += f.z * s.speed * dt;
      if (s.fire > 0) {
        s.fire = Math.max(0, s.fire - dt * 0.0018);
        s.hp = Math.max(0, s.hp - s.fire * 0.35 * dt);
        if (s.fire < 0.35) s.deck = Math.min(1, s.deck + dt * 0.001);
        if (s.hp <= 0) this.damageShip(s, 1, s, "torpedo", s.team === "us" ? "jp" : "us");
      }
      if (s.kind === "carrier") {
        s.nextLaunch -= dt;
        if (s.nextLaunch <= 0) {
          const kind = s.launchCount % 4 === 0 ? "fighter" : s.launchCount % 3 === 0 ? "torpedo" : "bomber";
          this.launch(s, kind);
          s.nextLaunch = 23 + this.random() * 12;
        }
      }
      if (s.kind === "sub") {
        s.surfaced = Math.sin(this.time / 70 + s.baseX) > 0.1;
        s.torpTimer -= dt;
        const targets = this.ships.filter((t) => t.team !== s.team && !t.sunk && t.kind === "carrier").sort((a, b) => distance2(s, a) - distance2(s, b));
        const t = targets[0];
        if (t) {
          s.heading = wrap(s.heading + clamp(angleDelta(bearing(s, t), s.heading), -0.06 * dt, 0.06 * dt));
          if (s.torpTimer <= 0 && distance2(s, t) < 4800) {
            for (const off of [-0.025, 0, 0.025]) this.spawnTorpedo(s, bearing(s, t) + off);
            s.torpTimer = 78;
            if (s.team === "jp" && distance2(s, this.player) < 3000) this.say("LOOKOUT", "Torpedo wakes! Submarine attack near the task force!", true);
          }
        }
        continue;
      }
      updateGunnery(this, s, dt);
    }
  }

  updatePlayer(dt: number, input: Any): void {
    const p = this.player;
    if (p.mode === "spectator") return;
    if (p.mode === "flight") {
      stepDamage(p, dt);
      if (p.hp <= 0) {
        this.planeDestroyed(p, p.lastAttacker);
        return;
      }
    }
    p.gunTimer = Math.max(0, p.gunTimer - dt);
    p.heat = Math.max(0, p.heat - dt * 6);
    const h = this.home;
    if (p.mode === "service") {
      if (!h || h.sunk || h.deck < 0.2) {
        this.lose("The carrier was destroyed during recovery.");
        return;
      }
      p.serviceTime -= dt;
      const f = forward(h.heading);
      p.x = h.x + f.x * -105;
      p.z = h.z + f.z * -105;
      p.y = 22;
      p.speed = 0;
      setAttitude(p, h.heading, 0.22, 0);
      if (p.serviceTime <= 0) {
        Object.assign(p, {
          hp: 100,
          fuel: 100,
          ammo: 1400,
          rearAmmo: 240,
          rearTimer: 0,
          bombs: 3,
          mode: "deck",
          deckOffset: -55,
          deckLateral: 0,
          deckSpeed: 0,
          chocks: true,
          throttle: 0.18,
          brakes: false,
          gear: true,
          gearManual: false,
          autoGearPending: false,
          gearClimbTime: 0,
          flaps: 0.33,
          landingAssist: null,
        });
        applyLoadout(p, p.loadout || "bomb");
        this.playerFlight.setAirframe(p.airframe);
        initDamage(p);
        p.killCredited = false;
        this.playerFlight.reset();
        this.stats.sorties += 1;
        this.say("DECK CREW", "Refueled, repaired and rearmed. Takeoff flaps set. Advance power when ready.");
        if (this.strikeComplete) {
          this.status = "won";
          this.reason = "Enemy carrier aviation neutralized. You brought your crew home.";
        }
      }
      return;
    }
    if (p.mode === "arrest") {
      if (!h || h.sunk || h.deck < 0.2) {
        this.lose("The carrier deck failed during arrestment.");
        return;
      }
      p.deckSpeed = Math.max(0, p.deckSpeed - dt * 19);
      p.deckOffset += p.deckSpeed * dt;
      const f = forward(h.heading);
      p.x = h.x + f.x * p.deckOffset + Math.cos(h.heading) * p.deckLateral;
      p.z = h.z + f.z * p.deckOffset + Math.sin(h.heading) * p.deckLateral;
      setAttitude(p, h.heading, lerp(p.pitch, 0.22, dt * 1.5), 0);
      p.y = DECK_HEIGHT + gearClearance(p);
      p.throttle = 0;
      p.rpm = lerp(p.rpm, 0, dt);
      p.vy = 0;
      p.vx = f.x * (p.deckSpeed + h.speed);
      p.vz = f.z * (p.deckSpeed + h.speed);
      p.speed = Math.hypot(p.vx - this.wind.x, p.vz - this.wind.z);
      p.ias = p.speed * Math.sqrt(airDensity(p.y) / 1.225);
      if (p.deckOffset > h.length / 2) {
        this.lose("The arresting run overran the bow. Touch down farther aft and slower.");
        return;
      }
      if (p.deckSpeed < 0.4) this.recover(h);
      return;
    }
    if (input.throttleUp) p.throttle = clamp(p.throttle + dt * 0.38, 0, 1);
    if (input.throttleDown) p.throttle = clamp(p.throttle - dt * 0.38, 0, 1);
    if (p.fuel <= 0 || p.engineCut) p.throttle = 0;
    p.fuel = Math.max(0, p.fuel - dt * (0.009 + p.throttle * 0.018));
    if (p.mode === "deck") {
      if (!h || h.sunk || h.deck < 0.2) {
        this.lose("Your carrier can no longer launch aircraft.");
        return;
      }
      const departure = this.playerFlight.stepDeck(h, dt, input);
      if (departure !== null) {
        // Leave the wheels-on-deck regime. `stepDeck` returns the departure but the game owns
        // `mode`, so without this the aircraft stays pinned to the deck and never climbs.
        p.mode = "flight";
        p.takeoffGrace = 2;
        p.departureTime = p.flightTime;
        p.rollRate = 0;
        p.pitchRate = 0;
        p.yawRate = 0;
        p.launchAssist = p.assist ? 9 : 0;
        p.autoGearPending = !p.gearManual;
        p.gearClimbTime = 0;
        if (departure === "liftoff") this.say("ENTERPRISE TOWER", "Positive climb, Scout Two. Gear retracts after a safe climb; G overrides it. N cycles flap settings. Build speed before turning.");
        else this.say("SCOUT THREE", "Off the deck. Watch your airspeed — do not haul back on the stick.", true);
      }
      return;
    }
    if (p.mode !== "flight") return;
    rearGunner(this, p, dt);
    const controls = { ...input };
    if (p.launchAssist > 0) {
      p.launchAssist -= dt;
      if (!input.pitch && !input.turn && !p.autopilot && p.assist) {
        const climb = 3.5 * clamp(((p.ias || p.speed) - 43) / 9, 0, 1);
        controls.pitch = clamp((climb - p.vy) * 0.032, -0.12, 0.08);
        controls.autopilot = true;
      }
    }
    if (p.autopilot && (Math.abs(input.turn || 0) > 0.25 || Math.abs(input.pitch || 0) > 0.25 || Math.abs(input.rudder || 0) > 0.25)) {
      p.autopilot = false;
      p.landingAssist = null;
      this.event("notice", { text: "COURSE HOLD DISENGAGED — YOU HAVE CONTROL" });
    }
    if (p.autopilot) {
      let nav = this.navigationPoint;
      let desiredAlt = p.nav === "home" ? 350 : 1800;
      if (p.landingAssist) {
        const s = this.ships.find((s: Any) => s.id === p.landingAssist);
        if (!s || s.sunk || s.deck < 0.25) {
          p.landingAssist = null;
          p.autopilot = false;
          this.say("LSO", "Wave off! Deck unavailable.", true);
        } else {
          const loc = localPoint(p, s);
          const f = forward(s.heading);
          nav = { x: s.x + f.x * 75, z: s.z + f.z * 75 };
          desiredAlt = DECK_HEIGHT + 2 + Math.max(0, -loc.forward - 65) * 0.07;
          p.gear = true;
          p.flaps = 1;
          p.brakes = false;
          p.throttle = clamp(0.59 + (50 - (p.ias || p.speed)) * 0.027, 0.12, 0.98);
          if (loc.forward > 100 && p.y > 26) {
            p.landingAssist = null;
            p.autopilot = false;
            p.throttle = 1;
            this.say("LSO", "Bolter! Full power; climb out and circle for another approach.", true);
          }
        }
      }
      if (p.autopilot) {
        const desiredBank = clamp(angleDelta(bearing(p, nav), p.heading) * 0.9, -0.62, 0.62);
        const currentBank = -p.roll;
        controls.turn = clamp((desiredBank - currentBank) * 2.5 - p.rollRate * 0.7, -1, 1);
        let desiredVY = clamp((desiredAlt - p.y) * 0.09, p.landingAssist ? -4 : -12, p.landingAssist ? 3 : 8);
        if ((p.ias || p.speed) < 47) desiredVY = Math.min(desiredVY, 0);
        const baseLoad = clamp(1 / Math.max(0.45, Math.cos(currentBank)), 1, 2.2);
        controls.pitch = clamp((baseLoad - 1) / 4.5 + (desiredVY - p.vy) * 0.02, -0.45, 0.6);
        controls.rudder = 0;
        controls.autopilot = true;
      }
    }
    if (!controls.autopilot) {
      // Keep low-speed stick authority; limit pulling past stall without commanding a push.
      const authority = clamp((p.ias ?? p.speed) / 95, 0.75, 1);
      controls.turn = (controls.turn ?? 0) * 0.6;
      controls.pitch = (controls.pitch ?? 0) * 0.6 * authority;
      if ((p.stall ?? 0) > 0.3) controls.pitch = Math.min(controls.pitch, 0);
    }
    const previousY = p.y;
    this.playerFlight.step(dt, controls);
    if (p.autoGearPending && !p.landingAssist) {
      const safeClimb = p.y > DECK_HEIGHT + gearClearance(p) + 5 && p.vy > 0.5 && p.stall < 0.1;
      p.gearClimbTime = safeClimb ? p.gearClimbTime + dt : 0;
      if (p.gearClimbTime >= 1) {
        p.gear = false;
        p.autoGearPending = false;
        this.event("notice", { text: "POSITIVE CLIMB — GEAR RETRACTING · G FOR MANUAL CONTROL" });
      }
    }
    if (p.takeoffGrace > 0) p.takeoffGrace -= dt;
    if (input.fire) {
      const f = attitudeAxes(p).f;
      const aim = this.aircraft
        .filter((a: Any) => a.team === "jp" && a.hp > 0 && distance3(p, a) < 1400)
        .find((a: Any) => {
          const d = distance3(p, a);
          return ((a.x - p.x) * f.x + (a.y - p.y) * f.y + (a.z - p.z) * f.z) / (d || 1) > 0.996;
        });
      this.fire(p, aim);
    }
    // Structural stresses accumulate, rather than clamping airspeed or load factor.
    if (p.speed > 177 || Math.abs(p.gforce) > 7.5) {
      p.hp = Math.max(0, p.hp - dt * (Math.max(0, p.speed - 177) * 0.2 + Math.max(0, Math.abs(p.gforce) - 7.5) * 2));
      if (p.hp <= 0) {
        this.lose("Structural failure. Reduce airspeed and use gentler control inputs.");
        return;
      }
    }
    if (p.y < 30 && p.takeoffGrace <= 0) {
      for (const s of this.ships) {
        if (s.kind !== "carrier" || s.sunk || !onDeck(p, s, 0)) continue;
        const contactY = DECK_HEIGHT + gearClearance(p);
        const aligned = Math.abs(angleDelta(p.heading, s.heading)) < 0.23;
        const f = forward(s.heading);
        const relativeSpeed = Math.hypot(p.vx - f.x * s.speed, p.vz - f.z * s.speed);
        const sideSpeed = Math.abs(p.vx * Math.cos(s.heading) + p.vz * Math.sin(s.heading));
        if (p.y <= contactY + 0.12 && previousY >= contactY - 0.6) {
          if (s.team === "us" && s.deck > 0.25 && p.gearPos > 0.95 && relativeSpeed < 60 && aligned && Math.abs(p.roll) < 0.18 && p.vy > -5 && p.vy <= 1.1 && sideSpeed < 7) {
            this.touchdown(s);
            return;
          }
          this.lose("Hard deck impact. Lower gear, align from astern, keep wings level and reduce descent below 1,000 ft/min.");
          return;
        }
        if (p.y < 20) {
          this.lose("Impact with the carrier. Fly the approach from astern.");
          return;
        }
      }
    }
    if (p.y < 1.1) {
      this.lose("Your aircraft ditched in the Pacific. Unload the wing and regain airspeed before pulling up.");
      return;
    }
    if (Math.abs(p.x) > 28000 || Math.abs(p.z) > 28000) {
      p.autopilot = true;
      p.nav = "home";
      if (!this.boundaryNotice) {
        this.boundaryNotice = true;
        this.say("NAVIGATOR", "Leaving the operation area. Setting a return course.");
      }
    }
  }

  touchdown(s: Any): void {
    const p = this.player;
    const local = localPoint(p, s);
    const f = forward(s.heading);
    Object.assign(p, {
      home: s.id,
      mode: "arrest",
      deckOffset: local.forward,
      deckLateral: local.right,
      deckSpeed: Math.max(0, p.vx * f.x + p.vz * f.z - s.speed),
      autopilot: false,
      landingAssist: null,
      throttle: 0,
    });
    this.event("land");
    this.say("LANDING SIGNAL OFFICER", "Wire caught. Power idle. Hold straight through arrestment.", true);
  }

  recover(s: Any): void {
    Object.assign(this.player, {
      home: s.id,
      mode: "service",
      serviceTime: 12,
      speed: 0,
      pitch: 0.22,
      roll: 0,
      autopilot: false,
      landingAssist: null,
    });
    this.score += 200;
    this.say("DECK CREW", "Welcome aboard. Fuel, ammunition and repairs are under way.", true);
  }

  assistRecovery(): boolean {
    const p = this.player;
    const s = this.ships
      .filter((s: Any) => s.team === "us" && s.kind === "carrier" && !s.sunk && s.deck > 0.25)
      .sort((a: Any, b: Any) => distance2(a, p) - distance2(b, p))[0];
    const local = s ? localPoint(p, s) : null;
    if (s && local && p.mode === "flight" && p.gear && distance2(p, s) < 700 && p.y < 180 && p.y > 24 && p.speed < 72 && local.forward < 0 && Math.abs(local.right) < 100 && Math.abs(angleDelta(p.heading, s.heading)) < 0.4) {
      p.home = s.id;
      p.landingAssist = s.id;
      p.autopilot = true;
      p.nav = "home";
      p.flaps = 1;
      this.say("LSO", "Final approach assist engaged. Stay ready to take over. Any stick input cancels.");
      return true;
    }
    this.event("notice", { text: "FINAL ASSIST: GEAR DOWN · ASTERN WITHIN 700 M · BELOW 600 FT · UNDER 140 KT · ALIGNED" });
    return false;
  }

  updateAircraft(dt: number): void {
    updateTacticalAircraft(this, dt);
  }

  dropTorpedo(a: Any = this.player): boolean {
    if (!["flight", "attack"].includes(a.mode) || !a.torpedo) return false;
    const envelope = torpedoEnvelope(a);
    const f = forward(a.heading, a.pitch);
    a.torpedo -= 1;
    this.airTorpedoes.push({
      id: this.id("airtorp"),
      x: a.x,
      y: a.y - 1.25,
      z: a.z,
      vx: Number.isFinite(a.vx) ? a.vx : f.x * a.speed,
      vy: (a.vy || 0) - 0.8,
      vz: Number.isFinite(a.vz) ? a.vz : f.z * a.speed,
      heading: a.heading,
      team: a.team,
      owner: a.id,
      age: 0,
      safe: envelope.safe,
    });
    if (a === this.player) {
      this.stats.torpedoesDropped += 1;
      this.event("bomb");
      this.event("notice", { text: envelope.safe ? "TORPEDO AWAY — HOLD COURSE, THEN BREAK CLEAR" : `TORPEDO AWAY / BAD ENTRY: ${envelope.problems.join(" · ")}` });
    }
    return true;
  }

  spawnTorpedo(a: Any, heading: number, options: Any = {}): Any {
    const f = forward(heading);
    const air = options.aerial || false;
    const speed = air ? (a.team === "jp" ? 21 : 17.25) : 24;
    const t = {
      id: this.id("torpedo"),
      x: a.x,
      y: -1.6,
      z: a.z,
      heading,
      vx: f.x * speed,
      vz: f.z * speed,
      speed,
      team: a.team,
      owner: a.owner || a.id,
      age: 0,
      ttl: air ? 240 : 200,
      run: 0,
      armedDistance: options.armedDistance ?? (air ? 180 : 90),
    };
    this.torpedoes.push(t);
    return t;
  }

  updateWeapons(dt: number): void {
    const planes = [...this.aircraft, ...(this.player.mode === "flight" ? [this.player] : [])];
    for (const b of this.bullets) {
      const prev = { x: b.x, y: b.y, z: b.z };
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.z += b.vz * dt;
      b.ttl -= dt;
      if (b.type === "flak") {
        if (b.ttl <= 0) {
          this.fx("flak", b, 1.5);
          this.event("flak", { distance: distance3(this.player, b) });
          for (const a of planes) {
            if (a.hp <= 0) continue;
            const dist = distance3(a, b);
            if (dist < 58) {
              const zone = DAMAGE_ZONES[Math.floor(this.random() * DAMAGE_ZONES.length)];
              this.damagePlane(a, Math.max(0.5, 24 * (1 - dist / 58) ** 2), b.owner, zone, null, true);
            }
          }
        }
        continue;
      }
      let nearest: Any = null;
      for (const a of planes) {
        if (a.id === b.owner || a.hp <= 0) continue;
        const h = aircraftHit(a, prev, b);
        if (h && (!nearest || h.t < nearest.t)) nearest = { ...h, a };
      }
      if (nearest) {
        this.damagePlane(nearest.a, b.damage ?? (b.owner === "player" ? 8 : 5), b.owner, nearest.zone, nearest.point, true);
        b.ttl = 0;
      }
      if (!nearest && Math.min(prev.y, b.y) < 30) {
        for (const s of this.ships) {
          if (s.sunk || s.id === b.owner) continue;
          const top = s.kind === "carrier" ? 20 : 9;
          let at = b;
          if (prev.y > top && b.y <= top) {
            const u = (prev.y - top) / (prev.y - b.y || 1);
            at = { x: lerp(prev.x, b.x, u), y: top, z: lerp(prev.z, b.z, u) };
          }
          if (at.y > 0 && at.y <= top + 0.2 && onDeck(at, s, 1)) {
            this.damageShip(s, 0.7, at, "strafe", b.team);
            b.ttl = 0;
            break;
          }
        }
      }
      if (b.y <= 0) {
        if (this.random() < 0.4) this.fx("splash", b, 0.18);
        b.ttl = 0;
      }
    }
    this.bullets = this.bullets.filter((b) => b.ttl > 0).slice(-850);
    for (const b of this.bombs) {
      const prev = { x: b.x, y: b.y, z: b.z };
      b.age += dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt - 0.5 * 9.81 * dt * dt;
      b.z += b.vz * dt;
      b.vy -= 9.81 * dt;
      let hit: Any = null;
      let point = b;
      for (const s of this.ships) {
        if (s.sunk) continue;
        const top = s.kind === "carrier" ? 20 : s.kind === "sub" ? 0 : 9;
        if (prev.y >= top && b.y <= top) {
          const u = (prev.y - top) / (prev.y - b.y || 1);
          const at = { x: lerp(prev.x, b.x, u), y: top, z: lerp(prev.z, b.z, u) };
          if (onDeck(at, s, 3)) {
            hit = s;
            point = at;
            break;
          }
        }
      }
      if (hit) {
        this.damageShip(hit, b.damage || 155, point, "bomb", b.team);
        b.dead = true;
      } else if (b.y <= 0) {
        this.fx("splash", b, 3.5);
        this.event("splash", { distance: distance3(this.player, b) });
        for (const s of this.ships) {
          const l = localPoint(b, s);
          const d = Math.hypot(Math.max(0, Math.abs(l.right) - s.width / 2), Math.max(0, Math.abs(l.forward) - s.length / 2));
          if (d < 55 && !s.sunk) this.damageShip(s, (b.damage || 155) * 0.4 * (1 - d / 55), b, "bomb", b.team);
        }
        b.dead = true;
      }
      if (b.age > 80) b.dead = true;
    }
    this.bombs = this.bombs.filter((b) => !b.dead);
    for (const t of this.airTorpedoes) {
      const prev = { x: t.x, y: t.y, z: t.z };
      t.age += dt;
      t.x += t.vx * dt;
      t.y += t.vy * dt - 4.905 * dt * dt;
      t.z += t.vz * dt;
      t.vy -= 9.81 * dt;
      for (const s of this.ships) {
        const top = s.kind === "carrier" ? 20 : 9;
        if (s.sunk || prev.y < top || t.y > top) continue;
        const u = (prev.y - top) / (prev.y - t.y || 1);
        const hit = { x: lerp(prev.x, t.x, u), y: top, z: lerp(prev.z, t.z, u) };
        if (onDeck(hit, s)) {
          t.dead = true;
          this.fx("hit", hit, 1.3);
          break;
        }
      }
      if (t.y <= 0 && !t.dead) {
        const u = clamp(prev.y / (prev.y - t.y || 1), 0, 1);
        const entry = { ...t, x: lerp(prev.x, t.x, u), z: lerp(prev.z, t.z, u) };
        this.fx("splash", entry, 0.8);
        if (t.safe) {
          this.spawnTorpedo(entry, Math.atan2(t.vx, -t.vz), { aerial: true });
          if (t.owner === "player") this.event("notice", { text: "TORPEDO RUNNING — STRAIGHT COURSE / ARMING" });
        } else if (t.owner === "player") this.event("notice", { text: "TORPEDO BROKE UP ON ENTRY — CHECK HEIGHT / SPEED / BANK" });
        t.dead = true;
      }
      if (t.age > 35) t.dead = true;
    }
    this.airTorpedoes = this.airTorpedoes.filter((t) => !t.dead);
    for (const t of this.torpedoes) {
      const prev = { ...t };
      t.x += t.vx * dt;
      t.z += t.vz * dt;
      t.age += dt;
      t.ttl -= dt;
      t.run += Math.hypot(t.vx, t.vz) * dt;
      for (const s of this.ships) {
        if (s.sunk) continue;
        const b = localPoint(t, s);
        const a = localPoint(prev, s);
        let lo = 0;
        let hi = 1;
        for (const [key, extent] of [["right", s.width / 2 + 1], ["forward", s.length / 2]] as [string, number][]) {
          const d = (b as Any)[key] - (a as Any)[key];
          if (Math.abs(d) < 1e-9) {
            if (Math.abs((a as Any)[key]) > extent) {
              lo = 2;
              break;
            }
          } else {
            let u = (-extent - (a as Any)[key]) / d;
            let v = (extent - (a as Any)[key]) / d;
            if (u > v) [u, v] = [v, u];
            lo = Math.max(lo, u);
            hi = Math.min(hi, v);
          }
        }
        if (lo <= hi && lo <= 1 && hi >= 0) {
          const impact = { x: lerp(prev.x, t.x, Math.max(0, lo)), y: 2, z: lerp(prev.z, t.z, Math.max(0, lo)) };
          if (t.run >= t.armedDistance) this.damageShip(s, 145, impact, "torpedo", t.team);
          else this.fx("splash", impact, 0.7);
          t.ttl = 0;
          break;
        }
      }
    }
    this.torpedoes = this.torpedoes.filter((t) => t.ttl > 0);
  }

  updateIntel(): void {
    const p = this.player;
    for (const team of ["us", "jp"])
      for (const target of this.ships) {
        if (target.team === team || (target.kind === "sub" && !target.surfaced)) continue;
        const seen =
          this.aircraft.some((a) => a.team === team && a.hp > 0 && distance2(a, target) < (a.kind === "recon" ? 7200 : 6000)) ||
          this.ships.some((s) => s.team === team && !s.sunk && distance2(s, target) < 6000) ||
          (team === "us" && p.mode === "flight" && distance2(p, target) < 5000);
        if (seen)
          this.teamIntel[team].set(target.id, {
            id: target.id,
            name: target.name,
            kind: target.kind,
            x: target.x,
            z: target.z,
            heading: target.heading,
            speed: target.speed,
            width: target.width,
            length: target.length,
            deck: target.deck,
            sunk: target.sunk,
            time: this.time,
            confidence: 1,
          });
      }
    for (const s of this.ships) {
      if (s.team === "us" || s.sunk || (s.kind === "sub" && !s.surfaced)) continue;
      const d = distance2(s, p);
      const angle = Math.abs(angleDelta(bearing(p, s), p.heading));
      const visualRange = clamp(2900 + p.y * 1.8, 2900, 6200);
      if (p.mode === "flight" && d < visualRange && (angle < 1.45 || d < 1300)) this.recordContact(s);
      else if (this.aircraft.some((a) => a.team === "us" && a.kind === "recon" && distance2(a, s) < 4300)) {
        const was = this.contacts.has(s.id);
        this.recordContact(s, "PBY reconnaissance");
        if (!was && s.kind === "carrier") this.say("CATALINA FIVE", `Carrier contact northwest. ${s.name} sighted. Position entered on your intelligence map.`, true);
      }
    }
  }

  canAccelerate(): boolean {
    return (
      this.player.mode === "flight" &&
      this.player.y > 120 &&
      damageSummary(this.player).length === 0 &&
      !this.aircraft.some((a) => a.team === "jp" && distance3(a, this.player) < 2400) &&
      !this.ships.some((s) => s.team === "jp" && !s.sunk && distance2(s, this.player) < 2800)
    );
  }
}
