/*
  Illustrations for guides/providers/traffic-routing.mdx. Every number and
  coordinate is an illustrative, precomputed literal; nothing here computes
  routing. Styles live in style.css under "Provider routing figures".
  Mintlify snippets cannot share module-level helpers, so each component is
  self-contained.
*/

/** Color square for one adjusted-price part: price, ttft, rel, 429 or speed. */
export const RoutingSwatch = ({ part }) => (
  <span
    className={`pr-sw pr-bg-${part}`}
    aria-hidden="true"
  />
);

/** Speed against adjusted price for five example endpoints, with the competitive edge and their traffic shares. */
export const RoutingTradeoff = () => {
  // Illustrative example, drawn from precomputed coordinates.
  const dots = [
    { name: "Balanced", share: 35, cx: 363.3, cy: 154.5, isCompetitive: true },
    { name: "Fast", share: 34, cx: 468.4, cy: 121.3, isCompetitive: true },
    { name: "Budget", share: 22, cx: 258.1, cy: 168.1, isCompetitive: true },
    { name: "Slow start", share: 7, cx: 315.4, cy: 99.9, isCompetitive: false },
    { name: "Unreliable", share: 2, cx: 334.6, cy: 49.1, isCompetitive: false, isLabelLeft: true },
  ];
  const rows = [
    { name: "Balanced", parts: ["38.1%", "6.7%", "1.4%", "0.5%"], adjusted: "$0.98", speed: "51.8%", tps: 92, share: 35 },
    { name: "Fast", parts: ["55.2%", "5.7%", "1.4%", "0.5%"], adjusted: "$1.32", speed: "38.1%", tps: 125, share: 34 },
    { name: "Budget", parts: ["29.5%", "8.6%", "1.4%", "0.5%"], adjusted: "$0.84", speed: "80.7%", tps: 59, share: 22 },
    { name: "Slow start", parts: ["40.5%", "31.0%", "1.4%", "0.5%"], adjusted: "$1.54", speed: "61.8%", tps: 77, share: 7 },
    { name: "Unreliable", parts: ["38.1%", "6.7%", "47.6%", "5.7%"], adjusted: "$2.06", speed: "57.4%", tps: 83, share: 2 },
  ];
  const partNames = ["price", "ttft", "rel", "429"];
  return (
    <figure className="pr-fig">
      <svg
        viewBox="0 0 600 290"
        role="img"
        aria-label="Speed against adjusted price for five example endpoints. The competitive edge curves upward with speed, so faster endpoints can carry a higher adjusted price and stay competitive."
      >
        <path d="M188.6,250L195,236.6L201.4,224.6L207.8,213.6L214.1,203.6L226.9,186.1L239.6,171.2L252.4,158.4L258.8,152.7L271.5,142.3L290.6,128.9L303.4,121.2L316.1,114.3L328.9,108.1L341.6,102.4L367.1,92.6L392.6,84.3L424.5,75.7L456.4,68.5L494.6,61.2L532.9,55.2L577.5,49.3L580,250L188.6,250Z" className="zone" />
        <path d="M188.6,250L195,236.6L201.4,224.6L207.8,213.6L214.1,203.6L226.9,186.1L239.6,171.2L252.4,158.4L258.8,152.7L271.5,142.3L290.6,128.9L303.4,121.2L316.1,114.3L328.9,108.1L341.6,102.4L367.1,92.6L392.6,84.3L424.5,75.7L456.4,68.5L494.6,61.2L532.9,55.2L577.5,49.3" className="edge-curve" />
        <line x1="70" x2="580" y1="250" y2="250" className="axis" />
        <line x1="70" x2="70" y1="16" y2="250" className="axis" />
        {[[0, 254], [1, 156.5], [2, 59]].map(([v, y]) => (
          <text key={v} x="62" y={y} textAnchor="end" className="tick">
            {`$${v}`}
          </text>
        ))}
        {[[0, 70], [40, 197.5], [80, 325], [120, 452.5], [160, 580]].map(([v, x]) => (
          <text key={v} x={x} y="268" textAnchor="middle" className="tick">
            {v}
          </text>
        ))}
        <text x="325" y="286" textAnchor="middle" className="tick">
          Speed (tokens / sec) →
        </text>
        <text transform="translate(18 133) rotate(-90)" textAnchor="middle" className="tick">
          Adjusted price / 1M
        </text>
        <text x="576" y="40" textAnchor="end" className="zone-lbl">
          Competitive edge
        </text>
        <text x="572" y="238" textAnchor="end" className="zone-lbl">
          Competitive
        </text>
        <text x="80" y="30" className="zone-lbl muted">
          Exploration
        </text>
        {dots.map((e) => (
          <g key={e.name}>
            <circle cx={e.cx} cy={e.cy} r="5" className={e.isCompetitive ? "dot-in" : "dot"} />
            <text
              x={e.isLabelLeft ? e.cx - 9 : e.cx + 9}
              y={e.cy + 4}
              textAnchor={e.isLabelLeft ? "end" : "start"}
              className="lbl halo"
            >
              {`${e.name} `}
              <tspan className={e.isCompetitive ? "strong" : "num"}>{`${e.share}%`}</tspan>
            </text>
          </g>
        ))}
      </svg>
      <div className="pr-table" role="table" aria-label="Example endpoints: adjusted price, speed and traffic share">
        <div className="pr-row pr-head" role="row">
          <span role="columnheader">Endpoint</span>
          <span role="columnheader">Adjusted price / 1M</span>
          <span />
          <span />
          <span role="columnheader">Speed</span>
          <span />
          <span role="columnheader">Share</span>
        </div>
        {rows.map((e) => (
          <div key={e.name} className="pr-row" role="row">
            <span className="pr-name">{e.name}</span>
            <span className="pr-bar">
              {e.parts.map((width, i) => (
                <i key={partNames[i]} className={`pr-bg-${partNames[i]}`} style={{ width }} />
              ))}
            </span>
            <span className="pr-num">{e.adjusted}</span>
            <span className="pr-plus">+</span>
            <span className="pr-bar">
              <i className="pr-bg-speed" style={{ width: e.speed }} />
            </span>
            <span className="pr-num">{`${e.tps} tok/s`}</span>
            <span className="pr-share">
              <i style={{ width: `${e.share}%` }} />
              <b>{`${e.share}%`}</b>
            </span>
          </div>
        ))}
      </div>
      <div className="pr-legend">
        <span>
          <i className="pr-sw pr-bg-price" />
          Effective price
        </span>
        <span>
          <i className="pr-sw pr-bg-ttft" />
          TTFT
        </span>
        <span>
          <i className="pr-sw pr-bg-rel" />
          Reliability &amp; quality
        </span>
        <span>
          <i className="pr-sw pr-bg-429" />
          429s
        </span>
        <span>
          <i className="pr-sw pr-bg-speed" />
          Speed
        </span>
      </div>
    </figure>
  );
};

/** Traffic preference against distance from the best endpoint: flat inside the competitive edge, steep past it. */
export const RoutingPreferenceCurve = () => {
  // Illustrative curve and example endpoints, drawn from precomputed coordinates.
  const dots = [
    { cx: 60, cy: 30.8, isCompetitive: true },
    { cx: 73.5, cy: 36.4, isCompetitive: true },
    { cx: 177.5, cy: 95.3, isCompetitive: true },
    { cx: 254, cy: 163, isCompetitive: false },
    { cx: 361.6, cy: 188.2, isCompetitive: false },
  ];
  const ticks = [
    [60, "Best", "start"],
    [216, "Competitive edge", "middle"],
    [580, "Further behind", "end"],
  ];
  return (
    <figure className="pr-fig">
      <svg
        viewBox="0 0 600 222"
        role="img"
        aria-label="Traffic preference falls slowly for endpoints close to the best, then drops steeply past the competitive edge."
      >
        <rect x="60" y="22" width="156" height="168" className="zone" />
        <line x1="216" x2="216" y1="22" y2="190" className="edge" />
        <path d="M60,30.8L96.4,45.9L117.2,55.3L132.8,63.3L148.4,72.8L164,84L174.4,92.6L190,106.9L221.2,137.3L231.6,146.6L242,154.8L252.4,162L262.8,168L273.2,172.9L288.8,178.4L304.4,182.2L320,184.8L340.8,187L366.8,188.4L398,189.3L434.4,189.7L580,190L580,190L60,190Z" className="curve-fill" />
        <path d="M60,30.8L96.4,45.9L117.2,55.3L132.8,63.3L148.4,72.8L164,84L174.4,92.6L190,106.9L221.2,137.3L231.6,146.6L242,154.8L252.4,162L262.8,168L273.2,172.9L288.8,178.4L304.4,182.2L320,184.8L340.8,187L366.8,188.4L398,189.3L434.4,189.7L580,190" className="curve" />
        {dots.map((dot) => (
          <circle key={dot.cx} cx={dot.cx} cy={dot.cy} r="4.5" className={dot.isCompetitive ? "dot-in" : "dot"} />
        ))}
        <line x1="60" x2="580" y1="190" y2="190" className="axis" />
        {ticks.map(([x, label, anchor]) => (
          <text key={label} x={x} y="208" textAnchor={anchor} className="tick">
            {label}
          </text>
        ))}
        <text x="68" y="180" className="zone-lbl">
          Competitive
        </text>
        <text x="226" y="40" className="zone-lbl muted">
          Exploration
        </text>
        <text x="226" y="56" className="tick">
          share drops off fast
        </text>
        <text transform="translate(22 110) rotate(-90)" textAnchor="middle" className="tick">
          Traffic preference
        </text>
      </svg>
    </figure>
  );
};

/** A receipt for one request priced at an endpoint's observed effective price. */
export const RoutingEffectivePrice = () => {
  const torn = Array.from({ length: 38 }, (_, i) => `L${390 - i * 10} ${i % 2 ? 190 : 198}`).join(" ");
  const lines = [
    { label: "Uncached · 40K × $2.00/M", x: 52, y: 92, leader: 212, amount: "$0.080" },
    { label: "Cached · 60K × $0.50/M", x: 52, y: 114, leader: 198, amount: "$0.030" },
  ];
  return (
    <div className="pr-mini">
      <svg
        viewBox="0 0 420 204"
        width="420"
        role="img"
        aria-label="Example: 40K uncached input tokens at $2.00/M, 60K cached input tokens at $0.50/M and about 4K output tokens at $8.00/M give an effective price of $0.142 for one request."
      >
        <path className="paper" d={`M20 10 H400 V190 ${torn} Z`} />
        <text className="lbl strong-lbl" x="36" y="36">
          Observed · last 30 min
        </text>
        <text className="lbl amt" x="384" y="36">
          one request
        </text>
        <line className="usual" x1="36" y1="46" x2="384" y2="46" />
        <text className="lbl strong-lbl" x="36" y="70">
          Input
        </text>
        {lines.map((l) => (
          <g key={l.label}>
            <text className="lbl" x={l.x} y={l.y}>
              {l.label}
            </text>
            <line className="usual" x1={l.leader} y1={l.y - 4} x2="318" y2={l.y - 4} />
            <text className="lbl amt" x="384" y={l.y}>
              {l.amount}
            </text>
          </g>
        ))}
        <text className="lbl" x="36" y="138">
          <tspan className="strong-lbl">Output</tspan> · ~4K × $8.00/M
        </text>
        <line className="usual" x1="182" y1="134" x2="318" y2="134" />
        <text className="lbl amt" x="384" y="138">
          $0.032
        </text>
        <line className="sum-line" x1="304" y1="150" x2="384" y2="150" />
        <text className="lbl strong-lbl" x="36" y="171">
          Effective price
        </text>
        <rect className="price-pill" x="304" y="156" width="80" height="22" rx="11" />
        <text className="pill-text" x="344" y="171" textAnchor="middle">
          $0.142
        </text>
      </svg>
    </div>
  );
};

/** End-to-end speed: TTFT plus streaming time, divided into the output tokens. */
export const RoutingSpeed = () => (
  <div className="pr-mini">
    <svg
      viewBox="50 0 300 98"
      width="300"
      role="img"
      aria-label="Example: a 5 second TTFT plus 500 tokens streamed in 5 seconds is 500 tokens in 10 seconds, a speed of 50 tokens per second end to end."
    >
      <text x="129.5" y="12" textAnchor="middle" className="lbl strong-lbl">
        TTFT 5s
      </text>
      <text x="270.5" y="12" textAnchor="middle" className="lbl strong-lbl">
        + 500 tokens in 5s
      </text>
      <rect x="60" y="20" width="139" height="14" rx="2" className="pr-fill-ttft" />
      <rect x="201" y="20" width="139" height="14" rx="2" className="span-stream" />
      <path d="M60,40 Q60,47 70,47 L190,47 Q200,47 200,54 Q200,47 210,47 L330,47 Q340,47 340,40" className="brace" />
      <rect x="96" y="68" width="10" height="10" rx="2" className="pr-fill-speed" />
      <text x="112" y="77" className="lbl strong-lbl">
        Speed (TPS): 50 tok/s end to end
      </text>
      <text x="200" y="91" textAnchor="middle" className="lbl">
        500 tokens ÷ 10s, TTFT included
      </text>
    </svg>
  </div>
);

/** An agent session: each step waits for a first token, and tool calls are mostly that wait. */
export const RoutingTtftSession = () => {
  // [TTFT start, streaming width] per step.
  const steps = [
    [40, 96],
    [154, 7],
    [179, 7],
    [204, 7],
    [229, 7],
    [254, 7],
    [279, 60],
    [357, 72],
  ];
  const labels = [
    [96, "Reasoning"],
    [215, "5 tool calls"],
    [316, "Reasoning"],
    [400, "Response"],
  ];
  return (
    <div className="pr-mini">
      <svg
        viewBox="0 0 454 70"
        width="454"
        role="img"
        aria-label="An agent session: reasoning, five tool calls in a row, more reasoning and a response. Each step waits for a first token, so the tool calls are mostly waiting on TTFT."
      >
        <circle cx="16" cy="29" r="5" className="user-dot" />
        <text x="16" y="14" textAnchor="middle" className="lbl strong-lbl">
          User
        </text>
        {labels.map(([x, label], i) => (
          <text key={i} x={x} y="14" textAnchor="middle" className="lbl strong-lbl">
            {label}
          </text>
        ))}
        {steps.map(([x, stream]) => (
          <g key={x}>
            <rect x={x} y="22" width="14" height="14" rx="2" className="pr-fill-ttft" />
            <rect x={x + 15} y="22" width={stream} height="14" rx="2" className="span-stream" />
          </g>
        ))}
        <path d="M154,40 Q154,46 162,46 L207,46 Q215,46 215,52 Q215,46 223,46 L268,46 Q276,46 276,40" className="brace" />
        <text x="215" y="66" textAnchor="middle" className="lbl">
          mostly waiting on TTFT
        </text>
        <rect x="324" y="50" width="10" height="10" rx="2" className="pr-fill-ttft" />
        <text x="338" y="59" className="lbl">
          TTFT
        </text>
        <rect x="376" y="50" width="10" height="10" rx="2" className="span-stream" />
        <text x="390" y="59" className="lbl">
          Streaming
        </text>
      </svg>
    </div>
  );
};

/** A 1% error rate times an 8× penalty per error is about 8% on adjusted price. */
export const RoutingReliability = () => (
  <div className="pr-mini">
    <svg
      viewBox="0 0 560 74"
      width="560"
      role="img"
      aria-label="Example: a 1% error rate times an 8× penalty per error raises adjusted price by about 8%."
    >
      {Array.from({ length: 100 }, (_, i) => (
        <rect
          key={i}
          x={(i % 25) * 10}
          y={Math.floor(i / 25) * 10}
          width="8"
          height="8"
          rx="1.5"
          className={i === 62 ? "pr-fill-rel" : "span-stream"}
        />
      ))}
      <text x="124" y="56" textAnchor="middle" className="lbl strong-lbl">
        1%
      </text>
      <text x="124" y="70" textAnchor="middle" className="lbl">
        error rate
      </text>
      <text x="270" y="26" textAnchor="middle" className="op">
        ×
      </text>
      {Array.from({ length: 8 }, (_, i) => (
        <rect key={i} x={292 + i * 15} y="13" width="12" height="12" rx="2" className="pr-fill-rel extra" />
      ))}
      <text x="350" y="56" textAnchor="middle" className="lbl strong-lbl">
        8× penalty
      </text>
      <text x="350" y="70" textAnchor="middle" className="lbl">
        per error
      </text>
      <text x="434" y="26" textAnchor="middle" className="op">
        =
      </text>
      <rect x="456" y="9" width="84" height="20" rx="10" className="neg-pill" />
      <text x="498" y="23" textAnchor="middle" className="neg-text">
        +8%
      </text>
      <text x="498" y="56" textAnchor="middle" className="lbl">
        adjusted price
      </text>
    </svg>
  </div>
);

/** 19 of 20 well-formed tool calls raises adjusted price by about 5%. */
export const RoutingQuality = () => (
  <div className="pr-mini">
    <svg
      viewBox="0 0 434 58"
      width="434"
      role="img"
      aria-label="Example: 95% of tool calls well formed raises adjusted price by about 5%."
    >
      {Array.from({ length: 20 }, (_, i) =>
        i === 13 ? (
          <g key={i}>
            <rect x={i * 13 + 0.75} y="5.75" width="8.5" height="8.5" rx="1.5" className="bad" />
            <path d={`M${i * 13 + 3},8 L${i * 13 + 7},12 M${i * 13 + 7},8 L${i * 13 + 3},12`} className="bad" />
          </g>
        ) : (
          <rect key={i} x={i * 13} y="5" width="10" height="10" rx="1.5" className="span-stream" />
        ),
      )}
      <text x="128" y="40" textAnchor="middle" className="lbl strong-lbl">
        95%
      </text>
      <text x="128" y="54" textAnchor="middle" className="lbl">
        tool calls well formed
      </text>
      <path d="M282,10 H298" className="big-arrow" />
      <path d="M296,3 L310,10 L296,17 Z" className="big-arrow-head" />
      <rect x="330" y="0" width="84" height="20" rx="10" className="neg-pill" />
      <text x="372" y="14" textAnchor="middle" className="neg-text">
        +5%
      </text>
      <text x="372" y="40" textAnchor="middle" className="lbl">
        adjusted price
      </text>
    </svg>
  </div>
);

/** Where a 429 costs the user time, and how its rate turns that into a small adjusted-price penalty. */
export const RoutingRateLimits = () => (
  <div className="pr-mini">
    <svg
      viewBox="0 0 600 82"
      width="600"
      role="img"
      aria-label="A 429 makes the user wait for the rejection and then send a full request elsewhere. Example: a $2.50 wait plus penalty times a 0.4% 429 rate adds $0.01 to adjusted price."
    >
      <text x="0" y="17" className="lbl strong-lbl">
        Request
      </text>
      <rect x="150" y="6" width="170" height="14" rx="2" className="span-total" />
      <path d="M4,22 V61 H10 M4,37 H10" className="tree" />
      <text x="14" y="41" className="lbl">
        You return a 429
      </text>
      <rect x="150" y="30" width="30" height="14" rx="2" className="pr-fill-429" />
      <text x="14" y="65" className="lbl">
        Full request elsewhere
      </text>
      <rect x="182" y="54" width="138" height="14" rx="2" className="pr-fill-speed" />
      <path d="M330,37 H346" className="big-arrow" />
      <path d="M344,30 L358,37 L344,44 Z" className="big-arrow-head" />
      <text x="370" y="22" className="lbl strong-lbl">
        429 penalty
      </text>
      <rect x="370" y="30" width="30" height="14" rx="2" className="pr-fill-429" />
      <rect x="402" y="30" width="22" height="14" rx="2" className="pr-fill-429 extra" />
      <text x="397" y="62" textAnchor="middle" className="lbl strong-lbl">
        $2.50
      </text>
      <text x="397" y="76" textAnchor="middle" className="lbl">
        wait + penalty
      </text>
      <text x="446" y="41" className="lbl strong-lbl">
        × 0.4%
      </text>
      <text x="464" y="62" textAnchor="middle" className="lbl">
        429 rate
      </text>
      <text x="498" y="41" className="lbl strong-lbl">
        =
      </text>
      <rect x="512" y="27" width="84" height="20" rx="10" className="neg-pill" />
      <text x="554" y="41" textAnchor="middle" className="neg-text">
        +$0.01
      </text>
      <text x="554" y="62" textAnchor="middle" className="lbl">
        adjusted price
      </text>
    </svg>
  </div>
);

/** How a big 429 spike sets the traffic cap, a small steady 429 rate holds it, and added capacity raises it. */
export const RoutingLearnedCapacity = () => {
  // Illustrative scenario, drawn from precomputed paths.
  const notes = [
    [349.9, 63.8, "Your real capacity", "end"],
    [360.6, 36.9, "You add capacity", "start"],
    [413.8, 92.2, "Cap rises", "start"],
    [133.6, 199.2, "Big spike: cap set", "middle"],
    [250.6, 249.4, "Steady 429s: cap holds", "start"],
    [420.9, 253.3, "No 429s", "middle"],
    [488.2, 249.4, "Steady again", "start"],
  ];
  return (
    <figure className="pr-fig">
      <svg
        viewBox="0 0 600 290"
        role="img"
        aria-label="A big spike of 429s sets a traffic cap; a small steady 429 rate then holds the endpoint at its capacity. When the provider adds capacity the 429s stop and the cap rises, until it reaches the new capacity and the small steady 429 rate returns."
      >
        <path d="M52,106.5L55.5,106.2L60.9,104.9L66.2,102.5L71.5,99.1L76.8,94.8L82.1,89.8L105.2,65.2L114.1,57L119.4,53L124.7,49.9L130,47.8L133.6,47.1L137.1,46.8L138.9,49.5L140.7,56.9L144.2,77.1L146,84.5L147.8,87.2L156.6,86.6L165.5,84.8L174.4,82L201,72.4L209.8,70.2L216.9,69.2L222.2,68.9L224,69.2L229.3,71.8L232.9,72.8L369.4,72.6L381.8,71.2L394.3,68.4L406.7,64.5L442.1,51.8L454.5,48.5L465.2,46.6L477.6,45.8L584,45.8L584,170L52,170Z" className="got-fill" />
        <path d="M52,71.8L357,71.8L357,44.9L584,44.9" className="real" />
        <path d="M52,106.5L55.5,106.2L60.9,104.9L66.2,102.5L71.5,99.1L76.8,94.8L82.1,89.8L105.2,65.2L114.1,57L119.4,53L124.7,49.9L130,47.8L133.6,47.1L137.1,46.8L138.9,49.5L140.7,56.9L144.2,77.1L146,84.5L147.8,87.2L156.6,86.6L165.5,84.8L174.4,82L201,72.4L209.8,70.2L216.9,69.2L222.2,68.9L224,69.2L229.3,71.8L232.9,72.8L369.4,72.6L381.8,71.2L394.3,68.4L406.7,64.5L442.1,51.8L454.5,48.5L465.2,46.6L477.6,45.8L584,45.8" className="got" />
        <path d="M142.4,67L144.2,77.1L146,84.5L147.8,87.2L151.3,87.1L158.4,86.3L167.3,84.3L201,72.4L209.8,70.2L216.9,69.2L222.2,68.9L224,69.2L229.3,71.8L232.9,72.8L369.4,72.6L381.8,71.2L394.3,68.4L406.7,64.5L442.1,51.8L454.5,48.5L465.2,46.6L477.6,45.8L584,45.8" className="cap" />
        <line x1="52" x2="584" y1="170" y2="170" className="axis" />
        {[[0, 174], [400, 97], [800, 20]].map(([v, y]) => (
          <text key={v} x="44" y={y} textAnchor="end" className="tick">
            {v}
          </text>
        ))}
        <text transform="translate(12 93) rotate(-90)" textAnchor="middle" className="tick">
          Requests / min
        </text>
        <path d="M52,261.3L96.3,261.1L101.7,260.3L105.2,258.9L107,257.7L110.5,254.2L114.1,248.5L117.6,240.5L124.7,220L128.3,211.1L130,207.9L131.8,205.9L133.6,205.2L135.3,205.9L137.1,207.9L138.9,211.1L142.4,220L149.5,240.5L153.1,248.5L154.9,251.7L156.6,254.2L160.2,257.7L163.7,259.7L169,260.9L176.1,261.3L197.4,261.3L209.8,260.9L213.4,259.6L215.1,258.4L220.5,253.2L222.2,251.9L224,251.4L225.8,251.9L231.1,256.7L232.9,257.8L234.7,258.4L236.4,258.5L243.5,257.4L353.5,257.4L357,258L364.1,260.8L367.7,261.3L458.1,261.3L463.4,260.6L475.8,257.8L481.1,257.4L584,257.4L584,262L52,262Z" className="rate" />
        <line x1="52" x2="584" y1="262" y2="262" className="axis" />
        {notes.map(([x, y, text, anchor]) => (
          <text key={text} x={x} y={y} textAnchor={anchor} className="tick">
            {text}
          </text>
        ))}
        <text transform="translate(12 229) rotate(-90)" textAnchor="middle" className="tick">
          429s
        </text>
        {[[0, 52], [30, 158.4], [60, 264.8], [90, 371.2], [120, 477.6], [150, 584]].map(([t, x]) => (
          <text key={t} x={x} y="280" textAnchor={t === 0 ? "start" : t === 150 ? "end" : "middle"} className="tick">
            {`${t} min`}
          </text>
        ))}
      </svg>
      <div className="pr-legend">
        <span>
          <i className="pr-sw pr-bg-received" />
          Traffic you receive
        </span>
        <span>
          <i className="pr-ln pr-ln-cap" />
          Traffic cap
        </span>
        <span>
          <i className="pr-ln pr-ln-real" />
          Your real capacity
        </span>
        <span>
          <i className="pr-sw pr-bg-429" />
          429 rate
        </span>
      </div>
    </figure>
  );
};
