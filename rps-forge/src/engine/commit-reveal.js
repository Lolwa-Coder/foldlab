// Commit-reveal: makes simultaneous secret throws provably fair with NO referee.
//
// The problem in a serverless / P2P game: if I just send you my hand, a hacked
// client could wait to see yours first. Commit-reveal fixes this without a
// trusted server:
//
//   1. Each player sends  hash(choice + secret nonce)   -> the commitment.
//      The hash hides the choice but locks it in (you can't change it later).
//   2. After BOTH commitments are exchanged, each player reveals choice + nonce.
//   3. Each side verifies the other's reveal hashes to the commitment it saw.
//
// Nobody can peek, and nobody can change their throw after seeing the opponent's.
//
// Uses Web Crypto (globalThis.crypto.subtle), which exists in browsers AND in
// Node 18+ — same code both places, zero dependencies.

const subtle = globalThis.crypto.subtle;

function toHex(buffer) {
  return [...new Uint8Array(buffer)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Cryptographically-random nonce so commitments can't be brute-forced. */
export function makeNonce() {
  const a = new Uint8Array(16);
  globalThis.crypto.getRandomValues(a);
  return toHex(a.buffer);
}

/** Produce a commitment hash for a choice (e.g. "rock") + nonce. */
export async function commit(choice, nonce) {
  const data = new TextEncoder().encode(`${choice}:${nonce}`);
  const digest = await subtle.digest("SHA-256", data);
  return toHex(digest);
}

/** Verify a revealed (choice, nonce) matches a previously-seen commitment. */
export async function verify(commitment, choice, nonce) {
  return commitment === (await commit(choice, nonce));
}

/**
 * Convenience: create a sealed throw. Keep `nonce` secret until reveal time.
 * @returns {{ commitment: string, choice: string, nonce: string }}
 */
export async function sealThrow(choice) {
  const nonce = makeNonce();
  const commitment = await commit(choice, nonce);
  return { commitment, choice, nonce };
}
