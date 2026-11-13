import {
  example,
  presets,
  evaluate,
  numericalCheck,
  validate,
} from "./core.js";
const $ = (id) => document.getElementById(id),
  names = { gradient: "Gradient descent", momentum: "Momentum", adam: "Adam" },
  colors = { gradient: "#a1e7cf", momentum: "#ffb780", adam: "#ded0ff" };
let result = null,
  worker = null,
  timer = null,
  inspected = null;
const fmt = (n) =>
  n === null
    ? "Unavailable"
    : n === 0
      ? "0"
      : Math.abs(n) >= 1e5 || Math.abs(n) < 1e-4
        ? n.toExponential(3)
        : n.toLocaleString("en-US", { maximumFractionDigits: 5 });
function el(tag, text, cls) {
  const n = document.createElement(tag);
  if (text !== undefined) n.textContent = text;
  if (cls) n.className = cls;
  return n;
}
function svg(tag, attrs, text) {
  const n = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
  if (text !== undefined) n.textContent = text;
  return n;
}
function load(input) {
  for (const id of ["formula", "x", "y", "rate", "steps", "clip", "tolerance"])
    $(id).value = input[id];
  ["xmin", "xmax", "ymin", "ymax"].forEach(
    (id, i) => ($(id).value = input.bounds[i]),
  );
}
function settings() {
  return {
    formula: $("formula").value,
    ...Object.fromEntries(
      ["x", "y", "rate", "steps", "clip", "tolerance"].map((k) => [
        k,
        Number($(k).value),
      ]),
    ),
    bounds: ["xmin", "xmax", "ymin", "ymax"].map((k) => Number($(k).value)),
  };
}
function stop() {
  clearInterval(timer);
  timer = null;
  $("play").textContent = "Play";
}
function run() {
  stop();
  worker?.terminate();
  $("result").setAttribute("aria-busy", "true");
  for (const id of ["save", "export", "csv", "png", "play", "method", "step"])
    $(id).disabled = true;
  $("run").disabled = true;
  $("status").textContent = "Computing…";
  worker = new Worker("./worker.js", { type: "module" });
  worker.onmessage = ({ data }) => {
    worker.terminate();
    worker = null;
    $("run").disabled = false;
    if (data.error) {
      $("status").textContent = data.error;
      return;
    }
    result = data.result;
    render();
  };
  worker.onerror = () => {
    worker?.terminate();
    worker = null;
    $("run").disabled = false;
    $("status").textContent =
      "The numerical worker could not finish. Reload and retry.";
  };
  const input = settings();
  $("preset").value =
    Object.keys(presets).find((key) =>
      Object.entries(presets[key]).every(
        ([field, value]) =>
          JSON.stringify(input[field]) === JSON.stringify(value),
      ),
    ) || "custom";
  worker.postMessage(input);
}
function selected() {
  return result.runs.find((r) => r.method === $("method").value);
}
function render() {
  $("formula-display").textContent = result.input.formula;
  $("result").hidden = false;
  $("result").setAttribute("aria-busy", "false");
  for (const id of ["save", "export", "csv", "png", "play", "method", "step"])
    $(id).disabled = false;
  $("status").textContent = "";
  $("legend").replaceChildren(
    ...result.runs.map((r) => {
      const span = el("span"),
        i = el("i");
      i.style.backgroundColor = colors[r.method];
      span.append(i, document.createTextNode(names[r.method]));
      return span;
    }),
  );
  const table = el("table"),
    head = el("tr");
  head.append(
    ...["Optimizer", "Final loss", "Gradient norm"].map((x) => el("th", x)),
  );
  const thead = el("thead");
  thead.append(head);
  table.append(thead);
  const body = el("tbody");
  for (const r of result.runs) {
    const last = r.trace.at(-1),
      row = el("tr"),
      name = el("td", names[r.method]);
    name.append(
      el(
        "small",
        `${r.status} · ${last.iteration} updates${r.failure ? " · " + r.failure.message : ""}`,
      ),
    );
    row.append(name, el("td", fmt(last.value)), el("td", fmt(last.norm)));
    body.append(row);
  }
  table.append(body);
  $("comparison").replaceChildren(table);
  setMethod();
}
function setMethod() {
  stop();
  $("step").max = selected().trace.length - 1;
  $("step").value = 0;
  renderPoint();
}
function renderPoint() {
  const point = selected().trace[Number($("step").value)];
  inspected = {
    ...point,
    ...evaluate(result.compiled, point.x, point.y),
    checks: numericalCheck(result.compiled, point.x, point.y),
  };
  $("iteration").textContent =
    `${point.iteration} / ${selected().trace.at(-1).iteration}`;
  $("point").replaceChildren(
    ...[
      ["x", point.x],
      ["y", point.y],
      ["Loss", point.value],
      ["∂f/∂x", point.dx],
      ["∂f/∂y", point.dy],
      ["Gradient norm", point.norm],
    ].map(([label, value]) => {
      const block = el("div");
      block.append(el("span", label), el("strong", fmt(value)));
      return block;
    }),
  );
  const checkTable = el("table"),
    checkHead = el("tr");
  checkHead.append(
    ...["Axis", "Automatic", "Central difference", "Scaled error"].map((x) =>
      el("th", x),
    ),
  );
  const ch = el("thead");
  ch.append(checkHead);
  checkTable.append(ch);
  const cb = el("tbody");
  for (const c of inspected.checks) {
    const row = el("tr");
    row.append(
      ...[
        c.axis,
        fmt(c.automatic),
        c.numeric === null ? c.error : fmt(c.numeric),
        c.scaledError === undefined ? "—" : fmt(c.scaledError),
      ].map((x) => el("td", x)),
    );
    cb.append(row);
  }
  checkTable.append(cb);
  $("checks").replaceChildren(checkTable);
  const tape = el("table"),
    head = el("tr");
  head.append(
    ...[
      "Node",
      "Operation",
      "Inputs",
      "Forward value",
      "Local derivatives",
      "Adjoint",
    ].map((x) => el("th", x)),
  );
  const th = el("thead");
  th.append(head);
  tape.append(th);
  const tb = el("tbody");
  for (const n of inspected.tape) {
    const row = el("tr");
    row.append(
      ...[
        String(n.id),
        n.op === "power" ? `power ${n.exponent}` : n.op,
        n.args.join(", ") || "—",
        fmt(n.value),
        n.local.map(fmt).join(", ") || "—",
        fmt(n.adjoint),
      ].map((x) => el("td", x)),
    );
    tb.append(row);
  }
  tape.append(tb);
  $("tape").replaceChildren(tape);
  drawLandscape();
  drawLoss();
}
function graphBox() {
  const rect = $("landscape").getBoundingClientRect();
  return {
    width: rect.width,
    height: rect.height,
    x: rect.width < 700 ? 48 : 80,
    y: 60,
    w: rect.width - (rect.width < 700 ? 75 : 140),
    h: rect.height - 110,
  };
}
function drawLandscape() {
  if (!result || !inspected) return;
  const canvas = $("landscape"),
    ctx = canvas.getContext("2d"),
    box = graphBox();
  if (box.w <= 0 || box.h <= 0) return;
  const dpr = Math.min(devicePixelRatio || 1, 2);
  canvas.width = Math.round(box.width * dpr);
  canvas.height = Math.round(box.height * dpr);
  ctx.scale(dpr, dpr);
  const [xmin, xmax, ymin, ymax] = result.input.bounds,
    grid = result.surface;
  const px = (x) => box.x + ((x - xmin) / (xmax - xmin)) * box.w,
    py = (y) => box.y + ((ymax - y) / (ymax - ymin)) * box.h;
  ctx.fillStyle = "#17131e";
  ctx.fillRect(0, 0, box.width, box.height);
  const den = grid.min === null ? 1 : Math.log1p(grid.max - grid.min) || 1;
  const tone = (v) =>
    v === null ? null : Math.log1p(Math.max(0, v - grid.min)) / den;
  const off = document.createElement("canvas");
  off.width = off.height = grid.size;
  const oc = off.getContext("2d"),
    pixels = oc.createImageData(grid.size, grid.size);
  grid.values.forEach((v, i) => {
    const t = tone(v),
      c = t === null ? [78, 76, 82] : [35 + 80 * t, 28 + 47 * t, 47 + 103 * t];
    pixels.data.set([...c.map(Math.round), 255], i * 4);
  });
  oc.putImageData(pixels, 0, 0);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(off, box.x, box.y, box.w, box.h);
  ctx.save();
  ctx.beginPath();
  ctx.rect(box.x, box.y, box.w, box.h);
  ctx.clip();
  // Iso-loss lines from the sampled surface, interpolated within each grid cell.
  ctx.strokeStyle = "#d2b7ee";
  ctx.globalAlpha = 0.19;
  ctx.lineWidth = 0.7;
  for (let level = 0.08; level < 1; level += 0.075) {
    ctx.beginPath();
    for (let row = 0; row < grid.size - 1; row++)
      for (let col = 0; col < grid.size - 1; col++) {
        const ids = [
          row * grid.size + col,
          row * grid.size + col + 1,
          (row + 1) * grid.size + col + 1,
          (row + 1) * grid.size + col,
        ];
        const vals = ids.map((i) => tone(grid.values[i]));
        if (vals.some((v) => v === null)) continue;
        const corners = [
            [col + 0.5, row + 0.5],
            [col + 1.5, row + 0.5],
            [col + 1.5, row + 1.5],
            [col + 0.5, row + 1.5],
          ],
          hits = [];
        for (let edge = 0; edge < 4; edge++) {
          const next = (edge + 1) % 4,
            a = vals[edge],
            b = vals[next];
          if (a < level !== b < level) {
            const t = (level - a) / (b - a);
            hits.push([
              box.x +
                ((corners[edge][0] +
                  t * (corners[next][0] - corners[edge][0])) /
                  grid.size) *
                  box.w,
              box.y +
                ((corners[edge][1] +
                  t * (corners[next][1] - corners[edge][1])) /
                  grid.size) *
                  box.h,
            ]);
          }
        }
        for (let j = 0; j + 1 < hits.length; j += 2) {
          ctx.moveTo(...hits[j]);
          ctx.lineTo(...hits[j + 1]);
        }
      }
    ctx.stroke();
  }
  ctx.globalAlpha = 0.12;
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 1;
  for (let i = 0; i <= 4; i++) {
    ctx.beginPath();
    ctx.moveTo(box.x + (i / 4) * box.w, box.y);
    ctx.lineTo(box.x + (i / 4) * box.w, box.y + box.h);
    ctx.moveTo(box.x, box.y + (i / 4) * box.h);
    ctx.lineTo(box.x + box.w, box.y + (i / 4) * box.h);
    ctx.stroke();
  }
  for (const r of result.runs) {
    ctx.strokeStyle = colors[r.method];
    ctx.lineWidth = r.method === $("method").value ? 2.4 : 1.5;
    ctx.globalAlpha = r.method === $("method").value ? 1 : 0.65;
    ctx.beginPath();
    r.trace.forEach((p, i) =>
      i ? ctx.lineTo(px(p.x), py(p.y)) : ctx.moveTo(px(p.x), py(p.y)),
    );
    ctx.stroke();
  }
  ctx.globalAlpha = 1;
  ctx.fillStyle = colors[$("method").value];
  ctx.beginPath();
  ctx.arc(px(inspected.x), py(inspected.y), 5, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = "#fff";
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(px(result.input.x), py(result.input.y), 3, 0, Math.PI * 2);
  ctx.fillStyle = "#fff";
  ctx.fill();
  ctx.restore();
  ctx.fillStyle = "#b2a3c1";
  ctx.font = "11px Consolas, monospace";
  ctx.textAlign = "center";
  for (let i = 0; i <= 4; i++)
    ctx.fillText(
      fmt(xmin + (i / 4) * (xmax - xmin)),
      box.x + (i / 4) * box.w,
      box.y + box.h + 24,
    );
  ctx.textAlign = "right";
  for (let i = 0; i <= 4; i++)
    ctx.fillText(
      fmt(ymin + (i / 4) * (ymax - ymin)),
      box.x - 14,
      py(ymin + (i / 4) * (ymax - ymin)) + 4,
    );
  const outside = selected().trace.filter(
    (p) => p.x < xmin || p.x > xmax || p.y < ymin || p.y > ymax,
  ).length;
  $("surface-note").textContent =
    `Sampled loss ${fmt(grid.min)} to ${fmt(grid.max)} · ${grid.invalid} undefined cells · ${outside} selected-trace points outside the plot. Colors and contours use log(1 + f − sampled minimum).`;
  canvas.setAttribute(
    "aria-label",
    `Loss landscape x ${xmin} to ${xmax}, y ${ymin} to ${ymax}. ${names[$("method").value]} at x ${fmt(inspected.x)}, y ${fmt(inspected.y)}, loss ${fmt(inspected.value)}. Click to choose a starting point; arrows adjust start; Enter runs.`,
  );
}
function drawLoss() {
  const root = $("loss");
  root.replaceChildren();
  const transform = (v) => Math.sign(v) * Math.log1p(Math.abs(v)),
    values = result.runs.flatMap((r) => r.trace.map((p) => transform(p.value)));
  let min = Math.min(...values),
    max = Math.max(...values);
  if (max - min < 1e-12) {
    min -= 0.5;
    max += 0.5;
  }
  const px = (i) => 60 + (i / result.input.steps) * 440,
    py = (v) => 300 - ((transform(v) - min) / (max - min)) * 270;
  for (let i = 0; i <= 4; i++) {
    const t = min + (i / 4) * (max - min),
      y = 300 - (i / 4) * 270,
      value = Math.sign(t) * Math.expm1(Math.abs(t));
    root.append(
      svg("line", {
        x1: 60,
        y1: y,
        x2: 500,
        y2: y,
        stroke: "#403648",
        "stroke-width": 1,
      }),
      svg("text", { x: 52, y: y + 3, "text-anchor": "end" }, fmt(value)),
      svg(
        "text",
        { x: 60 + (i / 4) * 440, y: 325, "text-anchor": "middle" },
        String(Math.round((i / 4) * result.input.steps)),
      ),
    );
  }
  for (const r of result.runs)
    root.append(
      svg("polyline", {
        points: r.trace
          .map((p) => `${px(p.iteration)},${py(p.value)}`)
          .join(" "),
        fill: "none",
        stroke: colors[r.method],
        "stroke-width": r.method === $("method").value ? 2.4 : 1.4,
        opacity: r.method === $("method").value ? 1 : 0.65,
      }),
    );
  root.append(
    svg("circle", {
      cx: px(inspected.iteration),
      cy: py(inspected.value),
      r: 4,
      fill: colors[$("method").value],
      stroke: "white",
      "stroke-width": 2,
    }),
  );
}
function download(name, content, type = "application/json") {
  const url = URL.createObjectURL(new Blob([content], { type })),
    a = el("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
$("form").addEventListener("submit", (e) => {
  e.preventDefault();
  run();
});
$("preset").addEventListener("change", () => {
  if ($("preset").value === "custom") return;
  load({ ...example, ...presets[$("preset").value] });
  run();
});
$("method").addEventListener("change", setMethod);
$("step").addEventListener("input", () => {
  stop();
  renderPoint();
});
$("play").addEventListener("click", () => {
  if (timer) {
    stop();
    return;
  }
  if (Number($("step").value) === Number($("step").max)) $("step").value = 0;
  $("play").textContent = "Pause";
  timer = setInterval(() => {
    const next = Math.min(
      Number($("step").max),
      Number($("step").value) +
        Math.max(1, Math.ceil(Number($("step").max) / 120)),
    );
    $("step").value = next;
    renderPoint();
    if (next === Number($("step").max)) stop();
  }, 90);
});
$("landscape").addEventListener("click", (event) => {
  if (!result || worker) return;
  const rect = $("landscape").getBoundingClientRect(),
    box = graphBox(),
    x = event.clientX - rect.left,
    y = event.clientY - rect.top;
  if (x < box.x || x > box.x + box.w || y < box.y || y > box.y + box.h) return;
  const b = result.input.bounds;
  $("x").value = (b[0] + ((x - box.x) / box.w) * (b[1] - b[0])).toFixed(6);
  $("y").value = (b[3] - ((y - box.y) / box.h) * (b[3] - b[2])).toFixed(6);
  run();
});
$("landscape").addEventListener("keydown", (event) => {
  if (!result || worker) return;
  if (event.key === "Enter") {
    run();
    return;
  }
  const moves = {
    ArrowLeft: [-1, 0],
    ArrowRight: [1, 0],
    ArrowUp: [0, 1],
    ArrowDown: [0, -1],
  };
  if (!moves[event.key]) return;
  event.preventDefault();
  const [dx, dy] = moves[event.key],
    b = result.input.bounds;
  $("x").value = Math.max(
    -100,
    Math.min(100, Number($("x").value) + dx * (b[1] - b[0]) * 0.01),
  ).toFixed(6);
  $("y").value = Math.max(
    -100,
    Math.min(100, Number($("y").value) + dy * (b[3] - b[2]) * 0.01),
  ).toFixed(6);
  $("status").textContent =
    `Pending start: (${$("x").value}, ${$("y").value}). Press Enter to run.`;
});
$("save").addEventListener("click", () =>
  download(
    "slope-experiment.json",
    JSON.stringify(result.input, null, 2) + "\n",
  ),
);
$("export").addEventListener("click", () =>
  download(
    "slope-evidence.json",
    JSON.stringify(
      {
        format: "slope-studio-evidence-v1",
        ...result,
        inspection: { method: $("method").value, ...inspected },
      },
      null,
      2,
    ) + "\n",
  ),
);
$("csv").addEventListener("click", () => {
  const fields = ["iteration", "x", "y", "value", "dx", "dy", "norm"];
  download(
    "slope-traces.csv",
    [
      "method," + fields.join(","),
      ...result.runs.flatMap((r) =>
        r.trace.map((p) => [r.method, ...fields.map((k) => p[k])].join(",")),
      ),
    ].join("\n") + "\n",
    "text/csv",
  );
});
$("png").addEventListener("click", () =>
  $("landscape").toBlob((blob) => {
    if (blob) download("slope-landscape.png", blob, "image/png");
  }),
);
$("open").addEventListener("click", () => $("file").click());
$("file").addEventListener("change", async () => {
  const file = $("file").files[0];
  try {
    if (!file) return;
    if (file.size > 50000)
      throw Error("Experiment files must be at most 50 KB.");
    const input = validate(JSON.parse(await file.text())).input;
    if (!Array.isArray(input.bounds) || input.bounds.length !== 4)
      throw Error("Expected experiment settings and four plot bounds.");
    load(input);
    run();
  } catch (error) {
    $("status").textContent = error.message;
  } finally {
    $("file").value = "";
  }
});
for (const [button, panel] of [
  ["settings-open", "settings-panel"],
  ["analysis-open", "analysis-panel"],
]) {
  $(button).onclick = () => $(panel).showModal();
}
for (const b of document.querySelectorAll("[data-close]"))
  b.onclick = () => $(b.dataset.close).close();
$("form").addEventListener("submit", () => $("settings-panel").close());
new ResizeObserver(() => {
  if (result) drawLandscape();
}).observe($("landscape"));
load(example);
run();
