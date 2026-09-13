# PRD-midway-realistic-audio-sfx — Hear Midway from the aircraft and the ship

**Status:** IN PROGRESS
**Complexity:** 9 (HIGH)
**Owner:** Midway game implementer; engine maintainer for portable audio mechanisms.
**Depends on:** Existing flight, combat, camera and mission state; Phase 1 portable audio audit.
**Scope:** Audio SFX and historically grounded diegetic speech. Planning only; no implementation authorized by this document.
**Research date:** 2026-09-13
**Progress:** Phase 1 partial — asset pipeline, manifest, non-conditional SFX bank, engine perspective, wind, buffeting and AudioBus migration done and green under the handoff; radio queue, weapons/damage enrichment and the owner listening check remain. Asset records live in `content/audio/midway-audio.json`.
**AUDIO-LISTENING-REQUIRED:** João reviews the final in-game listening sequence; automated checks cannot approve realism.

Implementation complexity: 6–10 likely implementation files (+2), expanded audio subsystem (+2), event/voice/priority lifecycle (+2), independent engine/game release boundary (+2), offline ElevenLabs API integration (+1); risk override: none. The present task changes one Markdown document only and receives proportionate document checks.

## Outcome

The player can hear the difference between sitting inside a Dauntless, watching it from behind, rolling along Enterprise's deck, diving through antiaircraft fire, and returning with a damaged engine. Friendly radio reports explain what allies actually know: aircraft spotted, carrier movements, Zeros attacking Enterprise, incoming bombers, escorts engaging, damaged ships and recovery instructions.

All production SFX and spoken lines are generated offline through the ElevenLabs API. The exact generation prompts, spoken scripts, parameters and trigger rules are specified below. These are historically informed reconstructions, never claimed to be recordings of Midway.

Catalog: 50 individual SFX prompts, 24 engine-loop variants, four voice-design prompts and 30 radio/PA script templates. Conditional cues are generated only when the game has their listed consumer.

## Scope boundaries

1. Cover the existing aircraft, carrier operations, weapons, damage, ocean, atoll and friendly communications. Music is outside this PRD.
2. Keep the existing free-running battle. Historical chronology informs content and validation; it does not force the simulation to repeat predetermined outcomes.
3. Add only state/events needed to describe sounds accurately. No new campaign, playable ship interiors, voice-command interface, flight model or mission editor.
4. Generate assets during development, package them locally and play them offline. No live ElevenLabs calls, API keys, generative dialogue or external speech dependency in the shipped game.
5. Required implementation proof is web plus desktop. Android/iOS remain unqualified until their own target runs; this plan makes no device claim.

## Context

Inspected `src/sim/flight.ts` first, then the audio, scene, camera, combat, damage and installed engine contracts.

| Current location | Established behavior | Required change |
|---|---|---|
| `src/audio.ts`, `Soundscape` | Eight samples; one engine identity, one wind loop, global gain, sampled/synthetic bursts. Direct `window.AudioContext`, fetch and graph ownership. | Keep game cue direction here; adopt engine mechanisms and replace generic/synthetic identities. |
| `src/scenes/Midway.ts:244` and `:251` | Drains `Battle.events` into audio; supplies player and pause state. | Supply current camera/listener pose, emitter identity and communication context. Preserve one dispatch per event. |
| `src/render/world.ts:378`, `updateCamera` | Camera mode 1 is cockpit; modes 0/2 are external views. | Export existing camera/aircraft anchors to audio. Camera switching must audibly change perspective. |
| `src/sim/battle.ts:257`, `say`, and `:263`, `event` | Text lives in the radio history, but the audio event contains only `type: radio` and priority. Most combat events contain only player distance; AI firing does not emit the player's gun cue. | Send stable line/event IDs and source data. Cover AI guns, rear gunner, ship muzzle reports and local impacts. |
| `scripts/check-audio.mjs`; `threenative.config.ts`; `src/game.ts` | Existing audio test uses a stub WebAudio graph. Native and web use the same Midway scene. Assets configuration has no explicit audio conditioning block. | Extend the existing check; add real-entry-point listening/capture checks and declare loop/positional conditioning. |

`src/sim/gunnery.ts` already separates timed-fuse heavy AA and light autocannon. `src/sim/damage.ts` already exposes component integrity, fire, leaks, engine cutoff and wheel rotation. Reuse these states. `Battle.time` starts at zero and quiet transit can run at 3×; it is not a historical wall clock.

The existing [repair PRD](../PRD-midway-reference-repair.md) documents generated audio provenance, including an explosion, a release whistle and wind. Its phrase “real recordings” must not be interpreted as authenticated historical recordings. Existing source names or plausible sound alone do not establish weapon/engine identity.

Known historical mismatches affecting sound: the imported Zero is described as A6M3 in the game instructions, while the intended Midway identity is A6M2; the rendered player gun offsets are described as wing-mounted despite the intended SBD identity. Use the historical sound identities below and record those asset/placement limitations; this audio task does not silently redesign geometry or ballistics.

## Solution

### Ownership and existing engine reuse

The requested `engine_search_capabilities` / `engine_capability_detail` tools were not exposed in this session. Read-only fallback: inspected both installed and engine-source `packages/core/capabilities.json`, the installed `AudioBus` declarations and engine `packages/core/src/audio.ts`.

| Reuse | What is established | Boundary |
|---|---|---|
| `ctx.assets.audio(path)` | Portable asset loader returns decoded audio. | No second game fetch/decode cache. |
| `AudioBus.play`, `playAt`, `setVolume`, `pause`, `resume`, `stopVoice`, `dispose` | Nonpositional and positional playback, moving object attachment, bus gain and lifecycle already exist. | No replacement mixer, pooling framework or browser-only audio adapter. |
| `AudioBus` options | Voice caps, distance rolloff, cutoff, detune and low-pass controls exist. | Installed declarations report native `detune`/`lowpassHz` limitations. Positional playback also requires a working panner. Verify before depending on them. |
| `audioPass` / `assets.audio` | Loop seams and conditioning are measured; native source formats are WAVE/Ogg Vorbis, not MP3. | Convert generated MP3 into actual WAVE/Ogg bytes before baking; renaming is not conversion. |
| Game-owned `Soundscape` and cue data | Aircraft identities, mix curves, historical selection, radio relevance, priorities and prompts are gameplay/content. | Keep those choices in this game. |

Prefer generated interior/exterior stems and ordinary gain crossfades for cockpit acoustics; this works without assuming native runtime filtering. If moving-source pitch, scheduling or another required mechanism cannot work portably, the engine owns that seam. Log the concrete gap in the game's `FRICTION.md` during implementation; ship the engine fix with its test, native proof, capability entry and template `AGENTS.md` documentation. Repack a content-hashed tarball and reinstall. Never patch `node_modules` or leave the old game implementation active.

### Listener and mixing rules

| Listening position | What dominates | What changes |
|---|---|---|
| Pilot cockpit | Low/mid engine vibration, local panel/canopy rattle, airflow, own mechanical actions, headset speech. | Exterior engine exhaust and distant effects are enclosed/filtered; intercom stays intelligible and centered. This is a separate acoustic balance, not just lower master volume. |
| External chase/far camera | Propeller/exhaust radiation, wind and spatial battle. | Sources follow the aircraft/ship rather than the screen; camera position determines distance. Near and far chase views differ naturally. |
| Cockpit with an open canopy, if represented | More broadband slipstream, exposed exterior detail, local rail/latch sounds. | Follow the real authored canopy state. If no canopy state/control exists, author one fixed acoustic state consistent with the model; do not invent an opening mechanic. |
| Carrier deck/near-deck aircraft | Nearby warm-ups, prop wash, wheels on planking, crew activity and localized PA. | Ship vibration belongs to contact with the ship; PA fades away after departure. |
| Atoll/sea-level/ditching | Reef surf near shore, hull/water impacts, local fire and wildlife where appropriate. | No island ambience at high altitude or across the ocean; no underwater sonar audible in the pilot's headset. |

Crossfade camera perspectives over an initial 150 ms target, retaining the same engine phase/state. Drive engine load and pitch from existing normalized RPM/throttle, damage and airspeed; do not pretend normalized RPM is a calibrated tachometer. At constant governed RPM, load can alter timbre without a huge pitch sweep. Wind follows airspeed even with a dead engine. Gear and dive brakes add drag noise only while extended or moving. Do not add a Stuka siren to the SBD or D3A.

Use actual relative radial velocity for restrained Doppler on other aircraft; the pilot does not Doppler-shift their own engine or headset. Do not bake a flyby into a loop that also receives runtime Doppler. A simple sound-speed setting of 343 m/s is an engineering starting point, not reconstructed Midway weather; temperature changes sound speed. [NASA sound-speed explanation](https://www.grc.nasa.gov/www/k-12/BGP/sound.html)

World explosions and gun reports arrive after acoustic travel time. For a stationary 686 m fixture, arrival is approximately 2 s; a nearby own-aircraft clunk remains immediate. Schedule from event position/time and listener motion, not the current `distance` field alone. Apply distance/occlusion once, retain the original event location after the source is destroyed, and distinguish source noise from local bullet impacts. No audible “hit confirmation” on a ship several kilometres away before its sound can arrive.

Keep simulation scheduling and output playback clocks explicit: pause freezes pending world cues; mute discards expired speech/events; resume does not dump a backlog. At 3× quiet transit, engine pitch and spoken delivery remain natural. Re-evaluate relevance before starting queued speech and cancel pending attacks on ships already sunk or threats already destroyed.

Initial mix targets, subject to listening: 48 total sounding voices across categories, at most 12 continuous emitters; important speech receives a slot before distant ambience. Cull the least audible distant sources, not the player's engine or a critical warning. No audible clipping; keep at least 1 dB true-peak headroom in the worst combat capture. Offer master, effects and speech levels through the existing settings/HUD surface, retain captions, and keep full-range versus compressed playback as a small setting only if the normal mix needs it. Do not simulate physical blast loudness, mandatory ringing ears or deliberate speech unintelligibility.

## Historical evidence and sound direction

### Evidence policy

**Documented** means the cited source supports the event, equipment or role. **Reconstruction** means an authored acoustic interpretation or original dialogue. **Unverified** means the specific detail is not established and cannot be advertised as exact. ElevenLabs output is always reconstruction even when it depicts documented equipment.

Prefer action reports, period manuals and museum equipment records. Wartime reports contain mistaken identifications and damage estimates; compare them with later NHHC analysis. The 1943 combat narrative even includes mistaken aircraft identifications, so do not turn every contemporary report into world truth. [NHHC combat narrative](https://www.history.navy.mil/research/library/online-reading-room/title-list-alphabetically/b/battle-of-midway-3-6-june-1942-combat-narrative.html)

### The battle moments that should shape the sound

Times below use the commonly presented Midway battle chronology. Enterprise's June 8 action report explicitly uses Zone +10 and records the dive-bomber attack at 1222; the combat narrative uses Zone +12 and gives 1022. Preserve each source's time basis and normalize before attaching time labels. Do not feed mixed timestamps directly into game timers. [Enterprise report transcription](https://midway1942.com/docs/usn_doc_05.shtml), [period narrative scan](https://upload.wikimedia.org/wikipedia/commons/0/0a/NDL4010127_Battle_of_Midway._Report_No._13-d%2813%29%2C_USSBS_Index_Section_6.pdf)

| Historical moment | Audio consequence | Source and limitation |
|---|---|---|
| June 3 reconnaissance; early June 4 aircraft/carrier sightings | Incomplete contact reports, acknowledgments, preparation and waiting. | [NHHC battle overview](https://www.history.navy.mil/browse-by-topic/wars-conflicts-and-operations/world-war-ii/1942/midway.html). Do not announce precise enemy identities before confirmation. |
| June 4 dawn attack on Midway; carrier launches from about 0700 | Island sirens/AA only near the island; aboard carriers, propellers, deck movement, flight calls and departures. | [NHHC timeline](https://www.history.navy.mil/content/dam/nhhc/news-and-events/multimedia%20gallery/LargeFormatBanners/LargeFormatPDF/PopUp_NHHC_BattleOfMidway_Panel2.pdf). Launches are propeller takeoffs, not a modern jet/steam-catapult soundscape. |
| Repeated torpedo attacks and the carrier dive-bombing attacks around 1022–1026 | Low-level engine strain and nearby defensive fire; dive-brake airflow, release clunk, delayed explosions and prolonged fires. | [NHHC later battle analysis](https://www.history.navy.mil/about-us/leadership/director/directors-corner/h-grams/h-gram-006/h-006-4.html). The carrier strikes do not make all four Japanese carriers explode simultaneously. |
| Yorktown bombed around noon, torpedoed in the afternoon; Hiryū attacked late afternoon | Verified assistance/intercept reports, diversion of returning aircraft, interrupted recovery, later strike reports. | [NHHC H-006-4](https://www.history.navy.mil/about-us/leadership/director/directors-corner/h-grams/h-gram-006/h-006-4.html). Use the ship that was actually hit. |
| June 5–7 aftermath: searches, fuel exhaustion/recovery, June 6 I-168 attack, June 7 Yorktown loss | Long quiet passages, damaged engines, rescue-related calls, restrained distant destruction where the player is present. | [CINCPAC report](https://www.history.navy.mil/research/archives/digital-exhibits-highlights/action-reports/wwii-battle-of-midway/commander-in-chief-pacific-fleet.html). These are coverage references, not a requirement to add later-day missions. |

**Enterprise specifically:** CV-6's report says she faced threats but experienced no actual attack or damage during June 4–6. General quarters, incoming-aircraft warnings, CAP coordination and recovery are appropriate. An actual Zero attack on Enterprise is a valid *emergent gameplay* alert only when the simulation produces it; it is not a scripted historical fact. [Enterprise action report](https://www.history.navy.mil/content/history/nhhc/research/archives/digital-exhibits-highlights/action-reports/wwii-battle-of-midway/uss-enterprise-action-report.html)

### Aircraft sound identities

| US aircraft in this game | Reference identity | Audio requirements |
|---|---|---|
| SBD | SBD-3, Wright R-1820-52; pilot plus radioman/gunner; .50 and .30 caliber armament. [National WWII Museum](https://www.nationalww2museum.org/visit/museum-campus/us-freedom-pavilion/warbirds/douglas-sbd-dauntless) | Hero-quality interior/exterior engine layers; mechanical gun coupling, distinct rear gun, dive brakes, release gear and wire recovery. No generic modern stall horn unless an applicable manual establishes it. |
| TBD | R-1830-64 double-row radial. [Archived Navy aircraft record](https://www.ibiblio.org/hyperwar/OnlineLibrary/photos/ac-usn22/t-types/tbd.htm) | Different radial identity; low torpedo run, release, water entry, engine strain. No torpedo rocket motor. |
| Wildcat | F4F/R-1830 family; confirm exact modeled variant before choosing gun count. [Naval Aviation Museum](https://www.history.navy.mil/content/history/museums/nnam/explore/collections/aircraft/f/f4f-3a-wildcat.html), [USAF engine record](https://www.nationalmuseum.af.mil/Visit/Museum-Exhibits/Fact-Sheets/Display/Article/195797/pratt-whitney-r-1830-90c/) | Strong fighter pass and airframe-specific weapons. Do not substitute the later FM-2 engine because a recording is conveniently available. |
| Catalina | PBY-5, two R-1830-family engines. [Naval Aviation Museum](https://www.history.navy.mil/content/history/museums/nnam/explore/collections/aircraft/p/pby-5-catalina.html) | Two spatially separate engines with small natural phase differences; hull contact with water where the simulation represents it; reconnaissance radio role. |

| Japanese aircraft | Reference identity | Audio requirements |
|---|---|---|
| Zero | A6M2/Sakae 12; two 20 mm cannon plus two 7.7 mm guns. [USAF Museum](https://www.nationalmuseum.af.mil/Visit/Museum-Exhibits/Fact-Sheets/Display/Article/196313/AFmuseum/mitsubishi-a6m2-zero/) | Distinguish cannon from machine-gun attacks; preserve existing model mismatch as a documented limitation. |
| Val | D3A/Kinsei family. [Smithsonian Kinsei 44 record](https://airandspace.si.edu/collection-objects/mitsubishi-kinsei-44-radial-14-engine-cutaway/nasm_A19731577000) | Fixed-gear aerodynamic texture, radial engine, dive-brake noise; no retracting-gear cue or Stuka siren. |
| Kate | B5N2/Sakae 11. [Pearl Harbor Aviation Museum](https://www.pearlharboraviationmuseum.org/news/blog-archives/nakajima-b5n2-kate-type-97-3-carrier-attack-aircraft-at-pearl-harbor/) | Low approach, radial engine, release gear and torpedo entry. The aircraft label in a prompt cannot itself prove engine fidelity. |

### Enterprise, weapons and environmental detail

| Family | Required treatment | Historical limit |
|---|---|---|
| General quarters and shipboard announcements | Electromechanical alarm character, short PA message, local crew response; repeat only on a genuine state change. | Exact CV-6 June 1942 waveform, cadence and announcement wording remain unverified. Do not pass off a submarine diving klaxon as the carrier's verified battle alarm. |
| Air defense and damage control | Distinguish heavy AA reports, smaller automatic weapons, steel impacts, fire, hose/pump activity and structural damage. | Enterprise's fit changed during 1942. March records document 20 mm additions; use 5-inch/38, 1.1-inch and documented 20 mm families, without asserting an exact June mount count. [CV-6 ship history](https://www.history.navy.mil/research/histories/ship-histories/danfs/e/enterprise-cv-6-vii.html), [war history](https://www.history.navy.mil/research/library/online-reading-room/title-list-alphabetically/w/war-damage-reports/uss-enterprise-cv6-war-history-1941-1945.html) |
| Japanese AA | Separate light 25 mm attacks from larger timed airbursts; identify heavy-gun caliber per ship before assigning a caliber label. | Akagi and the other carriers are not interchangeable gun platforms. [NHHC VT-8 analysis](https://www.history.navy.mil/about-us/leadership/director/directors-corner/h-grams/h-gram-072/h-072-1.html) documents Akagi's 25 mm gun position. |
| Explosion sequence | Separate impact, initial detonation, debris, sustained fuel fire, occasional secondary explosion and later structural collapse. Water near-miss is a different source. | No modern missile alarms, radar-lock tones or proximity-fuze behavior; the Navy's first combat use of proximity fuzes was in January 1943. [NHHC account](https://www.history.navy.mil/research/histories/ship-histories/danfs/b/bunker-hill-i.html) |
| Pacific environment | Open-water wind, hull wash, reef surf near the atoll, sparse location-appropriate birds. Machinery should be strongest near the ship/contact path. | Do not make tropical thunder a permanent backdrop. Midway albatrosses are documented; Cornell has a June 1959 Midway recording useful for species/timbre comparison, not 1942 evidence. [NPS history](https://home.nps.gov/articles/the-battle-of-midway-turning-the-tide-in-the-pacific-teaching-with-historic-places.htm), [Cornell sound record](https://www.allaboutbirds.org/guide/Laysan_Albatross/sounds) |

The [Maritime sound archive](https://maritime.org/sound/) lists Navy training calls for general quarters, air defense, flight quarters, fire, torpedo defense, collision, abandon ship and deck procedure. It also distinguishes later recordings made on museum submarine Pampanito in 1995 and states their noncommercial limitation. Use these as references; they are neither automatically cleared assets nor proof of Enterprise's specific installation. A [period submarine electrical manual](https://www.maritime.org/doc/fleetsub/elect/chap16.php) explains gong/announcing mechanisms, but its cadence and circuit arrangement must not be copied as verified CV-6 facts.

John Ford's Midway film and interviews provide battle context, not guaranteed isolated synchronous SFX. Do not sample film explosions and label them on-site audio without recording provenance. [National Archives discussion](https://unwritten-record.blogs.archives.gov/2017/06/01/the-battle-of-midway-and-torpedo-squadron-8-a-memorial-to-a-fallen-unit/), [Ford interview](https://www.history.navy.mil/research/library/oral-histories/wwii/battle-of-midway/john-ford-remembers-filming-battle-of-midway.html)

## ElevenLabs production contract and exact prompts

### API requests

Generate SFX through `POST https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128`. Use the row's exact `text`, duration and loop flag; explicitly set model and prompt influence. Example, a complete wind request:

```json
{
  "text": "Steady broadband airflow past the outside of a 1942 propeller aircraft canopy, constant flying speed, smooth continuous air rush with a little low turbulence, no engine. Isolated sound effect only. No music, no speech, no cinematic sweetening, no artificial stereo movement. Seamless steady loop, no fade-in or fade-out.",
  "model_id": "eleven_text_to_sound_v2",
  "duration_seconds": 10,
  "prompt_influence": 0.6,
  "loop": true
}
```

The verified API accepts `loop` with v2, durations of 0.5–30 s and prompt influence from 0–1. `output_format` is a query parameter. These chosen settings are production starting points, not historical measurements. [ElevenLabs SFX API](https://elevenlabs.io/docs/api-reference/text-to-sound-effects/convert)

Generate spoken words with `POST https://api.elevenlabs.io/v1/text-to-speech/{voice_id}?output_format=mp3_44100_128`, not the SFX endpoint:

```json
{
  "text": "Enterprise to all fighters. Zeros are strafing our flight deck. Intercept immediately.",
  "model_id": "eleven_multilingual_v2",
  "voice_settings": {
    "stability": 0.6,
    "similarity_boost": 0.75,
    "style": 0.15,
    "use_speaker_boost": true
  }
}
```

`voice_id` is the saved voice for the role below, resolved during production. `text` contains only the exact spoken line. Do not submit voice directions, speaker labels or bracketed emotion tags as spoken text. Generate clean speech first; radio/PA processing is a separate, consistent mix step. [ElevenLabs speech API](https://elevenlabs.io/docs/api-reference/text-to-speech/convert), [voice settings](https://elevenlabs.io/docs/api-reference/voices/settings/get)

Both requests use `xi-api-key: <ELEVENLABS_API_KEY>` and `Content-Type: application/json`. The key belongs only to the offline generation environment. The earlier repair work used `ELEVENLABS_API_KEY`; this planning task does not read it or make paid generation calls.

### Exact voice-design prompts

Use `POST https://api.elevenlabs.io/v1/text-to-voice/design` with `model_id: "eleven_multilingual_ttv_v2"`, `voice_description` exactly as below, and `auto_generate_text: true`. Save one selected preview using its returned `generated_voice_id` through the documented `/v1/text-to-voice` creation endpoint; record the resulting persistent `voice_id`. A preview ID is not the final TTS voice ID. [ElevenLabs Voice Design API](https://elevenlabs.io/docs/api-reference/text-to-voice/design)

| Voice role | Exact `voice_description` |
|---|---|
| `control` — Enterprise control, tower and scout coordinator | An American male naval aviator in his late thirties, natural general American accent, medium-low register, calm and authoritative under pressure. Brief, clearly articulated operational reports, brisk but intelligible pacing, restrained urgency. Conversational delivery, not a newsreel announcer or movie trailer. Clean dry studio recording, no radio effect, no background noise. Original fictional voice. |
| `wingman` — Scout Three, Catalina and friendly pilots | An American male naval pilot in his late twenties, natural general American accent, medium register with a lightly rough edge. Alert, practical and concise, with credible urgency during combat but no theatrical shouting. Clear consonants and natural pauses between short reports. Clean dry studio recording, no radio effect, no background noise. Original fictional voice. |
| `gunner` — player's rear-seat radioman/gunner | An American male aircraft radioman and gunner in his early twenties, natural general American accent, slightly higher register than the pilot. Close, direct, watchful delivery, short warnings spoken clearly through controlled stress. No exaggerated accent, no comedy, no heroic narration. Clean dry studio recording, no radio effect, no background noise. Original fictional voice. |
| `pa` — shipboard announcer/deck talker | An American male Navy petty officer in his forties, natural general American accent, firm baritone, deliberate practical diction. Short shipboard orders with a clear pause between clauses, projecting authority without shouting. No ceremonial flourish, no newsreel cadence. Clean dry studio recording, no loudspeaker effect, no background noise. Original fictional voice. |

Keep one stable voice per role across clips. The small cast is an initial production choice; it does not imply Catalina and a carrier speaker are the same character. Use callsign captions to disambiguate. No need to imitate a named historical person.

### Exact SFX prompt construction

For every SFX below, construct `text` as the exact row prompt followed by one space and the applicable exact suffix. No other automatic prompt rewriting.

**One-shot suffix:** `Isolated sound effect only. No music, no speech, no cinematic sweetening, no artificial stereo movement. One event with a clean attack and natural decay.`

**Loop suffix:** `Isolated sound effect only. No music, no speech, no cinematic sweetening, no artificial stereo movement. Seamless steady loop, no fade-in or fade-out.`

Use `prompt_influence: 0.6` and v2 throughout. Durations are API generation lengths; trim/pad only after auditioning, then remeasure the decoded loop. A model being asked for a historical engine does not guarantee that it generates that engine correctly.

### Engine bank — exact parameterized prompt

Generate three exterior operating states for each aircraft below, and three additional interior states for the SBD hero aircraft: 24 engine loops initially. Each is 10 s, `loop: true`. Substitute the exact table strings into this exact template, then append the loop suffix:

```text
{engine}. {state}. {perspective}. Audible cylinder pulses, propeller loading and mechanical texture, steady operating condition without acceleration, starting, stopping, misfire or flyby. Engine sound only, no wind or gunfire.
```

| Aircraft key | Exact `{engine}` |
|---|---|
| `sbd` | One Wright R-1820-52 nine-cylinder radial piston engine driving the propeller of a Douglas SBD-3 Dauntless |
| `tbd` | One Pratt and Whitney R-1830-64 twin-row radial piston engine driving the propeller of a Douglas TBD-1 Devastator |
| `wildcat` | One Pratt and Whitney R-1830 twin-row radial piston engine driving the propeller of a Grumman F4F Wildcat |
| `catalina` | One isolated Pratt and Whitney R-1830 radial piston engine from a Consolidated PBY-5 Catalina; only one engine in this recording |

| Aircraft key | Exact `{engine}` |
|---|---|
| `zero` | One Nakajima Sakae 12 twin-row radial piston engine driving the propeller of a Mitsubishi A6M2 Zero |
| `val` | One Mitsubishi Kinsei radial piston engine driving the propeller of an Aichi D3A1 dive bomber |
| `kate` | One Nakajima Sakae 11 twin-row radial piston engine driving the propeller of a Nakajima B5N2 torpedo bomber |

| State key | Exact `{state}` |
|---|---|
| `idle` | Low steady idle with distinct uneven but healthy exhaust pulses and subdued propeller wash |
| `cruise` | Steady cruising power with a settled mechanical drone and moderate propeller load |
| `power` | Sustained high takeoff power with dense exhaust pulses and heavy propeller load, mechanically healthy |

| Perspective key | Exact `{perspective}` |
|---|---|
| `exterior` | Dry stationary close exterior recording, listener near the aircraft but outside the propeller arc, no room echo and no movement past the microphone |
| `interior` | Pilot-seat perspective inside the partially enclosed cockpit, low and mid frequency airframe vibration with softened exhaust detail through the cowling and canopy, no exaggerated bass |

Name assets `{aircraft}-engine-{perspective}-{state}-01.ogg`. Play Catalina's single-engine stem from two engine anchors with independent loop phases; do not layer a baked twin-engine recording twice. Additional player-aircraft interiors are needed only if those aircraft become playable.

### Airframe and cockpit prompts

| Cue / duration / loop | Exact row prompt | Trigger and perspective |
|---|---|---|
| `airflow-exterior` / 10 s / yes | Steady broadband airflow past the outside of a 1942 propeller aircraft canopy, constant flying speed, smooth continuous air rush with a little low turbulence, no engine. | IAS-driven exterior airflow. |
| `airflow-cockpit` / 10 s / yes | Steady air leaking and rushing around the frame of a partially enclosed 1942 dive bomber cockpit, restrained high hiss and soft low turbulence, pilot-seat perspective, no engine. | Cockpit IAS layer. |
| `sbd-dive-brake` / 8 s / yes | Turbulent air streaming through the extended perforated dive brakes of a Douglas SBD Dauntless, coarse fluttering air roar at constant dive speed, no siren and no engine. | Only with deployed brakes; speed-dependent gain. |
| `airframe-buffet` / 6 s / yes | Irregular low aerodynamic buffeting transmitted through a light metal propeller aircraft airframe, short soft panel rattles and turbulent vibration, no electronic warning and no engine. | Stall/load state, distinct from a modern horn. |
| `cockpit-rattle` / 8 s / yes | Subtle irregular rattling of small instrument-panel fittings and canopy frame in a vibrating 1942 metal aircraft cockpit, close and dry, no engine and no wind. | Weak local layer modulated by actual vibration/load. |

| Cue / duration / loop | Exact row prompt | Trigger and perspective |
|---|---|---|
| `gear-travel` / 3 s / no | One short hydraulic landing gear mechanism operating on a 1940s naval propeller aircraft, restrained mechanical whir and metal linkage movement ending in a firm locking clunk. | Actual travel edge; retime to mechanism duration. Do not use on Val. |
| `flap-travel` / 2 s / no | One short movement of a 1940s aircraft flap linkage, muted hydraulic mechanism and light metal joints settling into position. | Actual flap/dive-brake actuator movement. |
| `canopy-latch` / 1 s / no | One close mechanical latch fastening on a lightweight framed aircraft canopy, metal click followed by a small firm clunk. | Only if a represented canopy action exists. |
| `bomb-shackle` / 1 s / no | One heavy bomb shackle releasing beneath a 1942 dive bomber, short mechanical snap and solid metal release clunk transmitted through the aircraft, no whistle and no explosion. | Successful release, never empty trigger. |
| `torpedo-release` / 1 s / no | One heavy aerial torpedo released from an aircraft mounting rack, a short latch snap and weighty metal linkage clunk, no propulsion sound and no explosion. | Successful torpedo release. |

| Cue / duration / loop | Exact row prompt | Trigger and perspective |
|---|---|---|
| `sbd-engine-start` / 8 s / no | A plausible 1942 nine-cylinder aircraft radial engine starting, mechanical starter activity followed by several uneven combustion catches that settle into a low idle, no dramatic backfire. | Only a real stopped-to-running transition; starter model remains reconstruction pending manual verification. |
| `sbd-engine-stop` / 5 s / no | A nine-cylinder aircraft radial engine shutting down from idle, combustion pulses cease and rotating machinery slows naturally to rest, no explosion. | Ground shutdown; a windmilling airborne propeller must not use a stop-to-rest ending. |
| `engine-rough` / 8 s / yes | Irregular missed combustion pulses and rough mechanical vibration from a damaged aircraft radial piston engine, sustained uneven running, no explosions and no music. | Existing engine damage; crossfade over healthy layer. |
| `prop-windmill` / 8 s / yes | An unpowered aircraft propeller turning in steady airflow, soft repetitive mechanical rotation and air swish without any combustion or exhaust. | Airborne engine cutoff while propeller still turns. |
| `airframe-hit` / 1 s / no | A short burst of small hard impacts puncturing thin aluminum aircraft skin near the listener, sharp metal ticks and a brief loose-panel rattle, no large explosion. | Local own-aircraft hits; place by damage zone. |

### Weapons, explosions and damage prompts

| Cue / duration / loop | Exact row prompt | Trigger and distinction |
|---|---|---|
| `gun-50` / 2 s / no | One short burst from a single aircraft-mounted Browning fifty-caliber machine gun, rapid hard mechanical reports with a dry percussive attack, outdoors, no shell impacts. | SBD/Wildcat gun identity; cadence comes from actual weapon state, not arbitrary sample retriggering. |
| `gun-30` / 2 s / no | One short burst from a flexible aircraft-mounted thirty-caliber Browning machine gun, lighter fast mechanical chatter, outdoors, no shell impacts. | Rear-gunner identity, emitted from rear station. |
| `gun-77` / 2 s / no | One short burst from a Japanese aircraft seven point seven millimeter machine gun, quick light mechanical chatter and sharp small reports, outdoors, no shell impacts. | Japanese rifle-caliber aircraft weapon. |
| `cannon-20` / 2 s / no | One short burst from a Japanese Type 99 twenty millimeter aircraft cannon, distinct heavy automatic reports with mechanical cycling, outdoors, no shell impacts. | Zero cannon; never substitute a modern rotary gun. |
| `bullet-near` / 1 s / no | One brief close supersonic rifle-caliber projectile crack and air snap passing the listener outdoors, no gun muzzle report and no impact. | Only an actual nearby projectile path; do not fire on every tracer. |

| Cue / duration / loop | Exact row prompt | Trigger and distinction |
|---|---|---|
| `aa-heavy` / 4 s / no | One heavy 1942 naval five-inch gun firing outdoors from a ship, a hard concussive report, brief mechanical recoil and open-air decay, no impact explosion. | US heavy-AA muzzle report. |
| `aa-11` / 2 s / no | A short burst from a 1942 naval one point one inch automatic antiaircraft gun mounting, overlapping solid mechanical reports, outdoors, no aircraft or explosions. | US intermediate AA; do not use Bofors identity. |
| `aa-20` / 2 s / no | A short burst from a single naval Oerlikon twenty millimeter antiaircraft cannon, sharp regular automatic reports and mechanical chatter, outdoors, no impacts. | US light AA. |
| `aa-25` / 2 s / no | A short burst from a Japanese Type 96 twenty-five millimeter naval antiaircraft gun mounting, abrupt heavy automatic chatter with a short pause at the end, outdoors, no impacts. | Japanese light AA. |
| `flak-airburst` / 3 s / no | One antiaircraft shell bursting in open air, abrupt dry explosive crack with a compact low body and a few brief fragment snaps, open sky with no cavernous echo. | Detonation location, distinct from firing ship. |

| Cue / duration / loop | Exact row prompt | Trigger and distinction |
|---|---|---|
| `bomb-deck` / 6 s / no | One large conventional aerial bomb striking a wooden flight deck over steel and detonating inside a ship, sharp initial impact then a heavy explosive blast, metal debris and a short uneven decay, no sustained fire. | A successful deck/internal blast; material-aware. |
| `bomb-water` / 5 s / no | One conventional aerial bomb exploding in seawater, blunt explosive impact followed by a heavy rising splash and falling sheets of water, outdoors over open ocean. | Water near-miss; no metallic debris. |
| `torpedo-hit` / 6 s / no | One torpedo warhead detonating against a steel ship hull below the waterline as heard above water close to the ship, heavy muffled concussion, hull shock and water surge, no sonar ping. | Confirmed underwater hull detonation, not entry. |
| `torpedo-entry` / 2 s / no | One heavy aerial torpedo entering the sea at a shallow angle, a forceful splash and short churning water trail, no explosion and no motor heard through the air. | Entry only; a failed or dud weapon is not an explosion. |
| `aircraft-crash` / 5 s / no | One light metal propeller aircraft striking the sea, hard initial water impact, crumpling thin metal and a broad heavy splash, no automatic fuel explosion. | Ditch/crash; add fire/explosion only when simulated. |

| Cue / duration / loop | Exact row prompt | Trigger and distinction |
|---|---|---|
| `fuel-fire` / 10 s / yes | Sustained liquid-fuel fire on a damaged ship outdoors, uneven rushing flame with small intermittent crackles, no explosions and no voices. | Persistent actual fire at the damaged location. |
| `secondary-blast` / 4 s / no | One compact secondary ammunition explosion inside a burning steel ship, a sudden contained report with rattling metal debris and a brief rough decay. | Discrete destruction/fire escalation event, not a random continuous fire ornament. |
| `steel-hit` / 1 s / no | A short cluster of small projectile impacts on a thick steel ship surface, hard metallic strikes and brief ringing, no large explosion. | Small-caliber hits on ships. |
| `hull-collapse` / 6 s / no | One heavy damaged steel ship structure giving way, slow stressed metal groan followed by tearing plates and falling debris, no monster-like sound and no explosion. | A real collapse/sinking transition, not all damaged ships. |
| `water-fragments` / 2 s / no | Several small fragments and bullets striking open seawater in quick succession, sharp little splashes and brief water ticks, no explosive blast. | Local near-water projectile impact group. |

### Carrier, radio and Pacific prompts

| Cue / duration / loop | Exact row prompt | Trigger and distinction |
|---|---|---|
| `deck-roll` / 8 s / yes | Rubber aircraft wheels rolling steadily over a wooden carrier flight deck, low rolling rumble with restrained repeated plank-joint bumps, no engine and no voices. | Deck contact and relative wheel speed; stops at liftoff. |
| `wire-catch` / 3 s / no | One aircraft tailhook catching a steel carrier arresting wire, a sharp cable grab, heavy tensioning whine and short mechanical settling as the aircraft slows, no explosion. | Successful wire capture, not every touchdown. |
| `deck-touchdown` / 2 s / no | One naval aircraft landing gear touching down on a wooden carrier deck, two close tire thumps, a brief rubber chirp and light strut compression, no arresting wire. | Contact before wire/roll; wave-off stays airborne. |
| `deck-handling` / 3 s / no | One brief aircraft handling action on a wooden carrier deck, heavy rubber wheel nudging a wooden chock with a short wood scrape and one metal fitting clink, no motor and no voices. | Actual chock/service action; no random noise on empty decks. |
| `deck-footsteps` / 3 s / no | A few practical boot footsteps on a wooden ship flight deck, firm uneven steps with light clothing movement, no marching rhythm and no voices. | Nearby visible crew motion, not a global bed. |

| Cue / duration / loop | Exact row prompt | Trigger and distinction |
|---|---|---|
| `ship-machinery` / 10 s / yes | Low continuous steam-powered warship machinery vibration transmitted through the deck, restrained turbine and ventilation hum with faint mechanical pulse, no diesel chug and no whistle. | Ship contact/near machinery; much weaker airborne. |
| `hull-wash` / 10 s / yes | Steady seawater rushing and slapping along the hull of a moving large ship, broad water wash and small irregular splashes, no surf breaking on shore and no engine. | Local ship waterline/wake ambience. |
| `general-alarm` / 6 s / no | A plausible early-1940s naval electromechanical general alarm, repeated firm metallic gong strikes with short natural resonance through a small shipboard loudspeaker, regular urgent pulse, no voice and no submarine diving klaxon. | Reconstructed CV-6 alert candidate; exact historical cadence unverified. |
| `radio-key` / 1 s / no | One short analog aircraft radio transmission opening and closing, a quiet microphone switch click, brief soft static onset and a clean cutoff click, no speech, no digital beep. | Trim into separate entry/exit cues; weak relative to speech. |
| `radio-static` / 8 s / yes | Low-level analog aircraft radio receiver hiss with subtle irregular crackle, narrow and restrained, no speech, no morse, no digital tones and no sweeping interference. | Only while tuned/transmitting as appropriate, never a loud continuous mask. |

| Cue / duration / loop | Exact row prompt | Trigger and distinction |
|---|---|---|
| `ocean-wind` / 10 s / yes | Steady moderate wind over open Pacific seawater with restrained natural gust texture, distant soft water surface noise, no storm, no birds and no ship. | Exposed listener; avoid doubling aircraft slipstream. |
| `reef-surf` / 10 s / yes | Small Pacific ocean waves breaking across a shallow coral reef and washing onto a low island shore, irregular gentle surf with natural gaps, no storm and no voices. | Atoll proximity only. |
| `albatross` / 5 s / no | A few natural Laysan albatross whinnies and dry bill clacks at a Pacific island nesting colony, sparse separated calls, no generic gull cries and no other birds. | Sparse atoll-local detail; compare species reference before acceptance. |
| `fire-hose` / 8 s / yes | A shipboard fire hose spraying a steady forceful stream of water onto a hard nearby surface, pressurized water hiss and splashing runoff, no pump motor and no voices. | Only if a represented damage-control activity is active. |
| `ship-whistle` / 3 s / no | One restrained steam whistle blast from an early-1940s steam-powered warship outdoors, natural breathy mechanical tone and short decay, no modern electronic horn and no submarine klaxon. | Only a supported maneuver/warning event; not a perpetual carrier cue. |

This catalog covers the current audio scope and explicitly conditional sounds. A conditional cue without a real consumer is left ungenerated and recorded as not applicable; it is not silently presented as implemented. Japanese voice dialogue, deep ship interiors, storm weather, Morse traffic and additional aircraft types require their own actual scenario/consumer before production.

### Generation, audition and packaging

1. Produce the SBD cruise interior/exterior pair, `general-alarm`, the `control` voice and R06 first. Audition them in context before generating the complete catalog. A rejected historical identity changes the prompt or reference, not just volume.
2. Produce one take per loop/mechanism and three independently generated takes for frequently repeated gun, flak, impact and explosion cues. Use the exact same prompt first; retain take IDs and reject unwanted speech, music, sirens, baked flybys, clipping or false mechanical character.
3. Record each exact request body, role/voice ID, returned request ID when available, generation date, source/output hashes, duration and conditioning in one machine-consumed asset manifest. Proposed location: `content/audio/midway-audio.json`. Do not create a parallel prose evidence ledger. Generated stems are reconstructions; note any engine/weapon identity that remains approximate.
4. Convert selected output to WAVE/Ogg Vorbis, downmix positional emitters to mono, retain suitable stereo ambience only for nonpositional beds, and run the installed asset conditioning. Normalize relative to a reference mix rather than making every clip equally loud. Keep clean speech masters so radio coloration can be revised without paying to regenerate words.
5. Package only used assets under `public/assets/audio/`; estimate the batch's requested audio seconds/characters against the account's current rates before later execution. API failure or exhausted credits stops the affected batch without accepting an error body as audio; a runtime missing clip logs once, preserves captions and uses only a clearly declared generic fallback.

## Friendly radio alerts — exact speech and trigger rules

### What the player should hear

These are **original period-inspired game scripts**, not historical quotations or transcripts. Short useful reports create the sense of a cooperating task force. Quiet transit still contains long intervals of silence. Do not turn the radio into continuous narration of every AI decision.

Use three distinct paths: shipboard PA from the nearby ship, friendly aircraft/fleet radio in the headset, and the rear gunner's intercom. PA never travels directly into an airborne pilot's headset; a fleet operator must relay an appropriate radio message. Ship machinery also does not travel over the radio. External cameras may retain headset speech for player continuity, explicitly treated as the player monitoring their radio.

Prepare speech offline. Tokens such as `{direction}` and `{ship}` below are generation-time substitutions, not strings sent literally to ElevenLabs or generated during play. Generate full sentences for the finite variants actually used. Do not splice individually spoken digits/words into unnatural combat speech.

`{direction}` uses exactly `north`, `northeast`, `east`, `southeast`, `south`, `southwest`, `west`, `northwest`; its reference is named in the script. `{ship}` is a confirmed ship name from the existing battle: `Enterprise`, `Hornet`, `Yorktown`, `Akagi`, `Kaga`, `Soryu`, `Hiryu`, as applicable. Do not expose a Japanese carrier's name before the reporting side identifies it. For uncertain information use the explicitly uncertain script. Precise bearings, counts and ranges can remain in the caption/map until a finite spoken vocabulary is justified.

### Contact and movement reports

| ID / voice | Exact TTS `text` | Required trigger |
|---|---|---|
| R01 / wingman | Scout Three to Enterprise. Unidentified aircraft in sight. Investigating. | A friendly observer gains an unclassified contact; not an enemy guarantee. |
| R02 / wingman | Scout Three to Enterprise. Enemy aircraft sighted to the {direction} of our task force. | Observer confirms hostility and reports a current task-force-relative sector. |
| R03 / wingman | Scout Three to Enterprise. Zeros in sight. Fighters, watch your altitude. | The reporting observer identifies Zero fighters, not generic unknown aircraft. |
| R04 / wingman | Scout Three to Enterprise. Large ships sighted. Possible carriers. Sending position. | New visible surface group, classification still uncertain; map gets only observer-known data. |
| R05 / control | Enterprise to the strike group. Enemy ships are reported moving {direction}. Check your attack course. | A delivered scout report materially updates observed enemy course; direction here is heading, not relative bearing. |

### Carrier defense and friendly action

| ID / voice | Exact TTS `text` | Required trigger |
|---|---|---|
| R06 / control | Enterprise to all fighters. Zeros are strafing our flight deck. Intercept immediately. | Confirmed Zero is actively attacking Enterprise; friendly report available. Presence nearby or a generic threat timer alone cannot trigger this. |
| R07 / control | Enterprise to all fighters. Enemy dive bombers are coming in on us. Break up their attack. | Identified bomber attack run against Enterprise, still active when message starts. |
| R08 / control | Enterprise to all fighters. Torpedo planes low over the water. Intercept before they release. | Identified torpedo aircraft attacking Enterprise before release. After release use PA/local torpedo warning, not this stale instruction. |
| R09 / wingman | Scout Three. We have the enemy fighters in sight. Moving to intercept. | A friendly unit actually accepts an intercept and has a known target. |
| R10 / control | Enterprise to all aircraft. The immediate attack has broken off. Maintain your patrol. | No known active attack remains in the carrier defense area for 15 s; this does not claim the entire battle is clear. |

### Damage, fuel and emergencies

| ID / voice | Exact TTS `text` | Required trigger |
|---|---|---|
| R11 / control | Enterprise to all aircraft. Our flight deck is damaged. Stand by for recovery instructions. | Enterprise deck actually becomes unavailable from damage in this emergent battle. |
| R12 / control | Enterprise to all aircraft. {ship} reports fire aboard. Keep clear of the ship. | An allied ship reports its own new fire; no enemy damage telemetry. |
| R13 / gunner | Engine's running rough. Watch your power. | Own engine crosses a meaningful damage threshold, not every damage tick. |
| R14 / gunner | Fuel is running low. We need to head home. | Own fuel crosses existing return/reserve threshold once; not a random tension line. |
| R15 / wingman | Scout Three to Enterprise. {ship} is going down. | Friendly observer witnesses an identified ship's sinking; a hidden health value is insufficient. |

### Strike coordination and immediate warnings

| ID / voice | Exact TTS `text` | Required trigger |
|---|---|---|
| R16 / wingman | Scout Three. Target in sight. Following you in. | Wingman enters an attack on the player's designated, observed target. |
| R17 / gunner | Bomb away. | Player successfully releases a bomb; one acknowledgement for a release group, not every physics tick. |
| R18 / wingman | Scout Three to Enterprise. Hits on the carrier. She's burning. | Observer sees a carrier hit and fire; no automatic “sunk” confirmation. |
| R19 / gunner | Fighter behind us! Break! | Rear gunner has a threatening fighter in the rear sector and an attack is imminent; emergency priority. |
| R20 / wingman | Scout Three to Enterprise. Contact lost. Last position reported. | Previously reported target leaves observation; preserve last-known map state rather than live hidden position. |

### Recovery, regrouping and rescue

| ID / voice | Exact TTS `text` | Required trigger |
|---|---|---|
| R21 / control | Enterprise to returning aircraft. Deck is clear. Join the landing pattern. | Deck is available and the player reaches the recovery area. |
| R22 / control | Wave off! Deck is not clear. Go around. | Existing approach logic detects blocked deck; treat as game assistance, not a verified 1942 LSO radio procedure. |
| R23 / control | Enterprise to Yorktown aircraft. Recover aboard Enterprise. Join the landing pattern. | Yorktown unavailable, Enterprise available, and actual Yorktown aircraft need diversion. Otherwise do not use this named line. |
| R24 / wingman | Scout Three. Forming up on your wing. | Wingman actually transitions to join/escort, not on each follow update. |
| R25 / wingman | Scout Three to Enterprise. Pilot in the water. Marking the position. | A visible survivable ditching/rescue target exists. Conditional: do not infer a survivor from every aircraft explosion. |

### Shipboard PA — never global radio

| ID / voice | Exact TTS `text` | Required trigger |
|---|---|---|
| P01 / pa | General quarters. General quarters. All hands to battle stations. | Ship enters battle readiness; once per transition, with the reconstructed alarm. |
| P02 / pa | Flight quarters. Stand by to launch aircraft. Keep the flight deck clear. | Real launch preparation/deck state. |
| P03 / pa | Enemy aircraft approaching. All exposed personnel take cover. | A confirmed threat approaches the ship; do not duck a more urgent headset warning. |
| P04 / pa | Fire on the flight deck. Repair parties to your stations. | This ship has an actual deck fire. |
| P05 / pa | Torpedoes approaching. Stand by for emergency maneuver. | This ship's lookout detects threatening torpedo tracks. |

Shipboard phrasing is reconstructed; do not add modern material-condition codes, “this is not a drill,” modern air-traffic language, “call the ball,” digital alert tones or sonar pings simply because they occur in a modern carrier recording. Existing instructional lines containing keys such as W, R, H or Shift stay in the tutorial/caption channel and are not voiced as period radio.

### Radio delivery contract

1. **Know before reporting.** Build alerts from existing friendly observation/contact reports, local damage and actual accepted orders. Preserve source, observation time, confidence and last-known location. Check the listener is on the relevant friendly channel. No cross-team omniscience, instant intercepted Japanese dialogue or disconnected speaker announcing after death.
2. **One intelligible voice.** One radio sentence at a time; urgent rear-gunner warnings can interrupt routine radio. Fade interruption over 50 ms and drop the interrupted stale line. Duck effects initially by 4 dB during speech; preserve nearby weapon transients and restore gain smoothly. PA is localized but should not compete at equal prominence with critical headset speech.
3. **Prioritize and expire.** Immediate threats/own-aircraft emergencies first; tactical reports next; routine deck/formation information last. Initial expiry windows: 5 s, 15 s and 20 s respectively, plus recheck the triggering predicate. Maximum four queued sentences; discard the oldest lowest-priority entry on overflow. A complete short immediate line should begin within 500 ms when the channel is free.
4. **Speak on change.** Deduplicate by cue, reporting source, target and event identity. Initial repeat cooldown: 30 s for the same ongoing threat and 45 s for routine status. A new attack/target or a material observed movement can speak sooner; uncertain bearing jitter cannot. Use three-second gaps between routine sentences and silence when there is nothing useful to say.
5. **Preserve clarity.** Narrow-band radio and gentle saturation are processing choices, not a request to generate unintelligible speech. Start around a 300–3,000 Hz passband, compare against clean speech, and tune for comprehension. Keep intercom cleaner and PA spatial. These are mix starting points, not authenticated 1942 electronics measurements; bake variants if native filters cannot honor them. Captions display the same words, speaker and uncertainty, including when muted.

## Acceptance Criteria

Implementation boxes remain open. Document completion is not implementation completion.

### Sources, production and perspective

- [ ] AC-1 [local; actor: implementing agent]: Every shipped cue is reached by a listed game trigger and has its exact ElevenLabs request, identity, reconstruction status and asset hash in the consumed manifest; unused conditional cues are explicitly excluded — Evidence: pending.
- [ ] AC-2 [local; actor: implementing agent]: Taking the deck and cycling cameras at matched aircraft state audibly changes interior/exterior engine and wind balance; no restart, doubled engine or transition click. Engine cutoff leaves airspeed-driven wind; wheel/deck cues stop at liftoff — Evidence: pending E1/E2.
- [ ] AC-3 [local; actor: implementing agent]: Player, AI and rear-gunner weapon events emit the appropriate source identity; release, airburst, water impact, deck blast, fire and torpedo entry/hit remain distinguishable and tied to real outcomes — Evidence: pending E1/E2.
- [ ] AC-4 [local; actor: implementing agent]: In the real scene, moving emitters pan correctly; a stationary explosion 686 m away begins at 2.0 s ± one simulation tick; cockpit/headset cues remain local; no doubled attenuation or stale-source attachment after destruction — Evidence: pending E1/E2.

### Communications and lifecycle

- [ ] AC-5 [local; actor: implementing agent]: A friendly sighting produces the correct caption and generated line; an active identified Zero attack on Enterprise produces R06 once; a merely nearby or destroyed Zero does not. Contact loss and uncertainty do not reveal hidden positions — Evidence: pending E1/E2.
- [ ] AC-6 [local; actor: implementing agent]: Emergency/routine contention follows priority, expiry, queue and deduplication rules; radio, intercom and PA use separate audible paths. No PA remains audible after departure beyond its physical range — Evidence: pending E1/E2.
- [ ] AC-7 [local; actor: implementing agent]: Pause, mute, resume, 3× quiet transit, restart and scene exit leave no leaked/duplicated voices, accelerated speech, expired alert backlog or resumed sounds after disposal; missing samples retain captions and report their fallback once — Evidence: pending E1/E2.
- [ ] AC-8 [local; actor: implementing agent]: Web and a real desktop target load the same packaged WAVE/Ogg assets through engine audio; required panning/pitch/perspective works on both. No unsupported runtime option is silently accepted as parity — Evidence: pending E2/E3; target availability must be checked during execution.

### Final mix

- [ ] AC-9 [local; actor: implementing agent]: Full combat capture has no clipped samples or audible loop seams, keeps at least 1 dB true-peak headroom and respects the stated voice limits; island/ship ambience disappears outside the applicable listening context — Evidence: pending E2/E3.
- [ ] AC-10 [owner; actor: João]: Listen to the matched deck/cockpit/exterior, attack warning, strike and damaged-return sequence; confirm recognizable perspective change, useful understandable radio, believable physical detail and no obviously modern or cinematic substitute sounds — Evidence: pending E4. This is required only when implementing, not approval to write this plan.

## Integration Ledger

No runtime wiring changes in this planning task. Future implementation must close these real consumer boundaries:

| Capability | Reachable consumer / entry point | Replacement disposition | Evidence |
|---|---|---|---|
| Aircraft perspective | Take the deck → `Midway.begin`/update → `World.updateCamera` + player state → `Soundscape` | Replace one shared drone/wind balance; retain existing UI mute/start behavior. | AC-2, AC-7 |
| Spatial battle | `Battle.fire`, `dropBomb`, weapon resolution, `updateGunnery`, damage events → scene event drain at `src/scenes/Midway.ts:244` → emitter playback | Replace distance-only generic bursts; include currently silent AI/muzzle paths. | AC-3, AC-4 |
| Friendly intelligence | `Battle.say` at `src/sim/battle.ts:257` + observed state transitions → line ID/payload → bounded speech queue → audio and matching caption | Replace radio beep for eligible voiced lines; keep tutorial instructions in text. | AC-5, AC-6 |
| Carrier/local environment | Existing deck contact, service, crew activity, fire, atoll distance → scoped cue state | Replace generic landing burst; no unconnected looping ambience. | AC-2, AC-9 |
| Platform/asset lifecycle | `src/game.ts` → same Midway scene → `ctx.assets.audio` / `AudioBus` → actual output device | Remove direct browser graph ownership from game; convert MP3 assets and retire superseded active paths. | AC-1, AC-7, AC-8 |

## Execution Phases

### Phase 1: Portable audio and aircraft perspective

**Status:** PARTIAL — code and assets landed; E3 native smoke pending.
**ACs:** AC-1, AC-2; foundation for AC-7/AC-8.
**Files:** `src/audio.ts`, `src/scenes/Midway.ts`, `src/render/world.ts`, `threenative.config.ts`; proposed `content/audio/midway-audio.json`; existing engine `packages/core/src/audio.ts` only if a required seam is missing.

**Implementation:** Capture the existing deck/cockpit/exterior baseline first. Recheck installed capabilities using the named engine tools if available. Produce the audition set, adopt `AudioBus` and the scene asset loader, then wire the SBD interior/exterior/RPM/wind layers through the real camera state. Use existing gain controls and baked perspectives first. Establish supported source attachment, pitch and delayed scheduling on desktop before scaling the bank. Engine-owned fixes must ship with native proof and the repository-required documentation/tarball adoption; game content remains local. Replace the old active engine drone path once the new one is reached.

**Verification:** E1 — extend `scripts/check-audio.mjs` for changed state/lifecycle behavior; E2 — actual deck/camera/cutoff capture; E3 — desktop audio smoke for required mechanisms. Preserve current test intent but revise assumptions such as the generic stall horn when explicitly replaced by this design.
**Checkpoint:** Pending. Resolve native mechanism failures before adding more content.

### Phase 2: Friendly radio and Enterprise alerts

**Status:** PARTIAL — the `control` voice and `R06` are generated and in the manifest; the bounded speech queue and caption wiring are NOT STARTED.
**ACs:** AC-5, AC-6; communication portions of AC-1/AC-7.
**Files:** `src/sim/battle.ts`, `src/scenes/Midway.ts`, `src/audio.ts`; proposed `src/audio-cues.ts` only if keeping the finite script table separate improves readability; existing caption/HUD code only where needed; asset manifest and generated clips.

**Implementation:** Carry stable speech/event IDs, speaker, source/target, observation context and text through the actual radio event. Record the four voice roles and the listed reachable scripts. Implement sighting, active Zero attack, intercept, immediate-threat and recovery paths first, then the rest of the reachable catalog. Separate localized PA from headset and intercom; add priority/expiry/deduplication. Do not add a generic event framework, live TTS service or script editor.

**Verification:** E1 — direct real Battle event producers plus queue assertions; E2 — an observed contact, active Zero attack on Enterprise, false-positive control, contact loss, simultaneous routine/emergency call, paused/resumed call and departure beyond PA range. Inspect the actual decoded/played audio and matching captions, not just dispatch counts.
**Checkpoint:** Pending. R06 must be heard in the real scene and absent when its predicate is false.

### Phase 3: Weapons, damage and the sea battle

**Status:** NOT STARTED
**ACs:** AC-3, AC-4; remaining combat production for AC-1.
**Files:** `src/sim/battle.ts`, `src/sim/gunnery.ts`, `src/audio.ts`, cue data; `src/sim/damage.ts` only if an existing transition cannot be consumed without ambiguity.

**Implementation:** Enrich events with source ID/position/time, weapon family, material and confirmed outcome. Emit AI, rear-gunner and ship muzzle events at the actual producers. Generate and connect weapon banks, airburst/impact layers, sustained damage and torpedo distinctions. Preserve simulated cadence: trim/schedule accepted burst material or use short attack/body/tail regions without layering a whole recorded burst on every projectile. Add world propagation, relative-motion pitch and practical source culling through verified engine mechanisms.

**Verification:** E1 — weapon/outcome routing and time-of-arrival assertions; E2 — fixed scene positions for near/far explosions, AI flyby, player/rear/ship fire, empty release, torpedo entry/dud/hit and persistent fire. Extend existing fixtures before creating a new harness.
**Checkpoint:** Pending. Confirm distant visual events do not produce immediate global sounds.

### Phase 4: Deck detail, remaining aircraft and final listening

**Status:** NOT STARTED
**ACs:** AC-7, AC-8, AC-9, AC-10; reconcile AC-1 across the shipped catalog.
**Files:** `src/audio.ts`, cue data, existing deck-crew rendering only for a needed visible-action cue, `public/assets/audio/`, the consumed manifest, `scripts/check-audio.mjs`; proposed `playtests/audio-realism.playtest.json` and a desktop equivalent using the existing runners.

**Implementation:** Complete the remaining aircraft exterior banks, deck roll/touchdown/wire, conditional local crew/service detail and spatial Pacific ambience. Remove replaced generic release whistle, radio beep, unsupported horn and superseded shipped samples after confirming no callers remain. Finalize effects/speech balance, bounded voices and all lifecycle paths. Record implementation evidence once on the relevant ACs in this PRD or its implementation PR. Request the one named listening check only after executable checks and captures are ready.

**Verification:** E1/E2/E3 once on the final relevant snapshot; E4 owner listening. Retain unresolved target or historical-identity limitations honestly; do not close the PRD while a required behavior or owner listening remains unverified.
**Checkpoint:** Pending.

## Verification commands and observations

Run commands from this game directory. These are future implementation checks, not claims that they were run while writing this document.

| Evidence | Command / flow | Distinct property |
|---|---|---|
| E1 | `node scripts/check-audio.mjs`, after extending it; `pnpm typecheck`; `pnpm exec vite build` | State/routing/lifecycle assertions and build correctness. The current stub test alone does not prove audible output or native parity. |
| E2 | Start `pnpm dev --host 127.0.0.1 --port 5199 --strictPort`; run `bash tools/capture-lock.sh pnpm exec threenative-playtest --scenario playtests/audio-realism.playtest.json --url http://127.0.0.1:5199 --browser-recipe webgpu --headed` after creating that scenario. | Real scene trigger/camera/queue behavior plus captured audio. Use `holdTicks`/`waitTicks`; validate the WebGPU adapter. Playtest pass alone is not an audio recording. |
| E3 | `pnpm build:desktop`; then `pnpm exec threenative-playtest --scenario native-playtests/audio-realism.playtest.json --target desktop --executable dist-native/midway-open-pacific` after creating the native scenario. | Real target decode, playback, spatial/perspective behavior and lifecycle. Capture the output device/audio stream using an available supported mechanism; a screenshot or silent dummy output cannot prove sound. |
| E4 | João listens to one prepared 90-second in-game sequence: deck → cockpit/exterior comparison → R06 with intervening radio → dive/impact → damaged recovery. | Audible realism, variation, useful speech and acceptable mix. Use the same source states for comparisons; external-aircraft tests also include a moving pass. |

Every browser launch, including audio capture setup, uses `tools/capture-lock.sh`; no visible-desktop capture or `xvfb-run`. If an audio capture mechanism is unavailable, record that specific evidence gap rather than treating graph assertions as listening proof. For any engine change, run its required targeted red/green checks plus `pnpm typecheck && pnpm lint && pnpm test`; measure LOC if the charter's kill switch is in question, then repack/reinstall before game validation.

The audio scenario should use repeatable game setup and actual event producers for five short situations: deck/camera/cutoff; observed threat and radio contention; weapon/propagation outcomes; damaged approach/recovery; pause/mute/restart/3× transit. Test a long-lived full battle only for the remaining voice/memory/clipping concern. Capture screenshots only to confirm what scene/listener context was exercised; they cannot establish acoustic quality.

## Open limits and implementation decisions

| Item | Decision now | What resolves it |
|---|---|---|
| Exact Enterprise alarm hardware/cadence and spoken wording | Use an explicitly reconstructed electromechanical candidate; no “authentic CV-6 recording” claim. | A dated CV-6 document/recording or attributable specialist evidence. |
| Aircraft hardware detail beyond museum records | Do not assert exact starter, stall-warning, radio-set or actuator character from a model name alone. | Applicable SBD/TBD/F4F manuals during the owning sound pass; otherwise retain reconstruction labels and omit false hardware claims. |
| Native filtering/detune/output capture | Existing limitations are known; baked perspectives avoid some DSP requirements but do not prove the rest. | Phase 1 real desktop consumer test and engine-owned fix where required. |
| Exact dialogue variation count | Generate only reachable full-sentence variants and repeat-sensitive SFX takes; keep the supplied script text deterministic. | Asset manifest assembled from actual consumers before the production batch. |
| Histories versus generated game outcomes | Reports follow observed gameplay; historical time/place facts remain source-tagged reference material. | Tests that prevent historical scripts from announcing attacks, sinking, rescue or diversion that did not occur. |

## Implementation notes

Implementation has begun under this PRD (the plan above is no longer unexecuted). What landed:

- `tools/audio-catalog.mjs` transcribes every exact PRD prompt; `tools/audio-generate.mjs` calls the
  ElevenLabs API, converts MP3→Ogg Vorbis with ffmpeg, and maintains the single machine-consumed
  manifest `content/audio/midway-audio.json` (request text, model, duration, loop flag, voice ID,
  source/output SHA-256). No prose ledger.
- The 24-row engine bank, all 43 non-conditional named SFX, the `control` voice and `R06` are
  generated and packaged under `public/assets/audio/`. The seven conditional rows remain
  ungenerated until their listed consumer exists.
- **Verified deviation:** the ElevenLabs sound endpoint rejects text over 450 characters (HTTP 400
  `text_too_long`), and every engine-bank row with the PRD's full template plus suffix reached
  636–739 characters. The trailing template sentence is therefore folded into a compact
  `ENGINE_LOOP_SUFFIX` ("Seamless loop, no fade, no flyby. Engine only."); engine identity, state
  and perspective stay verbatim. Every named prompt keeps the exact full suffix and fits under 450.
- `src/audio.ts` now owns no WebAudio graph: buffers arrive through `ctx.assets.audio` and play
  through the engine `AudioBus` (supplied by `Midway.enter`). Exterior/interior engine layers
  cross-fade over ~150 ms, wind follows IAS, buffeting replaces the stall horn, and deck roll,
  machinery and hull wash are driven from deck contact.
- `scripts/check-audio.mjs` covers packaged-file presence, single layer start, perspective cross-fade,
  airspeed wind, cutoff windmill, deck roll, cooldowns, positional cues, mute/pause suppression and
  dispose. `bash tools/run-handoff.sh` is green (9 passed, 0 failed).

Open: the radio speech queue (Phase 2), event enrichment and weapon banks (Phase 3), the remaining
aircraft/deck/Pacific production, native desktop proof and the owner listening sequence (Phase 4).

## Planning verification

At the time this document was written only the PRD existed. Source/API references and real integration locations were researched; no SFX, voices, gameplay code or engine packages were generated or modified by the planning task itself. Document checks passed: two JSON request examples parse; four phases, ten unique unchecked ACs, 30 unique speech IDs and 50 unique SFX IDs; every specified SFX duration is within the documented API range; local Markdown links resolve. Self-review checked historical/reconstruction labels and consumer/trigger alignment. The implementation notes above record what later landed; the implementation ACs remain unchecked and phases 2–4 remain NOT STARTED.
