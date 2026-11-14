const ink = "var(--foreground)";
const muted = "var(--muted-foreground)";
const signal = "var(--signal)";
const mono = "var(--font-mono)";

function Box({
  x,
  y,
  w,
  title,
  note,
}: {
  x: number;
  y: number;
  w: number;
  title: string;
  note: string;
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={64}
        rx={10}
        fill="var(--background)"
        stroke={ink}
        strokeOpacity={0.12}
      />
      <text x={x + w / 2} y={y + 29} textAnchor="middle" fill={ink} fontSize={16} fontWeight={500}>
        {title}
      </text>
      <text
        x={x + w / 2}
        y={y + 48}
        textAnchor="middle"
        fill={muted}
        fontFamily={mono}
        fontSize={12}
      >
        {note}
      </text>
    </g>
  );
}

const products = [
  { y: 40, title: "Filesystem", note: "mount · fork · merge" },
  { y: 176, title: "Index", note: "vector · full text" },
];

export function Layers() {
  return (
    <figure className="reveal hidden rounded-3xl border border-border bg-card sm:block">
      <svg
        viewBox="0 0 960 330"
        role="img"
        aria-label="Agents and apps use a filesystem and a search index. Both read through a shared cache from your object storage. Only changes are written back, every 2 seconds."
        className="mx-auto block w-full max-w-5xl px-6 py-14"
      >
        <defs>
          <marker
            id="head"
            viewBox="0 0 10 10"
            refX="9"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0 1 9 5 0 9" fill="none" stroke={signal} strokeWidth={1.2} />
          </marker>
        </defs>

        <g fill="none" stroke={signal} strokeWidth={1} markerEnd="url(#head)">
          {products.map(({ y }) => (
            <g key={y}>
              <path d={`M560 140H520V${y + 32}H476`} />
              <path d={`M276 ${y + 32}H236V140H196`} />
            </g>
          ))}
          <path d="M800 140H736" />
          <path d="M116 172V290H872V178" strokeDasharray="4 4" className="dash-flow" />
        </g>

        <Box x={56} y={108} w={140} title="Agents" note="and your apps" />
        {products.map((p) => (
          <Box key={p.title} x={276} y={p.y} w={200} title={p.title} note={p.note} />
        ))}
        <Box x={560} y={108} w={176} title="Cache" note="NVMe + shared" />
        <Box x={800} y={108} w={144} title="Object storage" note="your bucket" />

        <text x={494} y={316} textAnchor="middle" fill={muted} fontFamily={mono} fontSize={12.5}>
          only changes go up, every 2 s
        </text>
      </svg>
    </figure>
  );
}
