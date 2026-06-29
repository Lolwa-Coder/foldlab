// Demonstrates the commit-reveal handshake end to end, including a cheat attempt
// that the protocol catches.  Run:  node sim/protocol-demo.js

import { sealThrow, commit, verify } from "../src/engine/commit-reveal.js";

console.log("Commit-reveal demo — fair simultaneous throws with no referee\n");

// --- Honest exchange -------------------------------------------------------
const alice = await sealThrow("rock");
const bob = await sealThrow("paper");

console.log("Phase 1 — exchange commitments (choices hidden):");
console.log("  Alice ->", alice.commitment.slice(0, 24) + "…");
console.log("  Bob   ->", bob.commitment.slice(0, 24) + "…");

console.log("\nPhase 2 — reveal (choice + nonce):");
console.log("  Alice reveals:", alice.choice);
console.log("  Bob   reveals:", bob.choice);

const aliceOk = await verify(bob.commitment, bob.choice, bob.nonce);
const bobOk = await verify(alice.commitment, alice.choice, alice.nonce);
console.log("\nVerification:");
console.log("  Alice verifies Bob :", aliceOk ? "OK" : "TAMPERED");
console.log("  Bob verifies Alice :", bobOk ? "OK" : "TAMPERED");

// --- Cheat attempt: Bob saw Alice threw rock and tries to switch to paper ---
console.log("\n--- Cheat attempt: Bob tries to swap his throw after seeing Alice ---");
const cheatCommit = bob.commitment; // he's locked into "paper" already
const switchedOk = await verify(cheatCommit, "paper", bob.nonce); // his real throw
const tamperedOk = await verify(cheatCommit, "scissors", bob.nonce); // pretends scissors
console.log("  Bob's real throw 'paper'    verifies:", switchedOk ? "OK" : "FAIL");
console.log("  Bob faking 'scissors'        verifies:", tamperedOk ? "OK (!!)" : "REJECTED");
console.log("\nThe commitment locks Bob in — he cannot change his throw after the reveal.\n");
