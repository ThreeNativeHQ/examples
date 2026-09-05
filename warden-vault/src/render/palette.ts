// The vault's colours, read off reference.png. Ordinary data — ThreeNative does not read this
// file. Keep the roles coherent when you change them: the room is a dark cool box, the crates are
// the only warm mass in it, and exactly two things emit — the lanterns (orange) and the seal
// (cyan). That two-source split is what the reference picture is made of.
export const palette = {
  /** Beyond the walls. Almost black, faintly blue. */
  void: 0x0a0e16,
  /** The flagstone floor. */
  floor: 0x3d4a5e,
  /** The seams between flagstones — one step darker, never black. */
  floorSeam: 0x1c2331,
  /** The plaster band the lantern light lands on. */
  wall: 0xb08a4e,
  /** The dark plinth under it and the skirting at the floor. */
  wallBase: 0x2b3242,
  /** Pillars, capping rail, lantern housings. */
  timber: 0x6b4a32,
  /** The kerb the seal is set into: cut stone, not timber, and never emissive. */
  sealStone: 0x55606f,
  /** The diamond insets and rail highlights. */
  timberLight: 0x8f6742,
  /** Crate one: burnt orange. */
  crateRed: 0xc35a3a,
  /** Crate two: sea teal. */
  crateTeal: 0x3d7f78,
  /** Crate three: amber. */
  crateAmber: 0xd39a3d,
  /** The plank braces nailed across every crate face. */
  crateBrace: 0x4c3320,
  /** The phase crates the warden walks through, and the seal in the floor. */
  phase: 0x2fd2f0,
  /** Lantern flame. */
  lantern: 0xff9a3c,
  /** The warden. Unpainted, matte, the lightest thing in the room. */
  warden: 0xefe7d6,
  /** Hanging banners on the east wall. */
  banner: 0x1d3a5c,
} as const;
