/** Bench raw keygen throughput (no vanity match). Run: deno task bench-keygen */
import { b58Pub32 } from "../src/b58.ts";
import { createKeygenEngine } from "../src/keygen.ts";

const BATCH = 64;
const pubs = new Uint8Array(BATCH * 32);
const secrets = new Uint8Array(BATCH * 64);

for (const mode of ["auto", "noble", "node"] as const) {
  const engine = await createKeygenEngine(mode, BATCH);
  if (engine.kind === "subtle") continue;

  Deno.bench({
    name: `${engine.kind} batch=${BATCH} + b58`,
    group: "keygen",
    fn() {
      engine.fillBatch(pubs, secrets);
      for (let i = 0; i < BATCH; i++) b58Pub32(pubs, i * 32);
    },
  });

  Deno.bench({
    name: `${engine.kind} batch=${BATCH} only`,
    group: "keygen",
    fn() {
      engine.fillBatch(pubs, secrets);
    },
  });
}
