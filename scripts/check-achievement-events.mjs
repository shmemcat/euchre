// Compare browser and server achievement credit for every seat in legal games.
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { stripTypeScriptTypes } from "node:module";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const moduleUrl = (source) =>
  "data:text/javascript;base64," + Buffer.from(source).toString("base64");
const engineUrl = moduleUrl(
  stripTypeScriptTypes(
    await readFile(resolve(root, "web/src/game/engine.ts"), "utf8")
  )
);
const engine = await import(engineUrl);
const source = stripTypeScriptTypes(
  await readFile(resolve(root, "web/src/lib/achievementEvents.ts"), "utf8")
);
const { gameAchievementEvidence } = await import(
  moduleUrl(source.replace('"@/game/engine"', JSON.stringify(engineUrl)))
);
let seed = 20261025;
const rng = () =>
  (seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32;
const cases = [];
for (let trial = 0; trial < 120; trial++) {
  let game = engine.newGame("easy", "You", rng);
  let moves = 0;
  while (game.phase !== "game_over" && moves++ < 1500) {
    const actions = engine.legalActions(game);
    game = engine.applyAction(
      game,
      actions[Math.floor(rng() * actions.length)],
      rng
    );
  }
  assert.equal(game.phase, "game_over");
  if (trial % 10 === 0) game.conceded = true;
  for (let seat = 0; seat < 4; seat++) {
    const expected = gameAchievementEvidence(game, seat);
    expected.calledSuits.sort();
    cases.push({ game, seat, expected });
  }
}
const python =
  process.env.EUCHRE_PYTHON ||
  resolve(
    root,
    "api",
    process.platform === "win32"
      ? ".venv/Scripts/python.exe"
      : ".venv/bin/python"
  );
const result = spawnSync(
  python,
  [
    "-c",
    `import json, sys
from euchre_server.achievements import game_evidence
json.dump([game_evidence(c['game'], c['seat']) for c in json.load(sys.stdin)], sys.stdout)
`,
  ],
  {
    cwd: resolve(root, "api"),
    input: JSON.stringify(cases),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
    windowsHide: true,
  }
);
if (result.error) throw result.error;
assert.equal(result.status, 0, result.stderr);
const actual = JSON.parse(result.stdout);
for (let index = 0; index < cases.length; index++) {
  assert.deepEqual(
    actual[index],
    cases[index].expected,
    `Achievement credit in game ${Math.floor(index / 4)}, seat ${
      cases[index].seat
    }`
  );
}
console.log(
  `${cases.length} browser/server achievement evaluations matched across 120 complete games and all four seats.`
);
