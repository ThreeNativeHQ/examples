/** Timed-fuse heavy AA, tracked short-range autocannon, and visible-torpedo evasion. */
import { angleDelta, bearing, clamp, distance2, distance3, forward, wrap } from "./math.js";

type Any = any;

export function updateEvasion(b: Any, s: Any, dt: number): void {
  if (s.kind === "sub" || s.sunk) return;
  s.cruiseHeading ??= s.heading;
  const threat = b.torpedoes.find(
    (t: Any) => t.team !== s.team && distance2(t, s) < 1150 && (s.x - t.x) * t.vx + (s.z - t.z) * t.vz > 0,
  );
  if (threat && b.time > (s.evadeNext || 0)) {
    const h = threat.heading;
    const opposite = wrap(h + Math.PI);
    s.evadeHeading = Math.abs(angleDelta(h, s.heading)) < Math.abs(angleDelta(opposite, s.heading)) ? h : opposite;
    s.evadeUntil = b.time + 17;
    s.evadeNext = b.time + 11;
    if (s.team === "us" && distance2(s, b.player) < 3500)
      b.say(s.name.toUpperCase(), "Torpedoes in the water! Emergency turn. Keep the landing pattern clear.", true);
  }
  const dest = (s.evadeUntil || 0) > b.time ? s.evadeHeading : s.cruiseHeading;
  s.heading = wrap(
    s.heading +
      clamp(angleDelta(dest, s.heading), -(s.kind === "carrier" ? 0.02 : 0.045) * dt, (s.kind === "carrier" ? 0.02 : 0.045) * dt),
  );
}

export function updateGunnery(b: Any, s: Any, dt: number): void {
  if (s.sunk || s.kind === "sub" || s.aa < 0.08) return;
  s.aaTimer -= dt;
  s.lightTimer = (s.lightTimer ?? s.aaTimer) - dt;
  s.directorTick = (s.directorTick || 0) - dt;
  if (s.directorTick <= 0) {
    s.directorTick = 0.55;
    const planes = b.aircraft.filter(
      (a: Any) => a.hp > 0 && a.team !== s.team && a.mode !== "launch" && a.y > 5 && distance3({ ...s, y: 15 }, a) < 4400,
    );
    if (b.player.mode === "flight" && b.player.team !== s.team && b.player.hp > 0 && distance3({ ...s, y: 15 }, b.player) < 4400)
      planes.push(b.player);
    planes.sort((a: Any, c: Any) => distance2(s, a) - distance2(s, c));
    const t = planes[0];
    if (t) {
      s.director = { id: t.id, x: t.x, y: t.y, z: t.z, vx: t.vx || 0, vy: t.vy || 0, vz: t.vz || 0, sampled: b.time };
      s.aaBearing = bearing(s, t);
      s.aaElevation = Math.atan2(t.y - 16, distance2(s, t));
    } else s.director = null;
  }
  const d = s.director;
  if (!d) return;
  const age = b.time - d.sampled;
  const target = { x: d.x + d.vx * age, y: d.y + d.vy * age, z: d.z + d.vz * age };
  const range = distance3({ ...s, y: 16 }, target);
  const mounts = s.kind === "carrier" ? [-70, 65] : [-25, 25];
  if (s.aaTimer <= 0 && range < 4350 && target.y > 100) {
    s.aaTimer = (s.kind === "carrier" ? 2.7 : 3.4) / Math.max(0.2, s.aa);
    const ft = range / 680;
    const spread = 65 + range * 0.13;
    for (let i = 0; i < 2; i += 1) {
      const f = forward(s.heading);
      const side = i ? 1 : -1;
      const origin = {
        x: s.x + Math.cos(s.heading) * (s.width * 0.52) * side + f.x * mounts[i],
        y: s.kind === "carrier" ? 17 : 12,
        z: s.z + Math.sin(s.heading) * (s.width * 0.52) * side + f.z * mounts[i],
      };
      const aim = {
        x: target.x + d.vx * ft + (b.random() - 0.5) * spread,
        y: target.y + d.vy * ft + (b.random() - 0.5) * spread,
        z: target.z + d.vz * ft + (b.random() - 0.5) * spread,
      };
      const dx = aim.x - origin.x;
      const dy = aim.y - origin.y;
      const dz = aim.z - origin.z;
      const len = Math.hypot(dx, dy, dz) || 1;
      b.bullets.push({
        id: b.id("flak"),
        ...origin,
        vx: (dx / len) * 680,
        vy: (dy / len) * 680,
        vz: (dz / len) * 680,
        team: s.team,
        owner: s.id,
        ttl: len / 680,
        type: "flak",
      });
      b.fx("muzzle", origin, 0.85);
    }
  }
  if (s.lightTimer <= 0 && range < 1350 && target.y > 5) {
    s.lightTimer = 0.23 / Math.max(0.2, s.aa);
    const tt = range / 800;
    const f = forward(s.heading);
    const side = Math.sin(s.aaBearing - s.heading) > 0 ? 1 : -1;
    const origin = {
      x: s.x + Math.cos(s.heading) * s.width * 0.54 * side + f.x * 30,
      y: s.kind === "carrier" ? 16 : 12,
      z: s.z + Math.sin(s.heading) * s.width * 0.54 * side + f.z * 30,
    };
    const dispersion = 6 + range * 0.048;
    const dx = target.x + d.vx * tt - origin.x + (b.random() - 0.5) * dispersion;
    const dy = target.y + d.vy * tt - origin.y + (b.random() - 0.5) * dispersion;
    const dz = target.z + d.vz * tt - origin.z + (b.random() - 0.5) * dispersion;
    const len = Math.hypot(dx, dy, dz) || 1;
    for (let i = 0; i < 2; i += 1)
      b.bullets.push({
        id: b.id("bullet"),
        ...origin,
        vx: (dx / len) * 800 + (b.random() - 0.5) * 15,
        vy: (dy / len) * 800 + (b.random() - 0.5) * 15,
        vz: (dz / len) * 800 + (b.random() - 0.5) * 15,
        ttl: 1.75,
        team: s.team,
        owner: s.id,
        type: "aa",
        damage: 4,
      });
    b.fx("muzzle", origin, 0.4);
  }
}
