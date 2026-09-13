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
