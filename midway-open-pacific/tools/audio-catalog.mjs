/**
 * The exact Midway audio catalog, transcribed from
 * `docs/PRDs/PRD-midway-realistic-audio-sfx.md`.
 *
 * This module is authoring source only. `tools/audio-generate.mjs` expands it into the single
 * machine-consumed manifest at `content/audio/midway-audio.json`, which is the shipped record of
 * every request, hash and generation. No second prose ledger.
 *
 * Prompt text is copied verbatim. Changing a sentence here changes what is generated, so the PRD
 * stays the authority and this file is its transcription.
 */

export const SFX_MODEL = "eleven_text_to_sound_v2";
export const TTS_MODEL = "eleven_multilingual_v2";
export const VOICE_DESIGN_MODEL = "eleven_multilingual_ttv_v2";
export const PROMPT_INFLUENCE = 0.6;
export const OUTPUT_FORMAT = "mp3_44100_128";

/** Appended to every one-shot row, exactly as the PRD specifies. */
export const ONE_SHOT_SUFFIX =
  "Isolated sound effect only. No music, no speech, no cinematic sweetening, no artificial stereo movement. One event with a clean attack and natural decay.";

/** Appended to every looping row, exactly as the PRD specifies. */
export const LOOP_SUFFIX =
  "Isolated sound effect only. No music, no speech, no cinematic sweetening, no artificial stereo movement. Seamless steady loop, no fade-in or fade-out.";

/**
 * Engine-bank rows cannot carry `LOOP_SUFFIX`: the engine identity plus state plus perspective is
 * already up to 395 characters and the ElevenLabs sound-generation endpoint rejects text over 450
 * (verified: HTTP 400 `text_too_long`). This compact suffix keeps the loop and no-flyby instruction
 * and fits the worst engine row with room to spare. The named prompts, all of which fit under 450
 * with the full suffix, keep the exact PRD wording.
 */
export const ENGINE_LOOP_SUFFIX = "Seamless loop, no fade, no flyby. Engine only.";

/**
 * Engine bank template; `{engine}`, `{state}`, `{perspective}` are the table substitutions.
 *
 * The PRD's template carries a further sentence ("Audible cylinder pulses, propeller loading and
 * mechanical texture, steady operating condition without acceleration... Engine sound only, no wind
 * or gunfire."). With it, the worst engine row is 636 characters and the API rejects it at 450, so
 * the trailing sentence is dropped and its instruction folded into `ENGINE_LOOP_SUFFIX`; identity,
 * state and perspective stay verbatim from the PRD tables.
 */
export const ENGINE_TEMPLATE = "{engine}. {state}. {perspective}.";

export const ENGINES = {
  sbd: "One Wright R-1820-52 nine-cylinder radial piston engine driving the propeller of a Douglas SBD-3 Dauntless",
  tbd: "One Pratt and Whitney R-1830-64 twin-row radial piston engine driving the propeller of a Douglas TBD-1 Devastator",
  wildcat: "One Pratt and Whitney R-1830 twin-row radial piston engine driving the propeller of a Grumman F4F Wildcat",
  catalina:
    "One isolated Pratt and Whitney R-1830 radial piston engine from a Consolidated PBY-5 Catalina; only one engine in this recording",
  zero: "One Nakajima Sakae 12 twin-row radial piston engine driving the propeller of a Mitsubishi A6M2 Zero",
  val: "One Mitsubishi Kinsei radial piston engine driving the propeller of an Aichi D3A1 dive bomber",
  kate: "One Nakajima Sakae 11 twin-row radial piston engine driving the propeller of a Nakajima B5N2 torpedo bomber",
};

export const STATES = {
  idle: "Low steady idle with distinct uneven but healthy exhaust pulses and subdued propeller wash",
  cruise: "Steady cruising power with a settled mechanical drone and moderate propeller load",
  power: "Sustained high takeoff power with dense exhaust pulses and heavy propeller load, mechanically healthy",
};

export const PERSPECTIVES = {
  exterior:
    "Dry stationary close exterior recording, listener near the aircraft but outside the propeller arc, no room echo and no movement past the microphone",
  interior:
    "Pilot-seat perspective inside the partially enclosed cockpit, low and mid frequency airframe vibration with softened exhaust detail through the cowling and canopy, no exaggerated bass",
};

/** Both flyable Douglas airframes get interior states as well as exterior (PRD: playable => interior). */
export const INTERIOR_AIRCRAFT = ["sbd", "tbd"];

/**
 * One row per named SFX prompt. `identity` carries the PRD's evidence label:
 * `documented` (a cited source supports the equipment), `reconstruction` (authored acoustic
 * interpretation) or `unverified` (not established as exact). Engine-output is always reconstruction.
 */
export const SFX = [
  // Airframe and cockpit
  { id: "airflow-exterior", seconds: 10, loop: true, identity: "reconstruction", prompt: "Steady broadband airflow past the outside of a 1942 propeller aircraft canopy, constant flying speed, smooth continuous air rush with a little low turbulence, no engine." },
  { id: "airflow-cockpit", seconds: 10, loop: true, identity: "reconstruction", prompt: "Steady air leaking and rushing around the frame of a partially enclosed 1942 dive bomber cockpit, restrained high hiss and soft low turbulence, pilot-seat perspective, no engine." },
  { id: "sbd-dive-brake", seconds: 8, loop: true, identity: "reconstruction", prompt: "Turbulent air streaming through the extended perforated dive brakes of a Douglas SBD Dauntless, coarse fluttering air roar at constant dive speed, no siren and no engine." },
  { id: "airframe-buffet", seconds: 6, loop: true, identity: "reconstruction", prompt: "Irregular low aerodynamic buffeting transmitted through a light metal propeller aircraft airframe, short soft panel rattles and turbulent vibration, no electronic warning and no engine." },
  { id: "cockpit-rattle", seconds: 8, loop: true, identity: "reconstruction", prompt: "Subtle irregular rattling of small instrument-panel fittings and canopy frame in a vibrating 1942 metal aircraft cockpit, close and dry, no engine and no wind." },
  { id: "gear-travel", seconds: 3, loop: false, identity: "reconstruction", prompt: "One short hydraulic landing gear mechanism operating on a 1940s naval propeller aircraft, restrained mechanical whir and metal linkage movement ending in a firm locking clunk." },
  { id: "flap-travel", seconds: 2, loop: false, identity: "reconstruction", prompt: "One short movement of a 1940s aircraft flap linkage, muted hydraulic mechanism and light metal joints settling into position." },
  { id: "canopy-latch", seconds: 1, loop: false, identity: "unverified", conditional: true, prompt: "One close mechanical latch fastening on a lightweight framed aircraft canopy, metal click followed by a small firm clunk." },
  { id: "bomb-shackle", seconds: 1, loop: false, identity: "reconstruction", prompt: "One heavy bomb shackle releasing beneath a 1942 dive bomber, short mechanical snap and solid metal release clunk transmitted through the aircraft, no whistle and no explosion." },
  { id: "torpedo-release", seconds: 1, loop: false, identity: "reconstruction", prompt: "One heavy aerial torpedo released from an aircraft mounting rack, a short latch snap and weighty metal linkage clunk, no propulsion sound and no explosion." },
  { id: "sbd-engine-start", seconds: 8, loop: false, identity: "reconstruction", prompt: "A plausible 1942 nine-cylinder aircraft radial engine starting, mechanical starter activity followed by several uneven combustion catches that settle into a low idle, no dramatic backfire." },
  { id: "sbd-engine-stop", seconds: 5, loop: false, identity: "reconstruction", prompt: "A nine-cylinder aircraft radial engine shutting down from idle, combustion pulses cease and rotating machinery slows naturally to rest, no explosion." },
  { id: "tbd-engine-start", seconds: 8, loop: false, identity: "reconstruction", prompt: "One Pratt and Whitney R-1830 radial piston engine on a Douglas TBD-1 Devastator starting, mechanical starter cranking followed by several uneven combustion catches that settle into a low puttering idle, no turbine whine and no dramatic backfire." },
  { id: "tbd-engine-stop", seconds: 6, loop: false, identity: "reconstruction", prompt: "One Pratt and Whitney R-1830 radial piston engine on a Douglas TBD-1 Devastator shutting down from idle, uneven low exhaust putter and propeller chops spacing out as it slows naturally to rest, no turbine whine, no electronic sweep and no explosion." },
  { id: "engine-rough", seconds: 8, loop: true, identity: "reconstruction", prompt: "Irregular missed combustion pulses and rough mechanical vibration from a damaged aircraft radial piston engine, sustained uneven running, no explosions and no music." },
  { id: "engine-seize", seconds: 5, loop: false, identity: "reconstruction", prompt: "An aircraft radial piston engine destroyed in flight, combustion breaking into violent uneven misfires and metallic knocking, a harsh mechanical seizure and then only the propeller turning in the airflow, no explosion and no music." },
  { id: "prop-windmill", seconds: 8, loop: true, identity: "reconstruction", prompt: "An unpowered aircraft propeller turning in steady airflow, soft repetitive mechanical rotation and air swish without any combustion or exhaust." },
  { id: "airframe-hit", seconds: 1, loop: false, identity: "reconstruction", prompt: "A short burst of small hard impacts puncturing thin aluminum aircraft skin near the listener, sharp metal ticks and a brief loose-panel rattle, no large explosion." },

  // Weapons
  { id: "gun-50", seconds: 2, loop: false, identity: "documented", prompt: "One short burst from a single aircraft-mounted Browning fifty-caliber machine gun, rapid hard mechanical reports with a dry percussive attack, outdoors, no shell impacts." },
  // gun-30 is a reconstruction: ElevenLabs `eleven_text_to_sound_v2` (1 s request), post-processed
  // to a mono 0.180 s one-shot (40 Hz high-pass, 1 ms guard fade-in, 50 ms fade-out to true zero,
  // -6.0 dB before Vorbis q6). The prompt below is the exact 450-character request text sent, so a
  // forced regeneration replays the same words; identity is reconstruction, not a recording.
  { id: "gun-30", seconds: 1, loop: false, identity: "reconstruction", prompt: "A single round fired from an aircraft-mounted thirty-caliber Browning machine gun, extremely close and dry, one hard metallic report and a short crisp mechanical action clatter immediately decaying to near silence, rifle-caliber snap not a heavy cannon boom, no echo, no wind, no aircraft engine, no shell impact. Isolated sound effect only. No music, no speech, no cinematic sweetening, no artificial stereo movement. One event with a clean attack a" },
  { id: "gun-77", seconds: 2, loop: false, identity: "documented", prompt: "One short burst from a Japanese aircraft seven point seven millimeter machine gun, quick light mechanical chatter and sharp small reports, outdoors, no shell impacts." },
  { id: "cannon-20", seconds: 2, loop: false, identity: "documented", prompt: "One short burst from a Japanese Type 99 twenty millimeter aircraft cannon, distinct heavy automatic reports with mechanical cycling, outdoors, no shell impacts." },
  { id: "bullet-near", seconds: 1, loop: false, identity: "reconstruction", prompt: "One brief close supersonic rifle-caliber projectile crack and air snap passing the listener outdoors, no gun muzzle report and no impact." },
  { id: "aa-heavy", seconds: 4, loop: false, identity: "documented", prompt: "One heavy 1942 naval five-inch gun firing outdoors from a ship, a hard concussive report, brief mechanical recoil and open-air decay, no impact explosion." },
  { id: "aa-11", seconds: 2, loop: false, identity: "documented", prompt: "A short burst from a 1942 naval one point one inch automatic antiaircraft gun mounting, overlapping solid mechanical reports, outdoors, no aircraft or explosions." },
  { id: "aa-20", seconds: 2, loop: false, identity: "documented", prompt: "A short burst from a single naval Oerlikon twenty millimeter antiaircraft cannon, sharp regular automatic reports and mechanical chatter, outdoors, no impacts." },
  { id: "aa-25", seconds: 2, loop: false, identity: "documented", prompt: "A short burst from a Japanese Type 96 twenty-five millimeter naval antiaircraft gun mounting, abrupt heavy automatic chatter with a short pause at the end, outdoors, no impacts." },
  { id: "flak-airburst", seconds: 3, loop: false, identity: "reconstruction", prompt: "One antiaircraft shell bursting in open air, abrupt dry explosive crack with a compact low body and a few brief fragment snaps, open sky with no cavernous echo." },

  // Explosions and damage
  { id: "bomb-deck", seconds: 6, loop: false, identity: "reconstruction", prompt: "One large conventional aerial bomb striking a wooden flight deck over steel and detonating inside a ship, sharp initial impact then a heavy explosive blast, metal debris and a short uneven decay, no sustained fire." },
  { id: "bomb-water", seconds: 5, loop: false, identity: "reconstruction", prompt: "One conventional aerial bomb exploding in seawater, blunt explosive impact followed by a heavy rising splash and falling sheets of water, outdoors over open ocean." },
  { id: "bomb-underwater", seconds: 6, loop: false, identity: "reconstruction", prompt: "One conventional aerial bomb detonating well below the surface of open seawater, heard from above: a deep muffled thud with the blast crack filtered away by the water, a low pressure whump, then a delayed swelling surge as it reaches the surface, no ringing metal and no splash at the start." },
  { id: "depth-charge", seconds: 7, loop: false, identity: "reconstruction", prompt: "One naval depth charge detonating deep underwater, heard on the escort above: a heavy dull concussion with almost no high frequency, a long low rumble carried up through the water, then a slow rising surge, no metallic clang and no sonar ping." },
  { id: "water-column-fall", seconds: 5, loop: false, identity: "reconstruction", prompt: "A tall column of seawater thrown up by an explosion falling back onto the open sea, broad heavy sheets of falling water and hard irregular splashing that fades into settling foam, no explosive blast at any point and no voices." },
  { id: "torpedo-hit", seconds: 6, loop: false, identity: "reconstruction", prompt: "One torpedo warhead detonating against a steel ship hull below the waterline as heard above water close to the ship, heavy muffled concussion, hull shock and water surge, no sonar ping." },
  { id: "torpedo-entry", seconds: 2, loop: false, identity: "reconstruction", prompt: "One heavy aerial torpedo entering the sea at a shallow angle, a forceful splash and short churning water trail, no explosion and no motor heard through the air." },
  { id: "aircraft-crash", seconds: 5, loop: false, identity: "reconstruction", prompt: "One light metal propeller aircraft striking the sea, hard initial water impact, crumpling thin metal and a broad heavy splash, no automatic fuel explosion." },
  { id: "fuel-fire", seconds: 10, loop: true, identity: "reconstruction", conditional: true, prompt: "Sustained liquid-fuel fire on a damaged ship outdoors, uneven rushing flame with small intermittent crackles, no explosions and no voices." },
  { id: "secondary-blast", seconds: 4, loop: false, identity: "reconstruction", prompt: "One compact secondary ammunition explosion inside a burning steel ship, a sudden contained report with rattling metal debris and a brief rough decay." },
  { id: "steel-hit", seconds: 1, loop: false, identity: "reconstruction", prompt: "A short cluster of small projectile impacts on a thick steel ship surface, hard metallic strikes and brief ringing, no large explosion." },
  { id: "hull-collapse", seconds: 6, loop: false, identity: "reconstruction", prompt: "One heavy damaged steel ship structure giving way, slow stressed metal groan followed by tearing plates and falling debris, no monster-like sound and no explosion." },
  { id: "water-fragments", seconds: 2, loop: false, identity: "reconstruction", prompt: "Several small fragments and bullets striking open seawater in quick succession, sharp little splashes and brief water ticks, no explosive blast." },

  // Carrier deck
  { id: "deck-roll", seconds: 8, loop: true, identity: "reconstruction", prompt: "Rubber aircraft wheels rolling steadily over a wooden carrier flight deck, low rolling rumble with restrained repeated plank-joint bumps, no engine and no voices." },
  { id: "wire-catch", seconds: 3, loop: false, identity: "reconstruction", prompt: "One aircraft tailhook catching a steel carrier arresting wire, a sharp cable grab, heavy tensioning whine and short mechanical settling as the aircraft slows, no explosion." },
  { id: "deck-touchdown", seconds: 2, loop: false, identity: "reconstruction", prompt: "One naval aircraft landing gear touching down on a wooden carrier deck, two close tire thumps, a brief rubber chirp and light strut compression, no arresting wire." },
  { id: "deck-handling", seconds: 3, loop: false, identity: "reconstruction", conditional: true, prompt: "One brief aircraft handling action on a wooden carrier deck, heavy rubber wheel nudging a wooden chock with a short wood scrape and one metal fitting clink, no motor and no voices." },
  { id: "deck-footsteps", seconds: 3, loop: false, identity: "reconstruction", conditional: true, prompt: "A few practical boot footsteps on a wooden ship flight deck, firm uneven steps with light clothing movement, no marching rhythm and no voices." },
  { id: "ship-machinery", seconds: 10, loop: true, identity: "reconstruction", prompt: "Low continuous steam-powered warship machinery vibration transmitted through the deck, restrained turbine and ventilation hum with faint mechanical pulse, no diesel chug and no whistle." },
  { id: "hull-wash", seconds: 10, loop: true, identity: "reconstruction", prompt: "Steady seawater rushing and slapping along the hull of a moving large ship, broad water wash and small irregular splashes, no surf breaking on shore and no engine." },
  { id: "general-alarm", seconds: 6, loop: false, identity: "unverified", prompt: "A plausible early-1940s naval electromechanical general alarm, repeated firm metallic gong strikes with short natural resonance through a small shipboard loudspeaker, regular urgent pulse, no voice and no submarine diving klaxon." },
  { id: "radio-key", seconds: 1, loop: false, identity: "reconstruction", prompt: "One short analog aircraft radio transmission opening and closing, a quiet microphone switch click, brief soft static onset and a clean cutoff click, no speech, no digital beep." },
  { id: "radio-static", seconds: 8, loop: true, identity: "reconstruction", prompt: "Low-level analog aircraft radio receiver hiss with subtle irregular crackle, narrow and restrained, no speech, no morse, no digital tones and no sweeping interference." },

  // Pacific
  { id: "ocean-wind", seconds: 10, loop: true, identity: "reconstruction", prompt: "Steady moderate wind over open Pacific seawater with restrained natural gust texture, distant soft water surface noise, no storm, no birds and no ship." },
  { id: "reef-surf", seconds: 10, loop: true, identity: "documented", prompt: "Small Pacific ocean waves breaking across a shallow coral reef and washing onto a low island shore, irregular gentle surf with natural gaps, no storm and no voices." },
  { id: "albatross", seconds: 5, loop: false, identity: "documented", conditional: true, prompt: "A few natural Laysan albatross whinnies and dry bill clacks at a Pacific island nesting colony, sparse separated calls, no generic gull cries and no other birds." },
  { id: "fire-hose", seconds: 8, loop: true, identity: "reconstruction", conditional: true, prompt: "A shipboard fire hose spraying a steady forceful stream of water onto a hard nearby surface, pressurized water hiss and splashing runoff, no pump motor and no voices." },
  { id: "ship-whistle", seconds: 3, loop: false, identity: "reconstruction", conditional: true, prompt: "One restrained steam whistle blast from an early-1940s steam-powered warship outdoors, natural breathy mechanical tone and short decay, no modern electronic horn and no submarine klaxon." },
];

/** Voice-design descriptions, keyed by the role the TTS scripts reference. */
export const VOICES = {
  control:
    "An American male naval aviator in his late thirties, natural general American accent, medium-low register, calm and authoritative under pressure. Brief, clearly articulated operational reports, brisk but intelligible pacing, restrained urgency. Conversational delivery, not a newsreel announcer or movie trailer. Clean dry studio recording, no radio effect, no background noise. Original fictional voice.",
  wingman:
    "An American male naval pilot in his late twenties, natural general American accent, medium register with a lightly rough edge. Alert, practical and concise, with credible urgency during combat but no theatrical shouting. Clear consonants and natural pauses between short reports. Clean dry studio recording, no radio effect, no background noise. Original fictional voice.",
  gunner:
    "An American male aircraft radioman and gunner in his early twenties, natural general American accent, slightly higher register than the pilot. Close, direct, watchful delivery, short warnings spoken clearly through controlled stress. No exaggerated accent, no comedy, no heroic narration. Clean dry studio recording, no radio effect, no background noise. Original fictional voice.",
  pa:
    "An American male Navy petty officer in his forties, natural general American accent, firm baritone, deliberate practical diction. Short shipboard orders with a clear pause between clauses, projecting authority without shouting. No ceremonial flourish, no newsreel cadence. Clean dry studio recording, no loudspeaker effect, no background noise. Original fictional voice.",
};

export const SHIPS = ["Enterprise", "Hornet", "Yorktown", "Akagi", "Kaga", "Soryu", "Hiryu"];
export const DIRECTIONS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];

/**
 * Script templates. `{direction}` and `{ship}` are generation-time substitutions; every finite
 * variant actually used is generated as a whole sentence. `priority` is 1 immediate, 2 tactical,
 * 3 routine (the PRD's expiry windows are 5/15/20 s).
 */
export const SPEECH = [
  { id: "R01", voice: "wingman", priority: 2, text: "Scout Three to Enterprise. Unidentified aircraft in sight. Investigating." },
  { id: "R02", voice: "wingman", priority: 2, text: "Scout Three to Enterprise. Enemy aircraft sighted to the {direction} of our task force.", variants: { direction: "directions" } },
  { id: "R03", voice: "wingman", priority: 2, text: "Scout Three to Enterprise. Zeros in sight. Fighters, watch your altitude." },
  { id: "R04", voice: "wingman", priority: 2, text: "Scout Three to Enterprise. Large ships sighted. Possible carriers. Sending position." },
  { id: "R05", voice: "control", priority: 2, text: "Enterprise to the strike group. Enemy ships are reported moving {direction}. Check your attack course.", variants: { direction: "directions" } },
  { id: "R06", voice: "control", priority: 1, text: "Enterprise to all fighters. Zeros are strafing our flight deck. Intercept immediately." },
  { id: "R07", voice: "control", priority: 1, text: "Enterprise to all fighters. Enemy dive bombers are coming in on us. Break up their attack." },
  { id: "R08", voice: "control", priority: 1, text: "Enterprise to all fighters. Torpedo planes low over the water. Intercept before they release." },
  { id: "R09", voice: "wingman", priority: 2, text: "Scout Three. We have the enemy fighters in sight. Moving to intercept." },
  { id: "R10", voice: "control", priority: 3, text: "Enterprise to all aircraft. The immediate attack has broken off. Maintain your patrol." },
  { id: "R11", voice: "control", priority: 2, text: "Enterprise to all aircraft. Our flight deck is damaged. Stand by for recovery instructions." },
  { id: "R12", voice: "control", priority: 2, text: "Enterprise to all aircraft. {ship} reports fire aboard. Keep clear of the ship.", variants: { ship: "ships" } },
  { id: "R13", voice: "gunner", priority: 1, text: "Engine's running rough. Watch your power." },
  { id: "R14", voice: "gunner", priority: 1, text: "Fuel is running low. We need to head home." },
  { id: "R15", voice: "wingman", priority: 2, text: "Scout Three to Enterprise. {ship} is going down.", variants: { ship: "ships" } },
  { id: "R16", voice: "wingman", priority: 2, text: "Scout Three. Target in sight. Following you in." },
  { id: "R17", voice: "gunner", priority: 3, text: "Bomb away." },
  { id: "R18", voice: "wingman", priority: 2, text: "Scout Three to Enterprise. Hits on the carrier. She's burning." },
  { id: "R19", voice: "gunner", priority: 1, text: "Fighter behind us! Break!" },
  { id: "R20", voice: "wingman", priority: 3, text: "Scout Three to Enterprise. Contact lost. Last position reported." },
  { id: "R21", voice: "control", priority: 3, text: "Enterprise to returning aircraft. Deck is clear. Join the landing pattern." },
  { id: "R22", voice: "control", priority: 1, text: "Wave off! Deck is not clear. Go around." },
  { id: "R23", voice: "control", priority: 2, text: "Enterprise to Yorktown aircraft. Recover aboard Enterprise. Join the landing pattern." },
  { id: "R24", voice: "wingman", priority: 3, text: "Scout Three. Forming up on your wing." },
  { id: "R25", voice: "wingman", priority: 2, text: "Scout Three to Enterprise. Pilot in the water. Marking the position." },
  { id: "R26", voice: "wingman", priority: 2, text: "Scout Three. You're hit — smoke coming from your engine. How does she handle?" },
  { id: "R27", voice: "wingman", priority: 2, text: "Scout Three. You're streaming fuel. Get her on a course for home while she still flies." },
  { id: "R28", voice: "wingman", priority: 1, text: "Scout Three. You're burning! Get out of her!" },
  { id: "R29", voice: "wingman", priority: 1, text: "Scout Three to Enterprise. Lead is hit hard and losing power. I'm staying with him." },
  { id: "R30", voice: "wingman", priority: 1, text: "Scout Three to Enterprise. Lead is going down. Marking the position." },
  { id: "R31", voice: "wingman", priority: 2, text: "Scout Three. You're trailing oil from the engine. Watch your temperature." },
  { id: "R32", voice: "wingman", priority: 1, text: "Scout Three. Pull up! You're going down!" },
  { id: "R33", voice: "wingman", priority: 2, text: "Scout Three. I'm out of ammunition. We should head back to the carrier." },
  { id: "P01", voice: "pa", priority: 2, text: "General quarters. General quarters. All hands to battle stations." },
  { id: "P02", voice: "pa", priority: 3, text: "Flight quarters. Stand by to launch aircraft. Keep the flight deck clear." },
  { id: "P03", voice: "pa", priority: 1, text: "Enemy aircraft approaching. All exposed personnel take cover." },
  { id: "P04", voice: "pa", priority: 1, text: "Fire on the flight deck. Repair parties to your stations." },
  { id: "P05", voice: "pa", priority: 1, text: "Torpedoes approaching. Stand by for emergency maneuver." },
];

/** Slug for a speech row's asset file, e.g. `r06` or `r02-north`. */
export function speechSlug(id, substitutions = {}) {
  const suffix = Object.values(substitutions)
    .map((v) => `-${String(v).toLowerCase().replace(/[^a-z0-9]+/g, "-")}`)
    .join("");
  return `${id.toLowerCase()}${suffix}`;
}

/** Every concrete engine-bank loop, expanded from the template and tables. */
export function engineBank() {
  const rows = [];
  for (const [aircraft, engine] of Object.entries(ENGINES)) {
    const perspectives = INTERIOR_AIRCRAFT.includes(aircraft) ? ["exterior", "interior"] : ["exterior"];
    for (const perspective of perspectives) {
      for (const [state, stateText] of Object.entries(STATES)) {
        const text = ENGINE_TEMPLATE
          .replace("{engine}", engine)
          .replace("{state}", stateText)
          .replace("{perspective}", PERSPECTIVES[perspective]);
        rows.push({
          id: `${aircraft}-engine-${perspective}-${state}-01`,
          file: `audio/${aircraft}-engine-${perspective}-${state}-01.ogg`,
          seconds: 10,
          loop: true,
          identity: "reconstruction",
          prompt: `${text} ${ENGINE_LOOP_SUFFIX}`,
        });
      }
    }
  }
  return rows;
}

/** Every named one-shot/loop prompt with its suffix applied. */
export function namedSfx() {
  return SFX.map((row) => ({
    id: row.id,
    file: `audio/${row.id}.ogg`,
    seconds: row.seconds,
    loop: row.loop,
    identity: row.identity,
    conditional: row.conditional ?? false,
    prompt: `${row.prompt} ${row.loop ? LOOP_SUFFIX : ONE_SHOT_SUFFIX}`,
  }));
}

/** The full SFX catalog: engine bank plus named prompts. */
export function sfxCatalog() {
  return [...engineBank(), ...namedSfx()];
}

/** Every concrete speech clip, expanding `{direction}` and `{ship}` variants. */
export function speechCatalog() {
  const out = [];
  for (const row of SPEECH) {
    if (!row.variants) {
      out.push({ id: row.id, slug: speechSlug(row.id), voice: row.voice, priority: row.priority, text: row.text, substitutions: {} });
      continue;
    }
    for (const [token, source] of Object.entries(row.variants)) {
      const values = source === "directions" ? DIRECTIONS : SHIPS;
      for (const value of values) {
        const text = row.text.replace(`{${token}}`, value);
        out.push({ id: row.id, slug: speechSlug(row.id, { [token]: value }), voice: row.voice, priority: row.priority, text, substitutions: { [token]: value } });
      }
    }
  }
  return out;
}
