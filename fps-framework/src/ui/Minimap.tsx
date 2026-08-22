import type { Blip } from "../state.js";

// Schematic extents come from docs/bayview-design.md: the playable deck is an
// 84 m square centred on the origin, open sea east of x = +42, B site on the
// waterfront. One SVG unit is one metre. North (-z) points up, east (+x) right,
// so a world point lands at SVG (x, z) directly — +z (south) draws downward.
type Rect = readonly [number, number, number, number]; // x, z, width, depth (metres)

// Walkable lanes, courtyards and plazas; the gaps between them are buildings.
const AREAS: readonly Rect[] = [
  [-2, -40, 18, 10], // CT spawn
  [-18, -36, 10, 12], // CT ramp
  [-8, -8, 18, 16], // mid
  [10, 0, 6, 10], // connector
  [16, -20, 16, 24], // B site
  [-36, -8, 16, 18], // A site
  [-20, 4, 8, 14], // short A
  [-12, 12, 10, 14], // T main
  [-9, 26, 18, 12], // T spawn
  [32, 4, 10, 26], // outside long
];

// Raised decks, drawn dashed gold: back plat y=2.4, heaven y=4.8, catwalk y=2.4.
const RAISED: readonly Rect[] = [
  [0, -22, 12, 12], // back plat
  [20, -30, 10, 10], // heaven
  [22, -16, 6, 14], // catwalk
];

const VIEW_CONE_RADIUS = 26; // metres
const VIEW_CONE_HALF_ANGLE = Math.PI / 6; // 30 deg each side of facing
const DOT_CLAMP = 45; // metres from centre; keeps dots just inside the disc rim

function AreaRect({ rect, raised }: { rect: Rect; raised?: boolean }) {
  const [x, z, width, depth] = rect;
  return (
    <rect
      x={x}
      y={z}
      width={width}
      height={depth}
      fill={raised ? "none" : "#ffffff"}
      fillOpacity={raised ? 0 : 0.05}
      stroke={raised ? "#ffd166" : "#ffffff"}
      strokeOpacity={raised ? 0.6 : 0.22}
      strokeDasharray={raised ? "3 2" : undefined}
      vectorEffect="non-scaling-stroke"
    />
  );
}

export function Minimap({
  playerX,
  playerZ,
  playerYaw,
  blips,
}: {
  playerX: number;
  playerZ: number;
  playerYaw: number;
  blips: readonly Blip[];
}) {
  // yaw=0 faces -z (map up); forward matches FpsPlayer: (-sin yaw, -cos yaw).
  // Expressed as an SVG-screen angle for the view cone.
  const facing = Math.atan2(-Math.cos(playerYaw), -Math.sin(playerYaw));
  const coneEdge = (angle: number) => {
    const ex = playerX + VIEW_CONE_RADIUS * Math.cos(angle);
    const ez = playerZ + VIEW_CONE_RADIUS * Math.sin(angle);
    return `${ex.toFixed(1)} ${ez.toFixed(1)}`;
  };

  return (
    <div className="pointer-events-none absolute left-4 top-4 h-[180px] w-[180px] rounded-full bg-black/55 shadow-[0_2px_12px_rgba(0,0,0,0.45)] ring-1 ring-[#ffa63d]/40">
      <svg viewBox="-50 -50 100 100" className="absolute inset-0 h-full w-full">
        <defs>
          <clipPath id="bayview-map-disc">
            <circle cx="0" cy="0" r="49" />
          </clipPath>
        </defs>
        <g clipPath="url(#bayview-map-disc)">
          {/* Sea east of the deck edge, and the dock pier reaching into it. */}
          <rect x={42} y={-50} width={8} height={100} fill="#5b93b8" opacity={0.35} />
          <line
            x1={36}
            y1={-8}
            x2={57}
            y2={-14}
            stroke="#c9a06a"
            strokeOpacity={0.75}
            strokeWidth={1.6}
            strokeLinecap="round"
          />

          {/* Deck outline, lanes and plazas, raised decks, site letters. */}
          <rect
            x={-42}
            y={-42}
            width={84}
            height={84}
            fill="#ffffff"
            fillOpacity={0.04}
            stroke="#ffffff"
            strokeOpacity={0.3}
            vectorEffect="non-scaling-stroke"
          />
          {AREAS.map((rect) => (
            <AreaRect key={rect.join(",")} rect={rect} />
          ))}
          {RAISED.map((rect) => (
            <AreaRect key={rect.join(",")} rect={rect} raised />
          ))}
          <text x={-28} y={1} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill="#ffb84d">
            A
          </text>
          <text x={24} y={-8} textAnchor="middle" dominantBaseline="central" fontSize={9} fontWeight={700} fill="#ffb84d">
            B
          </text>
          <text x={1} y={13} textAnchor="middle" dominantBaseline="central" fontSize={5.4} fontWeight={600} fill="#ffd166" fillOpacity={0.85}>
            Mid
          </text>

          {/* Facing cone, live enemy dots, player dot on top. */}
          <path
            d={`M ${playerX.toFixed(1)} ${playerZ.toFixed(1)} L ${coneEdge(facing - VIEW_CONE_HALF_ANGLE)} A ${VIEW_CONE_RADIUS} ${VIEW_CONE_RADIUS} 0 0 1 ${coneEdge(facing + VIEW_CONE_HALF_ANGLE)} Z`}
            fill="#ffc861"
            fillOpacity={0.16}
          />
          {blips.map((blip, index) => {
            if (!blip.alive) return null;
            const distance = Math.hypot(blip.x, blip.z);
            const clamp = distance > DOT_CLAMP ? DOT_CLAMP / distance : 1;
            return (
              <circle
                key={index}
                cx={(blip.x * clamp).toFixed(1)}
                cy={(blip.z * clamp).toFixed(1)}
                r={2}
                fill="#ff5f4d"
              />
            );
          })}
          <circle cx={playerX} cy={playerZ} r={2.4} fill="#ffd166" stroke="#3a2a08" strokeWidth={0.8} />
        </g>
      </svg>
      <div className="absolute left-1/2 top-[7px] -translate-x-1/2 text-[9px] font-bold tracking-[0.2em] text-white/55">
        N
      </div>
    </div>
  );
}
