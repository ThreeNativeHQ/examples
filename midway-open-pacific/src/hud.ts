/** The battle's DOM and 2D-canvas heads-up display, ported from the standalone build. */
import type { IReport } from "./sim/battle.js";
import { damageSummary } from "./sim/damage.js";
import { torpedoEnvelope, torpedoIntercept } from "./sim/armament.js";
import { attitudeAxes } from "./sim/flight.js";
import { ASSIGNMENTS, objectiveText, outcomeText, type Assignment } from "./sim/sortie.js";
import { angleDelta, bearing, bombImpact, clamp, contactEstimate, distance2, distance3, forward } from "./sim/math.js";

const $ = (id: string) => document.getElementById(id) as HTMLElement;
/** Optional element: the approach, wing and reserve lines are additive, never required markup. */
const $$ = (id: string) => document.getElementById(id);
const knots = (metresPerSecond: number) => Math.round(metresPerSecond * 1.94384);
const feetPerMinute = (metresPerSecond: number) => Math.round(metresPerSecond * 196.85);
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;
const heading = (h: number) => String(Math.round((h * 180) / Math.PI) % 360).padStart(3, "0");
const escapeHTML = (s: string) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

export function viewCameraLabel(mode: number): string {
  return ["C / COCKPIT", "C / WIDE VIEW", "C / CHASE"][mode];
}

export class Hud {
  b: any;
  view: any;
  canvas: HTMLCanvasElement;
  ctx: CanvasRenderingContext2D;
  lastRadio = "";
  lastContacts = "";
  toastUntil = 0;
  hitFlash = 0;
  mapOpen = false;
  tick = 0;
  mapItems: any[] = [];
  dpr = 1;

  constructor(battle: any, view: any) {
    this.b = battle;
    this.view = view;
    this.canvas = $("hud-canvas") as HTMLCanvasElement;
    this.ctx = this.canvas.getContext("2d") as CanvasRenderingContext2D;
    this.resize();
    window.addEventListener("resize", () => this.resize());
  }

  resize(): void {
    this.dpr = Math.min(devicePixelRatio, 1.5);
    this.canvas.width = innerWidth * this.dpr;
    this.canvas.height = innerHeight * this.dpr;
    this.canvas.style.width = `${innerWidth}px`;
    this.canvas.style.height = `${innerHeight}px`;
    this.ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
  }

  toast(text: string): void {
    $("toast").textContent = text;
    this.toastUntil = performance.now() + 3800;
  }

  update(dt: number, speed = 1): void {
    const b = this.b;
    const p = b.player;
    void speed;
    this.ctx.clearRect(0, 0, innerWidth, innerHeight);
    this.hitFlash = Math.max(0, this.hitFlash - dt * 1.5);
    $("damage").style.opacity = String(this.hitFlash * 0.7 + (p.hp < 30 ? 0.16 : 0));
    if (b.status === "briefing") return;
    this.drawFlight();
    this.tick += dt;
    if (this.tick < 0.1) return;
    this.tick = 0;
    $("battle-clock").textContent = new Date((6 * 3600 + 30 * 60 + b.time) * 1000).toISOString().slice(11, 19);
    $("bomb-count").textContent = p.loadout === "torpedo" ? (p.torpedo ? "◆" : "◇") : "◆ ".repeat(p.bombs) + "◇ ".repeat(3 - p.bombs);
    $("ordnance-label").textContent = p.loadout === "torpedo" ? "TORPEDO" : "BOMBS";
    $("btn-camera").textContent = viewCameraLabel(this.view.cameraMode);
    $("ammo").textContent = String(p.ammo);
    for (const [id, on] of [
      ["gear", p.gear],
      ["brakes", p.brakes],
      ["auto", p.autopilot],
      ["flaps", p.flapPos > 0.1],
      ["assist", p.assist],
    ] as [string, boolean][]) {
      $(`flag-${id}`).classList.toggle("on", on);
      $(`flag-${id}`).classList.toggle("hidden", !on);
    }
    $("damage-status").textContent = damageSummary(p).join(" · ");
    const envelope = torpedoEnvelope(p);
    $("torpedo-guide").classList.toggle("hidden", !(p.loadout === "torpedo" && p.torpedo && p.mode === "flight"));
    $("torpedo-guide").classList.toggle("ready", envelope.safe);
    $("torpedo-guide").textContent = envelope.safe ? "RELEASE ENVELOPE ✓ / 180 M ARMING RUN" : `TORPEDO: ${envelope.problems.join(" · ")}`;
    $("aero-readout").textContent = `G ${(p.gforce ?? 1).toFixed(1)} · AOA ${((p.aoa || 0) * 57.3).toFixed(0)}° · VSI ${Math.round(((p.vy || 0) * 196.85) / 50) * 50} FT/M`;
    $("flag-flaps").textContent = p.flapPos < 0.1 ? "FLAPS UP" : p.flapPos < 0.6 ? "FLAPS T/O" : "FLAPS LAND";
    $("flight-label").textContent = speed > 1 ? "TRANSIT 3×" : `${p.loadout === "torpedo" ? "TBD" : "SBD"} / ${b.command.toUpperCase()}`;
    const nav = b.navigationPoint;
    const dist = distance2(p, nav);
    const designated = b.contacts.get(b.target);
    // The contact line already gives its course and range, so the nav line only speaks when it
    // is steering somewhere else: home, or a search sector with nothing designated.
    $("nav-detail").textContent =
      designated && p.nav !== "home" ? "" : `${p.nav === "home" ? "HOME" : "SEARCH"} ${heading(bearing(p, nav))}° / ${(dist / 1000).toFixed(1)} KM`;
    const contactLine = $$("contact-detail");
    if (contactLine) {
      if (designated) {
        const e = contactEstimate(designated, b.time);
        const ship = b.ships.find((s: any) => s.id === designated.id);
        const state = e.age < 2 ? (ship.sunk ? "SINKING" : `DECK ${ship.deck < 0.35 ? "OUT" : "ACTIVE"}${ship.fire > 0.3 ? " / BURNING" : ""}`) : `${Math.floor(e.age)}s OLD · ${Math.round(e.confidence * 100)}%`;
        contactLine.textContent = `◈ ${designated.name.toUpperCase()} ${heading(bearing(p, e))}° / ${(distance2(p, e) / 1000).toFixed(1)} KM · ${state}`;
      } else contactLine.textContent = "";
    }
    let phase = "02 / SEARCH";
    let title = "Find the enemy carriers";
    let desc = "Search northwest. Report visual contacts with R.";
    if (p.mode === "deck") {
      phase = "01 / LAUNCH";
      title = "Clear the flight deck";
      desc = "Advance W. Stay straight. At 90–100 kt, ease the stick back. G for gear; N cycles flaps.";
    } else if (p.mode === "service") {
      phase = "05 / RECOVERY";
      title = "Back aboard the carrier";
      desc = "Deck crews are refueling, rearming and repairing your aircraft.";
    } else if (b.strikeComplete) {
      phase = "05 / RETURN";
      title = "Bring your crew home";
      desc = "Enemy carrier aviation neutralized. Recover to complete the operation.";
    } else if (p.bombs + p.torpedo === 0 || p.nav === "home") {
      phase = "04 / RETURN";
      title = "Return, rearm, repeat";
      desc = "Set H for home. G for gear. Align with the carrier before recovery.";
    } else if (b.reported) {
      phase = "03 / STRIKE";
      title = "Put their decks out of action";
      desc = p.loadout === "torpedo" ? "Low approach: 16–50 ft, 68–110 kt. Lead the ship. B releases your torpedo." : "Designate a contact. Dive, release, pull out. Order your wing to attack with 2.";
    } else if (b.contacts.size) {
      phase = "02 / CONTACT";
      title = "Ships on the horizon";
      desc = "Confirm the carrier group. Press R to transmit fresh sightings.";
    }
    const sortie = b.sortie;
    if (sortie.assignment !== "operation" && p.mode !== "deck") {
      const done = sortie.objective !== "pending";
      if (p.mode === "service" || b.status === "debrief") {
        phase = "05 / DEBRIEF";
        title = "Back aboard the carrier";
        desc = objectiveText(sortie);
      } else {
        phase = done ? "04 / RECOVER" : sortie.assignment === "recon" ? "02 / SCOUT" : "03 / STRIKE";
        title = done
          ? "Bring your crew home"
          : sortie.assignment === "recon"
            ? "Find and report a carrier"
            : sortie.assignment === "surface"
              ? "Put a weapon on the designated ship"
              : "Put a weapon on the designated carrier";
        const action = done
          ? "H sets the return course. L flies the final."
          : sortie.assignment === "recon"
            ? "R transmits fresh sightings."
            : "TAB designates · 2 orders the wing · B releases.";
        desc = `${objectiveText(sortie)} ${action}`;
      }
    }
    $("mission-phase").textContent = phase;
    $("mission-title").textContent = title;
    $("mission-desc").textContent = desc;
    let warning = "";
    if (p.mode === "flight") {
      if (p.y < Math.max(100, -p.vy * 4) && p.vy < -12) warning = "PULL UP";
      else if (p.stall > 0.3 || Math.abs(p.aoa || 0) > 0.29) warning = "STALL — LOWER NOSE / ADD POWER";
      else if (p.speed > 166) warning = "OVERSPEED — EASE OFF / BRAKES";
      else if (Math.abs(p.gforce ?? 1) > 6.7) warning = "HIGH G — RELAX STICK";
      else if (p.ias < 39) warning = "LOW AIRSPEED — UNLOAD WING";
      else if (p.hp < 25) warning = "AIRFRAME CRITICAL";
      else if (p.fuel < 15) warning = "LOW FUEL";
    }
    $("warning").textContent = warning;
    const recent = b.radio.filter((r: any) => b.time - r.time < 23).slice(0, 2);
    const key = recent.map((r: any) => r.id).join();
    if (key !== this.lastRadio) {
      this.lastRadio = key;
      $("radio-log").innerHTML = recent.map((r: any) => `<div class="radio-msg ${r.priority ? "priority" : ""}"><b>⌁ ${escapeHTML(r.from)}</b><p>${escapeHTML(r.text)}</p></div>`).join("");
    }
    $("toast").style.opacity = performance.now() < this.toastUntil ? "1" : "0";
    let tip = "";
    if (p.mode === "deck") tip = "<strong>HOLD W TO LAUNCH</strong> · at 90–100 kt ease ↓ back · G gear · N flaps · <strong>?</strong> opens the flight manual";
    else if (p.autopilot) tip = `<strong>COURSE HOLD · ${p.nav === "home" ? "RETURNING HOME" : "EN ROUTE"}</strong> · ${b.canAccelerate() ? "hold SHIFT for 3× transit" : "combat proximity — normal time"}`;
    else if (p.mode === "flight" && b.time < 100) tip = "<strong>← → BANK · ↓ RAISES THE NOSE</strong> · T holds course · <strong>?</strong> opens the flight manual";
    else if (p.brakes && p.pitch < -0.25) tip = "<strong>DIVE BRAKES EXTENDED</strong> · the amber circle predicts impact · B releases a bomb";
    else if (p.nav === "home") tip = "<strong>RECOVERY — APPROACH FROM ASTERN</strong> · gear down · below 600 ft · under 140 kt · L within 700 m";
    $("center-tip").innerHTML = tip;
    const cueLine = $$("approach-cues");
    if (cueLine) {
      if (p.mode === "flight" && p.nav === "home") {
        const a = b.approach();
        const r = b.returnReserve();
        cueLine.textContent = a.carrier
          ? `${a.phase.toUpperCase()} · ${knots(a.speed)} KT AIRSPEED · ${feetPerMinute(a.descent)} FT/MIN · ${a.cues.join(" · ")} · ${r.available ? `RESERVE ${clock(Math.max(0, r.spare))} (EST)` : "RESERVE UNKNOWN"}`
          : "NO AVAILABLE DECK";
      } else cueLine.textContent = "";
    }
    const mapOrders = $$("map-orders");
    if (mapOrders) mapOrders.textContent = ASSIGNMENTS[sortie.assignment as Assignment].brief;
    const orders = $$("command-status");
    if (orders) {
      const designated = b.contacts.get(sortie.target ?? "");
      orders.textContent = `ASSIGNMENT ${ASSIGNMENTS[sortie.assignment as Assignment].name} · TARGET ${designated ? designated.name.toUpperCase() : "NONE DESIGNATED"} · ${b.wingStatus()}`;
    }
    const wingLine = $$("wing-status");
    if (wingLine) wingLine.textContent = p.mode === "flight" ? b.wingStatus() : "";
    $("service").classList.toggle("hidden", p.mode !== "service");
    if (p.mode === "service") {
      $("service-carrier").textContent = `${(b.home?.name || "FRIENDLY CARRIER").toUpperCase()} / DECK OPERATIONS`;
      $("service-bar").style.width = `${(1 - p.serviceTime / 12) * 100}%`;
      $("service-time").textContent = `READY FOR LAUNCH IN ${Math.ceil(p.serviceTime)} SECONDS`;
    }
    this.drawRadar();
    if (this.mapOpen) {
      this.drawMap();
      this.updateContactList();
    }
  }

  drawFlight(): void {
    const c = this.ctx;
    const w = innerWidth;
    const h = innerHeight;
    const p = this.b.player;
    c.save();
    c.font = "10px ui-monospace,monospace";
    c.textAlign = "center";
    c.strokeStyle = "rgba(226,194,134,.8)";
    c.fillStyle = "#e8d6ae";
    c.lineWidth = 1;
    const center = w / 2;
    const top = 40;
    const span = Math.min(460, w * 0.38);
    const deg = (p.heading * 180) / Math.PI;
    c.save();
    c.beginPath();
    c.rect(center - span / 2, 16, span, 62);
    c.clip();
    for (let i = -60; i <= 60; i += 1) {
      const n = Math.round(deg / 5) * 5 + i * 5;
      const delta = ((n - deg + 540) % 360) - 180;
      const x = center + delta * 4.6;
      if (Math.abs(x - center) > span / 2) continue;
      c.globalAlpha = Math.max(0.2, 1 - Math.abs(x - center) / (span * 0.6));
      c.beginPath();
      c.moveTo(x, top + 8);
      c.lineTo(x, top + (n % 10 === 0 ? 17 : 12));
      c.stroke();
      if (n % 10 === 0) c.fillText(n % 90 === 0 ? ["N", "E", "S", "W"][(((n % 360) + 360) % 360) / 90] : String(((n % 360) + 360) % 360).padStart(3, "0"), x, top - 3);
    }
    c.restore();
    c.strokeStyle = "rgba(214,178,118,.6)";
    c.beginPath();
    c.moveTo(center - span / 2, top + 17.5);
    c.lineTo(center + span / 2, top + 17.5);
    c.stroke();
    c.fillStyle = "#e3c38a";
    c.beginPath();
    c.moveTo(center - 4, top + 26);
    c.lineTo(center + 4, top + 26);
    c.lineTo(center, top + 20);
    c.fill();
    this.drawGauges();
    if (p.mode === "flight") {
      const f = p.attitude ? attitudeAxes(p).f : forward(p.heading, p.pitch);
      const aim = this.view.project({ x: p.x + f.x * 1600, y: p.y + f.y * 1600, z: p.z + f.z * 1600 });
      if (aim.visible) {
        c.strokeStyle = "rgba(234,239,218,.8)";
        c.beginPath();
        c.arc(aim.x, aim.y, 16, 0, Math.PI * 2);
        c.stroke();
        for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
          c.beginPath();
          c.moveTo(aim.x + dx * 22, aim.y + dy * 22);
          c.lineTo(aim.x + dx * 30, aim.y + dy * 30);
          c.stroke();
        }
        c.fillStyle = "#edf1d9";
        c.fillRect(aim.x - 1, aim.y - 1, 2, 2);
      }
      const vel = this.view.project({ x: p.x + p.vx * 10, y: p.y + p.vy * 10, z: p.z + p.vz * 10 });
      if (vel.visible) {
        c.strokeStyle = "rgba(142,215,185,.85)";
        c.beginPath();
        c.arc(vel.x, vel.y, 7, 0, Math.PI * 2);
        c.moveTo(vel.x - 15, vel.y);
        c.lineTo(vel.x - 7, vel.y);
        c.moveTo(vel.x + 7, vel.y);
        c.lineTo(vel.x + 15, vel.y);
        c.moveTo(vel.x, vel.y - 7);
        c.lineTo(vel.x, vel.y - 13);
        c.stroke();
      }
      if (p.bombs > 0) {
        const impact = bombImpact({ x: p.x, y: p.y - 1.6, z: p.z }, { x: p.vx, y: p.vy - 2, z: p.vz }, 20);
        const a = this.view.project(impact);
        if (a.visible) {
          c.strokeStyle = "#e0bb78";
          c.fillStyle = "#e0bb78";
          c.setLineDash([4, 4]);
          c.beginPath();
          c.arc(a.x, a.y, 22, 0, Math.PI * 2);
          c.stroke();
          c.setLineDash([]);
          c.beginPath();
          c.moveTo(a.x - 9, a.y);
          c.lineTo(a.x + 9, a.y);
          c.moveTo(a.x, a.y - 9);
          c.lineTo(a.x, a.y + 9);
          c.stroke();
          c.font = "9px ui-monospace,monospace";
          c.fillText(`IMPACT ${impact.time.toFixed(1)}s`, a.x, a.y + 38);
        }
      }
      if (p.torpedo > 0) {
        const target = this.b.contacts.get(this.b.target);
        if (target && this.b.time - target.time < 3) {
          const lead = torpedoIntercept(p, target);
          const pt = this.view.project({ ...lead, y: 4 });
          if (pt.visible) {
            c.strokeStyle = torpedoEnvelope(p).safe ? "#8ed3ae" : "#d8b380";
            c.setLineDash([7, 5]);
            c.beginPath();
            c.moveTo(pt.x - 24, pt.y - 14);
            c.lineTo(pt.x + 24, pt.y - 14);
            c.lineTo(pt.x + 24, pt.y + 14);
            c.lineTo(pt.x - 24, pt.y + 14);
            c.closePath();
            c.stroke();
            c.setLineDash([]);
            c.fillStyle = c.strokeStyle;
            c.font = "9px ui-monospace,monospace";
            c.fillText("TORPEDO LEAD / STRAIGHT RUN", pt.x, pt.y + 30);
          }
        }
      }
      for (const a of this.b.aircraft) {
        if (a.hp <= 0) continue;
        const d = distance3(a, p);
        if (d > 3200) continue;
        const pt = this.view.project(a);
        if (!pt.visible) continue;
        c.strokeStyle = a.team === "us" ? "rgba(144,208,208,.65)" : "rgba(234,170,128,.8)";
        c.beginPath();
        c.moveTo(pt.x - 6, pt.y - 10);
        c.lineTo(pt.x, pt.y - 15);
        c.lineTo(pt.x + 6, pt.y - 10);
        c.stroke();
        if (d < 1300 && a.team === "jp") {
          c.fillStyle = "#ebbc99";
          c.font = "8px ui-monospace,monospace";
          c.fillText(`${a.kind === "fighter" ? "ZERO" : a.kind === "torpedo" ? "KATE" : "VAL"} · ${Math.round(d)} M`, pt.x, pt.y - 22);
        }
      }
      const contact = this.b.contacts.get(this.b.target);
      if (contact && this.b.time - contact.time < 3) {
        const pt = this.view.project({ ...contact, y: 22 });
        if (pt.visible) {
          c.strokeStyle = "#e0b685";
          const s = 24;
          c.beginPath();
          for (const [x, y, sx, sy] of [[pt.x - s, pt.y - s, 1, 1], [pt.x + s, pt.y - s, -1, 1], [pt.x - s, pt.y + s, 1, -1], [pt.x + s, pt.y + s, -1, -1]]) {
            c.moveTo(x + sx * 10, y);
            c.lineTo(x, y);
            c.lineTo(x, y + sy * 10);
          }
          c.stroke();
          c.fillStyle = "#ecd0a6";
          c.font = "9px ui-monospace,monospace";
          c.fillText(contact.name.toUpperCase(), pt.x, pt.y - 34);
        }
      }
      const nav = this.b.navigationPoint;
      const delta = angleDelta(bearing(p, nav), p.heading);
      if (Math.abs(delta) > 0.38) {
        const x = w / 2 + clamp(delta * 100, -w * 0.26, w * 0.26);
        const y = h * 0.22;
        c.fillStyle = "#e3c38a";
        c.beginPath();
        c.moveTo(x, y);
        c.lineTo(x - 5, y + 7);
        c.lineTo(x + 5, y + 7);
        c.fill();
        c.font = "9px ui-monospace,monospace";
        c.fillText(`${p.nav === "home" ? "HOME" : "SECTOR"} ${heading(bearing(p, nav))}°`, x, y - 9);
      }
    }
    c.restore();
  }

  /** The bottom-left instrument bank: two brass dials and the vertical throttle/fuel/airframe gauges. */
  drawGauges(): void {
    const p = this.b.player;
    const h = innerHeight;
    const compact = innerWidth < 1200;
    const r = compact ? 50 : 64;
    const cy = h - (compact ? 104 : 122);
    const left = 28 + r;
    this.dial(left, cy, r, "AIRSPEED", "KT", knots(p.ias ?? p.speed), 240, 6, String(Math.round((p.ias ?? p.speed) * 1.94384)).padStart(3, "0"));
    const feet = p.y * 3.28084;
    this.dial(left + r * 2 + 16, cy, r, "ALTITUDE", "FT ×1K", feet, 20000, 5, Math.round(feet).toLocaleString("en-US"), 1 / 1000);
    const barHeight = compact ? 88 : 108;
    const barTop = cy - barHeight / 2 - 4;
    let x = left + r * 3 + 58;
    for (const [label, value, color] of [
      ["THR", p.throttle * 100, "#e0be82"],
      ["FUEL", p.fuel, "#92c8c5"],
      ...(p.hp > 99.5 ? [] : [["HULL", p.hp, p.hp < 35 ? "#e79a76" : "#c7d3b6"] as [string, number, string]]),
    ] as [string, number, string][]) {
      this.bar(x, barTop, barHeight, label, value, color);
      x += 38;
    }
  }

  /** One dial: a 270° sweep, brass bezel, and the exact value in a window so nothing has to be read off the needle. */
  dial(cx: number, cy: number, r: number, label: string, unit: string, value: number, max: number, majors: number, readout: string, scale = 1): void {
    const c = this.ctx;
    const START = Math.PI * 0.75;
    const SWEEP = Math.PI * 1.5;
    const minors = majors * 4;
    c.save();
    c.translate(cx, cy);
    c.textAlign = "center";
    c.beginPath();
    c.arc(0, 0, r, 0, Math.PI * 2);
    c.fillStyle = "rgba(5,16,22,.86)";
    c.fill();
    c.lineWidth = 2.5;
    c.strokeStyle = "rgba(228,194,133,.95)";
    c.stroke();
    c.beginPath();
    c.arc(0, 0, r - 5, 0, Math.PI * 2);
    c.lineWidth = 1;
    c.strokeStyle = "rgba(228,194,133,.3)";
    c.stroke();
    for (let i = 0; i <= minors; i++) {
      const a = START + (SWEEP * i) / minors;
      const major = i % 4 === 0;
      const cos = Math.cos(a);
      const sin = Math.sin(a);
      c.beginPath();
      c.moveTo(cos * (r - (major ? 15 : 11)), sin * (r - (major ? 15 : 11)));
      c.lineTo(cos * (r - 7), sin * (r - 7));
      c.lineWidth = major ? 1.4 : 1;
      c.strokeStyle = major ? "rgba(234,220,190,.85)" : "rgba(190,208,204,.38)";
      c.stroke();
      if (major && i < minors) {
        c.fillStyle = "rgba(226,212,184,.78)";
        c.font = "9px ui-monospace,monospace";
        c.fillText(String(Math.round(((max * i) / minors) * scale)), cos * (r - 25), sin * (r - 25) + 3);
      }
    }
    c.fillStyle = "rgba(196,214,210,.62)";
    c.font = "7.5px ui-monospace,monospace";
    c.fillText(unit, 0, -r * 0.12);
    const a = START + SWEEP * clamp(value / max, 0, 1);
    c.strokeStyle = "#f3dcab";
    c.lineWidth = 2;
    c.beginPath();
    c.moveTo(-Math.cos(a) * 7, -Math.sin(a) * 7);
    c.lineTo(Math.cos(a) * (r - 17), Math.sin(a) * (r - 17));
    c.stroke();
    c.fillStyle = "#f3dcab";
    c.beginPath();
    c.arc(0, 0, 2.6, 0, Math.PI * 2);
    c.fill();
    const wy = r * 0.34;
    c.fillStyle = "rgba(3,12,18,.92)";
    c.strokeStyle = "rgba(216,180,120,.75)";
    c.lineWidth = 1;
    c.beginPath();
    c.rect(-29, wy, 58, 18);
    c.fill();
    c.stroke();
    c.fillStyle = "#f4e8ca";
    c.font = "12px ui-monospace,monospace";
    c.fillText(readout, 0, wy + 13.5);
    c.fillStyle = "rgba(232,216,184,.9)";
    c.font = "9px ui-monospace,monospace";
    (c as unknown as { letterSpacing: string }).letterSpacing = "2.5px";
    c.fillText(label, 0, -r - 10);
    (c as unknown as { letterSpacing: string }).letterSpacing = "0px";
    c.restore();
  }

  /** One vertical gauge, drawn to match the dials' bezel. */
  bar(x: number, y: number, height: number, label: string, value: number, color: string): void {
    const c = this.ctx;
    c.save();
    c.textAlign = "center";
    c.fillStyle = "rgba(5,16,22,.82)";
    c.fillRect(x, y, 15, height);
    c.lineWidth = 1.4;
    c.strokeStyle = "rgba(228,194,133,.9)";
    c.strokeRect(x + 0.7, y + 0.7, 13.6, height - 1.4);
    const filled = (clamp(value, 0, 100) / 100) * (height - 5);
    c.fillStyle = color;
    c.fillRect(x + 3, y + height - 3 - filled, 9, filled);
    c.fillStyle = "rgba(232,216,184,.9)";
    c.font = "9px ui-monospace,monospace";
    c.fillText(label, x + 7.5, y - 8);
    c.fillStyle = "#eadfc4";
    c.font = "10px ui-monospace,monospace";
    c.fillText(`${Math.round(value)}%`, x + 7.5, y + height + 14);
    c.restore();
  }

  drawRadar(): void {
    const canvas = $("radar") as HTMLCanvasElement;
    const c = canvas.getContext("2d") as CanvasRenderingContext2D;
    const w = canvas.width;
    const R = w / 2;
    const p = this.b.player;
    const scale = (R - 20) / 6000;
    c.clearRect(0, 0, w, w);
    c.save();
    c.beginPath();
    c.arc(R, R, R - 1, 0, Math.PI * 2);
    c.clip();
    c.lineWidth = 1;
    c.strokeStyle = "rgba(165,197,195,.17)";
    for (const r of [R / 3, (R * 2) / 3, R - 14]) {
      c.beginPath();
      c.arc(R, R, r, 0, Math.PI * 2);
      c.stroke();
    }
    c.beginPath();
    c.moveTo(R, 10);
    c.lineTo(R, w - 10);
    c.moveTo(10, R);
    c.lineTo(w - 10, R);
    c.stroke();
    c.fillStyle = "#a5c5bf";
    c.font = "15px ui-monospace,monospace";
    c.textAlign = "center";
    c.fillText("N", R, 24);
    const pt = (a: any) => ({ x: R + (a.x - p.x) * scale, y: R + (a.z - p.z) * scale });
    const angle = p.heading - Math.PI / 2;
    c.fillStyle = "rgba(128,191,188,.06)";
    c.beginPath();
    c.moveTo(R, R);
    c.arc(R, R, R - 14, angle - 0.55, angle + 0.55);
    c.closePath();
    c.fill();
    for (const s of this.b.ships) if (s.team === "us" && !s.sunk) {
      const a = pt(s);
      this.shipIcon(c, a.x, a.y, s.heading, s.kind, 8, "#8ccac7");
    }
    for (const contact of this.b.contacts.values()) {
      const e = contactEstimate(contact, this.b.time);
      const a = pt(e);
      c.strokeStyle = "rgba(225,181,133,.25)";
      c.beginPath();
      c.arc(a.x, a.y, e.uncertainty * scale, 0, Math.PI * 2);
      c.stroke();
      this.shipIcon(c, a.x, a.y, contact.heading, contact.kind, 9, contact.id === this.b.target ? "#f0d3a0" : "#d4a17e");
    }
    for (const a of this.b.aircraft) if (a.hp > 0 && (a.team === "us" || distance3(a, p) < 2800)) {
      const q = pt(a);
      c.fillStyle = a.team === "us" ? "#8ebbbb" : "#df9872";
      c.fillRect(q.x - 2, q.y - 2, 4, 4);
    }
    this.shipIcon(c, R, R, p.heading, "plane", 12, "#f0e2c1");
    c.restore();
  }

  shipIcon(c: CanvasRenderingContext2D, x: number, y: number, h: number, kind: string, size: number, color: string): void {
    c.save();
    c.translate(x, y);
    c.rotate(h);
    c.strokeStyle = color;
    c.fillStyle = color;
    c.lineWidth = 1.5;
    c.beginPath();
    if (kind === "plane") {
      c.moveTo(0, -size);
      c.lineTo(size * 0.65, size * 0.55);
      c.lineTo(0, size * 0.2);
      c.lineTo(-size * 0.65, size * 0.55);
    } else {
      c.moveTo(0, -size);
      c.lineTo(size * 0.45, -size * 0.4);
      c.lineTo(size * 0.45, size);
      c.lineTo(-size * 0.45, size);
      c.lineTo(-size * 0.45, -size * 0.4);
    }
    c.closePath();
    c.stroke();
    if (kind === "plane") c.fill();
    c.restore();
  }

  drawMap(): void {
    const canvas = $("big-map") as HTMLCanvasElement;
    const c = canvas.getContext("2d") as CanvasRenderingContext2D;
    const w = canvas.width;
    const h = canvas.height;
    const b = this.b;
    c.fillStyle = "#142f3a";
    c.fillRect(0, 0, w, h);
    const scale = Math.min(w / 32000, h / 27000);
    const cx = w / 2 + 1800 * scale;
    const cy = h * 0.5 + 1600 * scale;
    const pt = (a: any) => ({ x: cx + a.x * scale, y: cy + a.z * scale });
    this.mapItems = [];
    c.strokeStyle = "rgba(149,182,178,.12)";
    c.lineWidth = 1;
    c.font = "12px ui-monospace,monospace";
    c.fillStyle = "rgba(190,212,201,.5)";
    for (let x = -20000; x <= 20000; x += 2500) {
      const p = pt({ x, z: 0 });
      c.beginPath();
      c.moveTo(p.x, 0);
      c.lineTo(p.x, h);
      c.stroke();
    }
    for (let z = -20000; z <= 20000; z += 2500) {
      const p = pt({ x: 0, z });
      c.beginPath();
      c.moveTo(0, p.y);
      c.lineTo(w, p.y);
      c.stroke();
    }
    c.font = "bold 14px ui-monospace,monospace";
    c.fillStyle = "#8da9a5";
    c.fillText("N ↑", w - 65, 34);
    c.font = "13px ui-monospace,monospace";
    c.fillStyle = "rgba(172,202,198,.28)";
    c.fillText("N O R T H   P A C I F I C   O C E A N", 35, h - 32);
    const sr = pt(b.search);
    c.setLineDash([8, 8]);
    c.strokeStyle = "rgba(226,192,135,.28)";
    c.beginPath();
    c.arc(sr.x, sr.y, 3100 * scale, 0, Math.PI * 2);
    c.stroke();
    c.setLineDash([]);
    c.fillStyle = "rgba(226,192,135,.65)";
    c.font = "12px ui-monospace,monospace";
    c.fillText("SEARCH SECTOR", sr.x - 55, sr.y - 3100 * scale - 12);
    const island = pt(b.island);
    c.fillStyle = "#587c73";
    c.beginPath();
    c.ellipse(island.x, island.y, 38, 15, -0.15, 0, Math.PI * 2);
    c.fill();
    c.fillStyle = "#b7c7bb";
    c.fillText("MIDWAY ATOLL", island.x - 48, island.y + 34);
    for (const s of b.ships) if (s.team === "us") {
      const a = pt(s);
      this.shipIcon(c, a.x, a.y, s.heading, s.kind, s.kind === "carrier" ? 11 : 7, s.sunk ? "#546963" : "#8bc9c4");
      if (s.kind === "carrier") {
        c.font = "12px ui-monospace,monospace";
        c.fillStyle = "#afceca";
        c.fillText(s.name.replace("USS ", ""), a.x + 14, a.y + 5);
      }
    }
    for (const a of b.aircraft) if (a.hp > 0 && (a.team === "us" || distance3(a, b.player) < 2800)) {
      const p = pt(a);
      this.shipIcon(c, p.x, p.y, a.heading, "plane", 4, a.team === "us" ? "#73aba9" : "#c99a77");
    }
    for (const contact of b.contacts.values()) {
      const e = contactEstimate(contact, b.time);
      const a = pt(e);
      this.mapItems.push({ id: contact.id, x: a.x, y: a.y });
      c.fillStyle = "rgba(206,160,113,.055)";
      c.strokeStyle = "rgba(226,186,140,.3)";
      c.beginPath();
      c.arc(a.x, a.y, Math.max(11, e.uncertainty * scale), 0, Math.PI * 2);
      c.fill();
      c.stroke();
      this.shipIcon(c, a.x, a.y, e.heading, e.kind, e.id === b.target ? 12 : 9, e.id === b.target ? "#f0d19c" : "#c7a181");
      c.font = "12px ui-monospace,monospace";
      c.fillStyle = "#e0c4a2";
      c.fillText(contact.name, a.x + 15, a.y - 7);
      c.fillStyle = "#a6a99a";
      c.font = "10px ui-monospace,monospace";
      c.fillText(`${Math.round(e.confidence * 100)}% / ${Math.floor(e.age)}s`, a.x + 15, a.y + 9);
    }
    const p = pt(b.player);
    const nav = pt(b.navigationPoint);
    c.setLineDash([5, 6]);
    c.strokeStyle = "#c6b480";
    c.beginPath();
    c.moveTo(p.x, p.y);
    c.lineTo(nav.x, nav.y);
    c.stroke();
    c.setLineDash([]);
    this.shipIcon(c, p.x, p.y, b.player.heading, "plane", 13, "#f0dfb8");
    c.fillStyle = "#f0dfb8";
    c.font = "12px ui-monospace,monospace";
    c.fillText("SCOUT TWO", p.x + 18, p.y + 7);
  }

  updateContactList(): void {
    const contacts: IReport[] = this.b.targetContacts();
    const key = contacts.map((c) => c.id + Math.floor((this.b.time - c.time) / 5)).join() + this.b.target;
    if (key === this.lastContacts) return;
    this.lastContacts = key;
    $("contact-list").innerHTML = contacts.length
      ? contacts
          .map((c) => {
            const e = contactEstimate(c, this.b.time);
            return `<button class="contact-item ${c.id === this.b.target ? "selected" : ""}" data-contact="${c.id}">${escapeHTML(c.name)}<small>${Math.round(e.confidence * 100)}% CONFIDENCE · ${Math.floor(e.age)}s AGO</small></button>`;
          })
          .join("")
      : "<p class=\"map-note\">No eligible contacts.<br>Search for targets, or wait for reconnaissance reports.</p>";
  }

  debrief(): void {
    const b = this.b;
    const result = b.sortie.result;
    $("debrief").classList.remove("hidden");
    const relabel = (id: string, text: string) => {
      const label = $(id)?.nextElementSibling;
      if (label) label.textContent = text;
    };
    if (result) {
      $("debrief-phase").textContent = `${ASSIGNMENTS[result.assignment as Assignment].name} / AFTER ACTION REPORT`;
      $("debrief-title").textContent = outcomeText(result);
      const arrival =
        result.outcome === "lost"
          ? "The crew did not come back."
          : `Aboard ${result.carrier} with ${Math.round(result.fuel)}% fuel and ${Math.round(result.hp)}% airframe${result.damage.length ? ` · ${result.damage.join(" · ")}` : ""}.`;
      $("debrief-reason").textContent = `${clock(result.elapsed)} elapsed. ${arrival}`;
      $("stat-score").textContent = clock(result.elapsed);
      relabel("stat-score", "ELAPSED");
      $("stat-kills").textContent = String(result.personalHits);
      relabel("stat-kills", "YOUR HITS");
      $("stat-hits").textContent = String(result.wingHits);
      relabel("stat-hits", "WING HITS");
      $("stat-sorties").textContent = String(result.reportedCarriers);
      relabel("stat-sorties", "CARRIERS REPORTED");
      return;
    }
    $("debrief-phase").textContent = b.status === "won" ? "OPERATION COMPLETE" : "AFTER ACTION REPORT";
    $("debrief-title").textContent = b.status === "won" ? "You brought them home." : "The Pacific takes its toll.";
    $("debrief-reason").textContent = b.reason;
    $("stat-score").textContent = String(b.score);
    relabel("stat-score", "SCORE");
    $("stat-kills").textContent = String(b.stats.kills);
    relabel("stat-kills", "AIRCRAFT");
    $("stat-hits").textContent = String(b.stats.shipHits);
    relabel("stat-hits", "SHIP HITS");
    $("stat-sorties").textContent = String(b.stats.sorties);
    relabel("stat-sorties", "SORTIES");
  }
}
