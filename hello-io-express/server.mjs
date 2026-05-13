/**
 * Express adapter (hexagonal architecture — infrastructure layer)
 *
 * Responsibilities:
 *   - HTTP transport (Express)
 *   - Load Io VM and evaluate domain.io at startup
 *   - Delegate business logic to Io via io.lobby (standard Bridge.md JS API)
 *
 * Domain logic lives entirely in domain.io.
 */

import express from "express";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadIo, ioEval, io } from "./io-bridge.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH   = "/opt/io/browser/io_browser.wasm";
const DOMAIN_PATH = join(__dirname, "domain.io");

async function main() {
	// --- Bootstrap Io VM ---
	console.log("Loading Io VM from", WASM_PATH);
	await loadIo(WASM_PATH);
	console.log("Io VM initialized.");

	// Evaluate domain.io — registers Lobby hello method in the Io VM
	const domainCode = readFileSync(DOMAIN_PATH, "utf8");
	const { status, output } = await ioEval(domainCode);
	if (status !== 0) {
		console.error("Failed to load domain.io. status:", status, "output:", output);
		process.exit(1);
	}
	console.log("domain.io loaded.") //  status:", status, "output:", output);

	// --- Express adapter ---
	const app = express();

	// GET /hello — delegates to Io domain logic via standard Bridge.md JS API:
	//   io.lobby → Proxy wrapping the Io lobby
	//   lobby.hello() → sends "hello" message to Io, returns the greeting string
	app.get("/hello", (req, res) => {
		const greeting = io.lobby.hello();
		res.json({ message: greeting });
	});

	app.listen(3000, () => {
		console.log("Express listening on http://localhost:3000");
		console.log("Try: curl http://localhost:3000/hello");
	});
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
