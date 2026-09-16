# Asset provenance — midway-missing-models

These are the supplied source models for PRD-midway-asset-battle-integration. The originals are
preserved unmodified in `/home/joao/Downloads/midway-missing-models`; game-ready derivatives live
in `public/assets/`. Every figure below was read from the files on disk at the source path; nothing
is estimated.

## GLB source files

Sorted by path relative to the source directory. `Bytes` is the on-disk size, `SHA-256` is the full
64-character digest, `Generator` is the glTF `asset.generator` field, and `Raw XYZ bounds` is the
axis-aligned box reported by `tools/inspect-glb.mjs` before any rescale.

| File | Bytes | SHA-256 | Generator | Triangles | Meshes/Materials/Images | Raw XYZ bounds | Animation clips |
| --- | ---: | --- | --- | ---: | --- | --- | --- |
| `aircrafts/Douglas+TBD-1+Devastator.glb` | 62732328 | `5a34e311560b4a499becdfc7195f505e45fb50f19cd3c950467ebb7f4bc2fc80` | Tripo | 1915063 | 1/1/3 | 0.75 x 0.27 x 0.98 | none |
| `aircrafts/Nakajima+B5N2+Kate+Torpedo+Bomber.glb` | 2573340 | `5c9cd0b4b0594cc97a6e9e4705179fb0a563195591025d05cdb3d19005bb2950` | Tripo | 9793 | 1/1/3 | 0.92 x 0.37 x 0.98 | none |
| `carriers/japan-kaga.glb` | 3585712 | `f8157c4b810f1739950a7d66805329cc45cb8495de898b92acfd1b23a9ae2178` | Tripo | 45683 | 1/1/3 | 0.55 x 0.53 x 0.98 | none |
| `carriers/japan-kyriu.glb` | 3505832 | `1520303a2c040c9b799595b8551f0ff04ef28a580140e9f4fdd031d5b51cdf95` | Tripo | 23421 | 1/1/3 | 0.21 x 0.35 x 0.98 | none |
| `carriers/japan-soryu.glb` | 3254628 | `d34168769819abb43be94804003be10bbddc6c87dfbfb57a5540508d90e24b6f` | Tripo | 23605 | 1/1/3 | 0.49 x 0.52 x 0.98 | none |
| `carriers/uss-yorktown.glb` | 63644844 | `dd1db981ea47a5cef9869c8eb521f1d5d28118a6e57685788be527666f8ac712` | Tripo | 1875769 | 1/1/3 | 0.25 x 0.39 x 0.98 | none |
| `cruiser/mogami-class-cruiser.glb` | 4200676 | `0f57ef7e9740872964754bab1b5ae3fa04530a1cd626baafcaccff8ecb8c2992` | Tripo | 47991 | 1/1/3 | 0.97 x 0.57 x 0.98 | none |
| `cruiser/tone-class-cruiser.glb` | 4200676 | `0f57ef7e9740872964754bab1b5ae3fa04530a1cd626baafcaccff8ecb8c2992` | Tripo | 47991 | 1/1/3 | 0.97 x 0.57 x 0.98 | none |
| `destroyers/japan-mikuma-and-mogami.glb` | 3545224 | `882f14114090c0df4601a58f89c422bf723ba9bf5ac0b85b760834c95525f44d` | Tripo | 22650 | 1/1/3 | 0.15 x 0.33 x 0.98 | none |
| `destroyers/torpedo+3d+model.glb` | 2912984 | `7fc4cc6127f41729b45d92eae423a5f6dbadc4d0012ecf69ed44ff9a2317b63c` | Tripo | 24856 | 1/1/3 | 0.99 x 0.15 x 0.15 | none |
| `destroyers/uss-harmann.glb` | 3732792 | `fc329841741b897e258d10cbd293135ea34f0c7267b45775592275f86e8a074e` | Tripo | 22887 | 1/1/3 | 0.15 x 0.38 x 0.98 | none |
| `submarines/japan-I168-submarine.glb` | 3441072 | `3ed26ed8ee03f074dd705ef96feaaffeba770d074c8696fbe585739c7dbdfb9e` | Tripo | 23243 | 1/1/3 | 0.98 x 0.55 x 0.76 | none |
| `submarines/uss-nautilus.glb` | 3606080 | `f39a975336cfb5d6e89b2d98e14c84055f6dfa1c49573f0fff4db6127f246b4f` | Tripo | 22967 | 1/1/3 | 0.13 x 0.34 x 0.98 | none |

## PNG source files

Sorted by path relative to the source directory.

| File | Bytes | SHA-256 | Role |
| --- | ---: | --- | --- |
| `aircrafts/Douglas TBD-1 Devastator.png` | 1688377 | `1c912a18ca9e27ee339e0fffc5db8dc4910315a4d546f831345db5ed9fa84790` | visual reference only, not a game entity |
| `aircrafts/Nakajima B5N2 “Kate”.png` | 1986236 | `1e674b345bee5ca5fb73cfd83e6d7ee08a3c05e045149399afdec329010f165d` | visual reference only, not a game entity |
| `cruiser/Mogami-class cruiser.png` | 1926118 | `3c543425f439baf961610ee59283e86348badaa3b1b42e9f1e0efb4173aa177e` | visual reference only, not a game entity |
| `cruiser/tone-class-cruiser.png` | 1505089 | `33a2b1b1a6aa80d8ae0466ee76743f4e9231c19d170ccf7c24af3cc423b518cb` | visual reference only, not a game entity |
| `destroyers/japan-mikuma.png` | 1422260 | `2d47e8e4ef319dc7ed81fbb9c62749226322c8899b47a471188e198e98fdb247` | visual reference only, not a game entity |
| `destroyers/kagero-family-destroyer.png` | 1612687 | `0a42cb511f96e43a2179cc704d3bd644cc12743e55bb8bcd1f9e9bacb0c6618f` | visual reference only, not a game entity |
| `destroyers/uss-harman.png` | 1521133 | `cb5fecf46a91978916db0a510e5e448fac5d7b502e2e13b9b4dc6700beb6c5c7` | visual reference only, not a game entity |
| `torpedo.png` | 1205352 | `bf4b1eece6c2253beec2d0b93a4bc266624321e38e58ab44843eb73e83bb95e4` | visual reference only, not a game entity |

### Duplicates

`cruiser/mogami-class-cruiser.glb` and `cruiser/tone-class-cruiser.glb` share the SHA-256
`0f57ef7e9740872964754bab1b5ae3fa04530a1cd626baafcaccff8ecb8c2992` byte for byte. They are one
shared source file present under two names, not two distinct models. Any derivative should be built
once and referenced from both names rather than treated as separate assets.

### Rights

No license document was supplied with these files. The `generator` tag records the tool that produced the mesh; it does not establish distribution rights. Rights are UNVERIFIED. Public distribution of this repository's built game requires recording the actual rights for every row above before release.

## Additional user-supplied assets (asset polish delivery)

The pilot/director use their measured source shape and CC0 Quaternius UAL idle/walk/talking
clips fitted by `rig_humanoid.py`; the replacement sailor retains the existing six crew clips.
The Douglas rear radioman/gunner is the same pilot rig on the UAL1 `Sitting_Idle_Loop` clip
(`sit`), from the same CC0 Quaternius Universal Animation Library
(https://quaternius.itch.io/universal-animation-library, `Sitting_Idle_Loop.glb`,
SHA-256 `4d045aed897a4c44e82eb8a63756b6308f9ec0d315d0321d278c54f7ece54f0a`, CC0).
The PT-59 preserves all 156,663 triangles and converts legacy spec/gloss materials to supported
metal/rough PBR, then WebP. It has no source animation. The new models' distribution rights
remain unverified, as with the supplied files above. Downloads were not modified.

| Source | SHA-256 | Shipped derivative |
| --- | --- | --- |
| `/home/joao/Downloads/midway-missing-models/carrier-aircraft-pilot.glb` | `e65ddc4c5c9c83812c3fd1405fb0243b10425a55b43792c80776610c84104cc8` | `carrier-aircraft-pilot.glb` |
| `/home/joao/Downloads/midway-missing-models/flight-deck-director.glb` | `3e73e9cb5d532e57b477562dabdbc7990e06de9527bb9607eff21ddc4b8d1132` | `flight-deck-director.glb` |
| `/home/joao/Downloads/navy sailor 3d.glb` | `9c75e28a73b8afbe50964bdaa5fa0e27648cdaef5a8c771eee2b8394627aa743` | `deck-crew.glb` |
| `/home/joao/Downloads/us_elco_77_ft_pt-59_war_thunder.glb` | `00d2135aa605e2a35df875b04c1744ac3afe1a1fbf3ee26b8dfc37783aa3675a` | `boat.pt59.glb` |

## Shipped derivatives

Every shipped GLB under `public/assets/`, sorted by path. `Bytes` and `SHA-256` are the on-disk size
and the full 64-character digest of the shipped bytes. `Size XYZ` and `min.y` are metres from
`node tools/inspect-glb.mjs`; `min.y` is the lowest vertex in the shipped mesh. `Triangles` is the
shipped count. Source paths below are shortened by these prefixes:

| Prefix | Directory |
| --- | --- |
| `MM/` | `/home/joao/Downloads/midway-missing-models/` |
| `BP/` | `/home/joao/projects/threejs-to-bevy/examples/battle-of-pacific/` |
| `DL/` | `/home/joao/Downloads/` |

Hulls are scaled **uniformly**: one scalar applied to all three axes, set by length. `beam` and
`height` in `tools/blender/fleet.json` are historical reference metadata; the mesh is never bent to
fit them. The fleet import puts the keel on `y = 0`, so those hulls report `min.y = 0.00`; the three
supplied carriers keep the supplied waterline and dip below zero.

`cruiser.mogami.glb` is **derived**, not supplied: the supplied `cruiser/mogami-class-cruiser.glb`
is byte-identical to `cruiser/tone-class-cruiser.glb`, and `tools/blender/derive-mogami.py` copies
the after pair of forward turrets and mirrors them onto the quarterdeck. It moves vertices; it
scales nothing.

The shipped derivatives inherit the source rights above; rights remain UNVERIFIED.

| Shipped file | Bytes | SHA-256 | Source | Size XYZ (m) | min.y | Triangles | Produced by |
| --- | ---: | --- | --- | --- | ---: | ---: | --- |
| `aircraft.b5n2-kate.glb` | 1375712 | `c8caf55bdad5c8e17ef4807e6e40b48cf42a2ad3d2e9640388c3555e352a92e9` | `MM/aircrafts/Nakajima+B5N2+Kate+Torpedo+Bomber.glb` | 15.52 x 4.93 x 12.17 | 0.00 | 12653 | `bash tools/import-aircraft.sh aircraft.b5n2-kate` |
| `aircraft.douglas-sbd3.glb` | 13489304 | `ffc23008182ef13a631dca9c255c1860c3271b6a3453ec253c324e7a12587d75` | `BP/assets/generated/aircraft.douglas-sbd3.glb` | 2.00 x 0.62 x 1.58 | -0.31 | 10416 | Supplied ready-made; no committed rebuild script (shipped bytes differ from that source) |
| `aircraft.mitsubishi-a6m3.glb` | 991908 | `40eebfe3aead559a7a513b7ca197aa9bfdd5b16c8205cccc1a00d8bf6d272b5c` | `BP/assets/generated/aircraft.mitsubishi-a6m3.glb` | 11.13 x 3.33 x 9.04 | -1.67 | 14540 | Copied byte-identical from the supplied project asset |
| `aircraft.tbd-devastator.ai.glb` | 9709080 | `004c819e4f2f4e2ebaefccb1c2c66a94bbadfb674e31487d9b71a908e15e915b` | `MM/aircrafts/Douglas+TBD-1+Devastator.glb` | 15.24 x 4.59 x 11.72 | -0.00 | 186403 | `bash tools/import-aircraft.sh aircraft.tbd-devastator.ai` |
| `aircraft.tbd-devastator.glb` | 12990788 | `dae6ee34f4e849011f16ebf949001bf4d5945b6c54b2c91207b43a2f321f915d` | `MM/aircrafts/Douglas+TBD-1+Devastator.glb` | 15.24 x 4.59 x 11.72 | -0.00 | 274771 | `bash tools/import-aircraft.sh aircraft.tbd-devastator` |
| `akagi.glb` | 27586032 | `6f63d2376866c08eca9c90bf877eaf66f05ee556c19faae727918413978da893` | `DL/ijn_aircraft_carrier_akagi_1942.glb` | 44.35 x 46.82 x 260.67 | -7.55 | 246563 | Blender MCP export of the supplied original; no committed script |
| `b25-mitchell.glb` | 2961056 | `aee8265ab0b5ba0254c317e96306dd0305bfbd07824857af36aeae8f2cd1dad7` | `DL/u.s._navy_aircraft_carrier_uss_hornetcv-8.glb` | 20.98 x 5.04 x 17.97 | -0.00 | 25910 | Blender MCP extraction of one specimen from the Hornet export; no committed script |
| `boat.pt59.glb` | 15937732 | `f9f435a45c60ef4b9a128135d7c064db13696b8be6371e397ec626439eaee04c` | `DL/us_elco_77_ft_pt-59_war_thunder.glb` | 6.83 x 7.30 x 23.66 | -1.24 | 156663 | `bash tools/import-pt59.sh` |
| `carrier-aircraft-pilot.glb` | 2066676 | `5c49a3a406151d198c8077d93bd6d30c77e69632c50ead41d79775f41ca1e609` | `MM/carrier-aircraft-pilot.glb` | 1.68 x 1.78 x 0.36 | -0.00 | 9832 | `bash tools/import-people.sh` |
| `carrier.hiryu.glb` | 2021532 | `57aafa20a0825090f534ec46aa2f726f2e01ef4dd4ed8b1282554c9e66f72499` | `MM/carriers/japan-kyriu.glb` | 41.47 x 40.00 x 227.40 | 0.00 | 23421 | `bash tools/import-fleet.sh carrier.hiryu` |
| `carrier.kaga.glb` | 2291676 | `32c09203a5e816ff253be1d05257e4b3448ce72e2e243359c51f4456c7fbf6c3` | `MM/carriers/japan-kaga.glb` | 53.93 x 46.80 x 247.65 | 0.00 | 45683 | `bash tools/import-fleet.sh carrier.kaga` |
| `carrier.soryu.glb` | 1842532 | `ea4d615435853574a40e841e73cc83b0bb0c839c36c6eff479177d5149354381` | `MM/carriers/japan-soryu.glb` | 36.35 x 40.00 x 227.50 | 0.00 | 23605 | `bash tools/import-fleet.sh carrier.soryu` |
| `carrier.yorktown.glb` | 13223756 | `635aa852f0a2b35f458f0d0af2f54fe17d7db23b87cd1217d634cbd675a9f351` | `MM/carriers/uss-yorktown.glb` | 32.79 x 48.02 x 246.79 | 0.00 | 199999 | `bash tools/import-fleet.sh carrier.yorktown` (weld, then simplify `--ratio .11 --error .0001 --lock-border true`). Retained and measured, but **not** what CV-5 is drawn from: its superstructure is a centreline block with no deck corridor, so the game draws her from `hornet.glb` (`src/render/imported-ships.ts`). |
| `cruiser.mogami.glb` | 2870932 | `4f83bc27631969c1701068a6ece2e5146749743cf8bae20b4ff6712f57ca5a8e` | Derived from `MM/cruiser/mogami-class-cruiser.glb` (byte-identical to `MM/cruiser/tone-class-cruiser.glb`) | 22.13 x 38.00 x 201.60 | 0.00 | 51311 | `bash tools/import-fleet.sh cruiser.mogami` (runs `tools/blender/derive-mogami.py` on the aligned Tone hull) |
| `cruiser.tone.glb` | 2748776 | `aa499caf36f16882d500277c5c15ad4ddafb3a453a9ca23d93c05a2b9802f07b` | `MM/cruiser/tone-class-cruiser.glb` | 22.13 x 38.00 x 201.60 | 0.00 | 47991 | `bash tools/import-fleet.sh cruiser.tone` |
| `deck-crew.glb` | 3119900 | `2e1286abe87f1df07e81ee07d20d6dea141d98c24d21840f8889b681058d4feb` | `DL/navy sailor 3d.glb` | 1.67 x 1.83 x 0.34 | -0.00 | 38992 | `bash tools/import-people.sh` |
| `destroyer.hammann.glb` | 2151720 | `cf72efe407de6b8fadf35a29ce9029d88d3c7b9904a66b8462804dc362bb1d09` | `MM/destroyers/uss-harmann.glb` | 20.14 x 28.00 x 106.17 | 0.00 | 22887 | `bash tools/import-fleet.sh destroyer.hammann` |
| `destroyer.kagero.glb` | 2076424 | `a74536965a598feb92b5ce69365eac7e7b2f901fab401583d94812faa3f767a0` | `MM/destroyers/japan-mikuma-and-mogami.glb` | 12.43 x 28.00 x 118.50 | 0.00 | 22650 | `bash tools/import-fleet.sh destroyer.kagero` |
| `destroyer.samidare.glb` | 11446096 | `5aa13d521b808c0c945ea11f3c86e46bd4e7d5d464abde64f17f56d3b4814617` | `BP/assets/generated/enemy.samidare.optimized.glb` | 145.34 x 31.49 x 14.58 | -4.93 | 26032 | Copied byte-identical from the supplied project asset |
| `enterprise.glb` | 3978672 | `cf4e2aad674c54c952259e02b220e27c5e869f69be52379e83856d443c8dc7d7` | `DL/uss_enterprise_cvn-80_aircraft_carrier.glb` | 97.93 x 76.66 x 337.00 | -11.77 | 32209 | Blender MCP export of the supplied original; no committed script |
| `flight-deck-director.glb` | 1884056 | `82f111b9799db0cecb9389a56906efce15671607793434b7a54c641c38fb9250` | `MM/flight-deck-director.glb` | 1.61 x 1.80 x 0.35 | -0.00 | 9632 | `bash tools/import-people.sh` |
| `hornet.glb` | 26767784 | `209e5923d4398d33e8e4daca17bafc8ca54fcca11169ab1cab2b6ba5faa0abe9` | `DL/u.s._navy_aircraft_carrier_uss_hornetcv-8.glb` | 40.13 x 54.41 x 251.40 | -4.14 | 347281 | Blender MCP export removing the nine parked B-25s; no committed script |
| `midway-atoll.glb` | 10776812 | `18d41ecc417e42d8b06920a5476be8ad44fac07caf2cbcc9d1c0cdce512e38ba` | `BP/assets/imported/geography/midway-atol.glb` | 2.00 x 0.10 x 1.49 | -0.05 | 9768 | Copied byte-identical from the supplied project asset |
| `structures.garrison-camp.glb` | 3549464 | `170c611a7f105fa90d82d7c1f90caf5619b0a78be02181593e5fe3f8fa62c16d` | `BP/assets/generated/structures.garrison-camp.glb` | 43.00 x 15.23 x 38.23 | -2.18 | 1182 | Copied byte-identical from the supplied project asset |
| `structures.radar-station.glb` | 2795384 | `3e9d1424b7fc5405ea7c1f7110d9ccfbecd3acd6c9dd504a10ee48128f35d5e4` | `BP/assets/generated/structures.radar-station.glb` | 19.84 x 18.37 x 14.85 | -0.10 | 514 | Copied byte-identical from the supplied project asset |
| `submarine.i168.glb` | 1948264 | `6e22236ae71a65d29dd2c8f984a9bf804cb879bba783fa43578e33d2f95ebdd8` | `MM/submarines/japan-I168-submarine.glb` | 9.22 x 13.50 x 104.70 | 0.00 | 23243 | `bash tools/import-fleet.sh submarine.i168` |
| `submarine.nautilus.glb` | 2068392 | `37dcba590db1b79b1849192d871b0008540d14ccba843a0b78f90f0303e22388` | `MM/submarines/uss-nautilus.glb` | 12.61 x 15.00 x 113.08 | 0.00 | 22967 | `bash tools/import-fleet.sh submarine.nautilus` |
| `weapon.torpedo.glb` | 1683296 | `195a9f90fcdbb710baa35a1431f432cec3475468ecf70c8c5a1a9d0734c038ff` | `MM/destroyers/torpedo+3d+model.glb` | 0.64 x 0.60 x 4.09 | 0.00 | 24856 | `bash tools/import-fleet.sh weapon.torpedo` |
