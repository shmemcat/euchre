// Compare the browser rules with the shared service using actual legal games.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { transform } from "../web/node_modules/esbuild/lib/main.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const source = await readFile(resolve(root, "web/src/game/engine.ts"), "utf8");
const compiled = await transform(source, { loader: "ts", format: "esm" });
const engine = await import(
  "data:text/javascript;base64," + Buffer.from(compiled.code).toString("base64")
);
let seed = 20261021;
const rng = () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
  return seed / 2 ** 32;
};
const normalize = (game) => {
  const result = structuredClone(game);
  delete result.message;
  delete result.finishedAt;
  return result;
};
const cases = [];
for (let hand = 0; hand < 60; hand++) {
  let game = engine.newGame("medium", "You", rng);
  game.scores = [hand % 2 ? 9 : 0, hand % 3 ? 9 : 0];
  for (let step = 0; step < 80; step++) {
    const actions = engine.legalActions(game);
    if (!actions.length || game.phase === "round_complete") break;
    const action = actions[Math.floor(rng() * actions.length)];
    const next = engine.applyAction(game, action, rng);
    if (next.handNumber === game.handNumber)
      cases.push({ game, action, expected: normalize(next) });
    game = next;
  }
}
// Exercise every dealer, including wraparound, and legacy saved state. A shared
// deterministic shuffle lets us compare the full newly dealt hands as well.
for (const legacy of [false, true]) {
  for (let dealer = 0; dealer < 4; dealer++) {
    let game = engine.newGame("medium", "You", rng);
    Object.assign(game, { dealer, turn: (dealer + 1) % 4, scores: [3, 5] });
    if (legacy) delete game.consecutivePassOuts;
    for (let hand = 0; hand < 4; hand++) {
      for (let step = 0; step < 9; step++) {
        const action = { type: step === 8 ? "advance" : "pass" };
        const next = engine.applyAction(game, action, () => 0.5);
        cases.push({
          game,
          action,
          deterministicDeal: true,
          expected: normalize(next),
        });
        game = next;
      }
    }
  }
}
const api = resolve(root, "../hearts/api");
const python =
  process.env.HEARTS_PYTHON ||
  resolve(
    api,
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python"
  );
const code = `import json, sys
from hearts.euchre_engine import apply_action
class BrowserRandom:
    def shuffle(self, cards):
        for i in range(len(cards) - 1, 0, -1):
            j = int(0.5 * (i + 1))
            cards[i], cards[j] = cards[j], cards[i]
results = []
for case in json.load(sys.stdin):
    result = apply_action(case['game'], case['action'], BrowserRandom() if case.get('deterministicDeal') else None)
    result.pop('message', None)
    result.pop('finishedAt', None)
    results.append(result)
json.dump(results, sys.stdout)
`;
const result = spawnSync(python, ["-c", code], {
  cwd: api,
  input: JSON.stringify(cases),
  encoding: "utf8",
  maxBuffer: 32 * 1024 * 1024,
  windowsHide: true,
  env: { ...process.env, DATABASE_URL: "sqlite://" },
});
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr);
const actual = JSON.parse(result.stdout);
for (let i = 0; i < cases.length; i++)
  assert.deepEqual(
    actual[i],
    cases[i].expected,
    `Transition ${i}: ${cases[i].game.phase} / ${JSON.stringify(
      cases[i].action
    )}`
  );
console.log(
  `${cases.length} browser/server rule transitions matched, including pass-out summaries, redeals, dealer rotation, lone hands, bowers, scoring and game completion.`
);
