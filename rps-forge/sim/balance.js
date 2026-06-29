// Node entry point (works if you ever install Node; not required — the browser
// harness at sim.html runs the same logic with no toolchain at all).
//   node sim/balance.js
import { runBalance } from "./balance-core.js";
runBalance(console.log, 4000);
