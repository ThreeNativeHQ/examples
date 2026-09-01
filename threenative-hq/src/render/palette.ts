// Generated for you. Keep the six palette roles coherent when you change the look.
//
// Read off the reference frames: a warm corporate interior at dusk. Cream carpet, tan walls,
// dark wood slats, near-black furniture, and cold blue only where the glass is — the contrast
// between the warm room and the cold window is what makes the floor read as lit from inside.
export const palette = {
  skyHigh: 0x2a3d55,
  skyLow: 0x141d29,
  floor: 0xe4d8c1,
  player: 0xb9b2a6,
  crate: 0x8a5a32,
  accent: 0xffcf94,
} as const;

/** The office's own surfaces. `palette` keeps the six roles the template's helpers read. */
export const office = {
  carpet: 0xece2cd,
  carpetTrim: 0xd2c1a2,
  ceiling: 0xfaf3e6,
  wallTan: 0xd9c9ab,
  slatDark: 0x53381f,
  slatLight: 0x8a5a32,
  columnLight: 0xe6dcc6,
  columnDark: 0x6b4a2f,
  deskTop: 0x8f6237,
  deskFrame: 0x2f2a26,
  divider: 0xa2947a,
  seat: 0x2b2724,
  screenOff: 0x14161a,
  glass: 0x3b5375,
  strip: 0xffeacb,
  sofa: 0x4c3b31,
  cushion: 0x3a312c,
  shelf: 0x8f6237,
  keyCase: 0x2a2724,
  keyCapLight: 0xbdb2a0,
  keyCapDark: 0x4f4a43,
} as const;

/** One accent per agent host, so a glance at the floor says who is running what. */
export const hostTint = {
  claude: 0xd97757,
  codex: 0x6fb3d2,
  unknown: 0x9a938a,
} as const;
