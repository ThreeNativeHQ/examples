#!/usr/bin/env python3
"""Generate wildwood's sound with the ElevenLabs sound-effects endpoint.

The key is read from the environment and never written anywhere. Raw mp3 lands in RAW_DIR;
encoding to shipping Ogg Vorbis is a separate step so a re-encode never costs another generation.
"""
import json
import os
import sys
import time
import urllib.error
import urllib.request

KEY = os.environ.get("ELEVENLABS_API_KEY", "")
if not KEY:
    sys.exit("ELEVENLABS_API_KEY missing from the environment")

RAW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "raw")
os.makedirs(RAW, exist_ok=True)

URL = "https://api.elevenlabs.io/v1/sound-generation"

FOREST = (
    "Calm temperate pine forest ambience, late morning. Steady wind moving through high conifer "
    "branches, soft needle rustle, a few distant songbirds, an occasional slow wooden creak of a "
    "swaying trunk. Natural outdoor field recording. No music, no human voices, no footsteps."
)
LAKE = (
    "Gentle freshwater lake shoreline. Small ripples lapping on wet pebbles and reeds, quiet and "
    "close. No waves, no wind, no birds, no music."
)
CHIME = (
    "A single warm discovery chime: soft struck wooden resonance with a brief airy shimmer tail, "
    "gentle and calm, one hit only. No music bed, no drums."
)

STEPS = {
    "grass": "One single footstep on soft damp meadow grass. Close, dry, no reverb, no music.",
    "dirt": "One single footstep on a dry packed dirt trail, small grit. Close, dry, no reverb, no music.",
    "rock": "One single footstep on bare rock and loose gravel. Close, dry, no reverb, no music.",
    "leaf": "One single footstep crunching dry fallen leaf litter. Close, crisp, no reverb, no music.",
    "water": "One single footstep splashing through shallow water. Close, wet, no reverb, no music.",
}

# The six animals, keyed to what their clips actually do rather than to what their state is
# called. `animalSpecs.ts` is the authority: the wolf's "graze" clip is ANIM_Wolf_Howl, so the
# wolf's graze sound is a howl; the fox's is ANIM_Fox_IdleLookAround, which is not eating, so the
# fox gets no chewing loop at all. Getting this from the clip map instead of the state name is the
# whole difference between sound that matches the animation and sound that contradicts it.
VOICES = {
    "voice-fox": "A single red fox call: one short sharp raspy scream-bark, wild and thin, outdoors at night. One call only. Dry and close, no reverb, no music, no people.",
    "voice-wolf": "A single grey wolf howl: one long howl rising then falling away, lonely and clear, alone in a forest. One howl only. No pack answering, no music, no people.",
    "voice-stag": "A single red deer stag bellow in the rut: one deep guttural hoarse roaring call, resonant and rough. One call only. Outdoors, dry, no music, no people.",
    "voice-doe": "A single female deer bleat: one short soft nasal breathy call, gentle and quiet. One call only. Dry and close, no music, no people.",
    "voice-pig": "A single wild boar snort: one short wet nasal snort followed by a low grunt. Close, dry, no squealing, no music, no people.",
    "voice-crow": "A single crow caw: one harsh short rasping caw, dry and clear, outdoors. One caw only. No flock, no music, no people.",
}

# Continuous, looped, and only ever heard close up.
FEEDING = {
    "graze-ungulate": "A deer grazing close by: teeth tearing at grass and slow wet chewing, continuous and quiet. No footsteps, no birds, no music, no people.",
    "graze-pig": "A pig snuffling in soil: wet nasal snuffles and slow chewing, continuous and close. No squealing, no music, no people.",
    "graze-crow": "A crow pecking at hard bare ground: light sharp beak taps on soil and grit with pauses between them, close and dry. No music, no people.",
}

# Footfalls, grouped by foot rather than by species: a hoof is a hoof.
FEET = {
    "step-hoof": "One single deer hoof step on a soft forest floor: a dull muffled hoof fall on leaves and soil. Close, dry, one step only, no music.",
    "step-paw": "One single soft paw step of a fox on leaf litter: a very light padded footfall. Close, dry, one step only, no music.",
    "step-trotter": "One single pig trotter step on damp soil: a small dull thud with a faint squelch. Close, dry, one step only, no music.",
}

WING = "A crow taking off: one short burst of three heavy wing flaps beating the air, feathers and air movement. Close, dry, no calls, no music."

JOBS = [("forest-bed", FOREST, 22.0, True, 0.35), ("lake-shore", LAKE, 12.0, True, 0.4),
        ("landmark-found", CHIME, 3.0, False, 0.45)]
# Voices are one-shots; the howl and the bellow need longer than a caw does.
for name, prompt in VOICES.items():
    seconds = {"voice-wolf": 3.5, "voice-stag": 2.5, "voice-crow": 1.2}.get(name, 1.8)
    JOBS.append((name, prompt, seconds, False, 0.55))
for name, prompt in FEEDING.items():
    JOBS.append((name, prompt, 5.0, True, 0.45))
for name, prompt in FEET.items():
    for variant in range(1, 3):
        JOBS.append((f"{name}-{variant}", prompt, 0.5, False, 0.55))
JOBS.append(("wing-crow", WING, 1.5, False, 0.5))
for surface, prompt in STEPS.items():
    for variant in range(1, 4):
        JOBS.append((f"step-{surface}-{variant}", prompt, 0.5, False, 0.55))


def generate(name: str, text: str, seconds: float, loop: bool, influence: float) -> None:
    out = os.path.join(RAW, f"{name}.mp3")
    if os.path.exists(out) and os.path.getsize(out) > 1024:
        print(f"skip {name} (already generated, {os.path.getsize(out)} bytes)", flush=True)
        return
    body = json.dumps({
        "text": text,
        "duration_seconds": seconds,
        "loop": loop,
        "prompt_influence": influence,
        "model_id": "eleven_text_to_sound_v2",
        "output_format": "mp3_44100_128",
    }).encode()
    request = urllib.request.Request(
        URL, data=body,
        headers={"xi-api-key": KEY, "Content-Type": "application/json"},
    )
    for attempt in range(3):
        try:
            with urllib.request.urlopen(request, timeout=180) as response:
                payload = response.read()
            break
        except urllib.error.HTTPError as error:
            detail = error.read()[:300].decode("utf8", "replace")
            print(f"FAIL {name}: HTTP {error.code} {detail}", flush=True)
            if error.code < 500 or attempt == 2:
                return
            time.sleep(5)
        except Exception as error:  # noqa: BLE001 - transport flake, retried
            print(f"retry {name}: {error}", flush=True)
            if attempt == 2:
                return
            time.sleep(5)
    with open(out, "wb") as handle:
        handle.write(payload)
    print(f"ok   {name}: {len(payload)} bytes", flush=True)


for job in JOBS:
    generate(*job)
print("GENERATION DONE", flush=True)
