/**
 * How many records a lineage tree holds before two share a slot.
 *
 * Slots are derived from the record commitment, which is what removes the need
 * for a registry to assign them — the best property this design has. The cost is
 * a birthday bound: with 2^DEPTH slots, a collision becomes likely at roughly
 * 2^(DEPTH/2) records, not 2^DEPTH.
 *
 * The consequence runs both ways and the second direction is worse. A record
 * whose slot is taken cannot be encumbered, because `encumber` asserts the slot
 * is clean. And it cannot prove clean either, because `proveAncestorClean`
 * asserts the slot holds the null leaf — so a record sharing a slot with someone
 * else's encumbered record reports as carrying an obligation it never had. For a
 * contract that exists to answer "is this free of upstream claims", that is a
 * false yes-it-is-encumbered, and it blocks a sale that should have gone through.
 *
 *   node contract/slot-capacity.mjs
 */
import { createHash } from 'node:crypto';

// The commitment as the circuit computes it: persistentHash over a padded domain
// separator and the secret. SHA-256 here stands in for the field hash — what
// matters is that the output is uniform, which is the assumption the slot
// derivation rests on.
const commit = (i) => createHash('sha256').update(`veilcore:commit:${i}`).digest();

const slotOf = (c, depth) => {
  let bits = 0n;
  for (let i = 0; i < depth; i++) bits = (bits << 1n) | BigInt(c[i] > 127 ? 1 : 0);
  return bits;
};

const firstCollision = (depth, limit) => {
  const seen = new Set();
  for (let i = 0; i < limit; i++) {
    const slot = slotOf(commit(i), depth);
    if (seen.has(slot)) return i + 1;
    seen.add(slot);
  }
  return null;
};

console.log('depth   slots          first collision   predicted (~1.18·√slots)');
console.log('-----   ------------   ---------------   ------------------------');
for (const depth of [8, 12, 16, 20, 24, 28, 32]) {
  const slots = 2 ** depth;
  const predicted = Math.round(1.1774 * Math.sqrt(slots));
  const limit = Math.min(400000, predicted * 6);
  const actual = firstCollision(depth, limit);
  console.log(
    `${String(depth).padStart(5)}   ${String(slots).padStart(12)}   ` +
    `${String(actual ?? `>${limit}`).padStart(15)}   ${String(predicted).padStart(24)}`,
  );
}

console.log(`
Each level costs one hash per fold, and encumber and discharge fold twice, so
depth is paid for in proving time on every write. The generator caps at 32
because the slot derivation takes one byte per level and a commitment is 32
bytes; past that the tree cannot be addressed from the commitment alone.

None of these is unbounded. Registry-free slot assignment is bought with a
birthday bound, and the right depth is a decision about how many records a
deployment expects — not a default to inherit.
`);
