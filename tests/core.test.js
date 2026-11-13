import test from "node:test";
import assert from "node:assert/strict";
import {
  compile,
  evaluate,
  numericalCheck,
  optimize,
  surface,
  analyze,
  validate,
  presets,
  example,
} from "../core.js";
const near = (a, b, tolerance = 1e-9) =>
  assert(
    Math.abs(a - b) <= tolerance * Math.max(1, Math.abs(a), Math.abs(b)),
    `${a} != ${b}`,
  );
test("shared variable nodes accumulate every reverse contribution", () => {
  const c = compile("x*x+x*y+x"),
    r = evaluate(c, 2, 3);
  assert.equal(c.nodes.filter((n) => n.op === "x").length, 1);
  assert.equal(r.value, 12);
  assert.deepEqual(r.gradient, [8, 2]);
});
test("parser uses mathematical unary/power precedence and bounded grammar", () => {
  assert.equal(evaluate(compile("-x^2"), 3, 0).value, -9);
  assert.equal(evaluate(compile("(-x)^2"), 3, 0).value, 9);
  assert.equal(evaluate(compile("1e-3 + .5"), 0, 0).value, 0.501);
  for (const s of [
    "x**2",
    "x^y",
    "x^-2",
    "x^9",
    "abs(x)",
    "x;alert(1)",
    "1e999",
    "sin x",
    "(".repeat(34) + "x" + ")".repeat(34),
  ])
    assert.throws(() => compile(s));
});
test("elementary functions have the expected local and total derivatives", () => {
  const cases = [
    ["sin(x)", Math.sin(0.7), Math.cos(0.7)],
    ["cos(x)", Math.cos(0.7), -Math.sin(0.7)],
    ["exp(x)", Math.exp(0.7), Math.exp(0.7)],
    ["log(x)", Math.log(0.7), 1 / 0.7],
    ["sqrt(x)", Math.sqrt(0.7), 0.5 / Math.sqrt(0.7)],
    ["x^0", 1, 0],
  ];
  for (const [source, value, derivative] of cases) {
    const r = evaluate(compile(source), 0.7, 2);
    near(r.value, value);
    near(r.gradient[0], derivative);
    assert.equal(r.gradient[1], 0);
  }
  const r = evaluate(compile("x/y"), 2, 4);
  near(r.gradient[0], 0.25);
  near(r.gradient[1], -0.125);
});
test("Rosenbrock gradients agree with symbolic derivatives at 300 points", () => {
  const c = compile(presets.valley.formula);
  for (let i = 0; i < 300; i++) {
    const x = -2 + (4 * i) / 299,
      y = -1 + (4 * ((i * 71) % 300)) / 299,
      r = evaluate(c, x, y);
    near(r.gradient[0], 2 * (x - 1) - 400 * x * (y - x * x));
    near(r.gradient[1], 200 * (y - x * x));
  }
});
test("composed gradients match independently differentiated expressions", () => {
  const c = compile("sin(x*y)+exp(x/3)+log(y^2+1)");
  for (let i = 0; i < 200; i++) {
    const x = -2 + (4 * i) / 199,
      y = -3 + (6 * ((i * 37) % 200)) / 199,
      r = evaluate(c, x, y);
    near(r.gradient[0], Math.cos(x * y) * y + Math.exp(x / 3) / 3);
    near(r.gradient[1], Math.cos(x * y) * x + (2 * y) / (y * y + 1));
  }
});
test("central differences report agreement and explicit unavailable probes", () => {
  const checks = numericalCheck(compile(presets.valley.formula), -1.2, 1);
  assert(checks.every((c) => c.scaledError < 1e-7));
  const edge = numericalCheck(compile("log(x)+y"), 1e-6, 0);
  assert.equal(edge[0].numeric, null);
  assert.match(edge[0].error, /positive/);
  near(edge[1].numeric, 1, 1e-4);
});
test("gradient descent on a quadratic follows its exact discrete recurrence", () => {
  const input = {
      ...example,
      formula: "x^2+y^2",
      x: 2,
      y: -3,
      rate: 0.1,
      steps: 12,
      tolerance: 1e-12,
    },
    r = optimize(compile(input.formula), input, "gradient");
  for (const s of r.trace) {
    near(s.x, 2 * 0.8 ** s.iteration);
    near(s.y, -3 * 0.8 ** s.iteration);
  }
});
test("momentum and bias-corrected Adam use their documented recurrences", () => {
  const input = {
      ...example,
      formula: "x^2+4*y^2",
      x: 2,
      y: 1,
      rate: 0.05,
      steps: 3,
      tolerance: 1e-12,
    },
    c = compile(input.formula),
    momentum = optimize(c, input, "momentum"),
    adam = optimize(c, input, "adam");
  let point = [2, 1],
    velocity = [0, 0];
  for (let i = 1; i <= 3; i++) {
    const g = [2 * point[0], 8 * point[1]];
    velocity = velocity.map((v, j) => 0.9 * v + g[j]);
    point = point.map((v, j) => v - 0.05 * velocity[j]);
    near(momentum.trace[i].x, point[0]);
    near(momentum.trace[i].y, point[1]);
  }
  near(adam.trace[1].x, 2 - (0.05 * 4) / (4 + 1e-8));
  near(adam.trace[1].y, 1 - (0.05 * 8) / (8 + 1e-8));
});
test("gradient clipping caps update norm but leaves raw gradient evidence intact", () => {
  const input = {
      ...example,
      formula: "x^2+y^2",
      x: 3,
      y: 4,
      rate: 0.1,
      clip: 2,
      steps: 1,
    },
    r = optimize(compile(input.formula), input, "gradient");
  near(r.trace[0].norm, 10);
  near(Math.hypot(r.trace[1].x - 3, r.trace[1].y - 4), 0.2);
});
test("stationary saddle is reported as gradient tolerance, never as a proven minimum", () => {
  const r = analyze({ ...example, ...presets.saddle });
  assert(
    r.runs.every(
      (run) =>
        run.trace.length === 1 && run.status === "Gradient tolerance reached",
    ),
  );
});
test("domain and divergence stops retain valid history and finite exports", () => {
  const input = {
      ...example,
      formula: "log(x)+y^2",
      x: 0.1,
      y: 0,
      rate: 1,
      steps: 4,
    },
    r = optimize(compile(input.formula), input, "gradient");
  assert.equal(r.status, "Numerical/domain stop");
  assert.equal(r.trace.length, 1);
  assert(r.failure.x < 0);
  const d = optimize(
    compile("1e6*x^8"),
    { ...example, x: 10, y: 0, rate: 1, steps: 4 },
    "gradient",
  );
  assert.equal(d.status, "Coordinate bound reached");
  assert.equal(d.trace.length, 1);
  for (const source of ["log(-1)", "sqrt(0)", "1/0", "exp(1000)"])
    assert.throws(() => evaluate(compile(source), 0, 0));
  const grid = surface(compile("log(x)"), [-1, 1, -1, 1], 8);
  assert.equal(grid.invalid, 32);
  assert.equal(grid.values.filter((v) => v === null).length, 32);
});
test("validation rejects nonfinite parameters and reports reproducible experiments", () => {
  for (const patch of [
    { x: Infinity },
    { steps: 2.5 },
    { rate: 0 },
    { bounds: [1, 1, -1, 1] },
    { clip: -1 },
    { tolerance: 0 },
  ])
    assert.throws(() => validate({ ...example, ...patch }));
  const input = { ...example, ...presets.bowl, steps: 20 };
  assert.deepEqual(analyze(input), analyze(input));
});
