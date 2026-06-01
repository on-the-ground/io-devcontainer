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
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadIo, ioCall, closeIo } from "@on-the-ground/io-nodejs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM_PATH = "/opt/io/browser/io_browser.wasm";
const DOMAIN_PATH = join(__dirname, "domain.io");

async function main() {
	// --- Bootstrap Io VM ---
	console.log("Loading Io VM from", WASM_PATH);
	await loadIo(WASM_PATH, {
		ioFiles: [DOMAIN_PATH],
	});
	console.log("Io VM initialized.");

	// --- Express adapter ---
	const app = express();

	// GET /hello — delegates to Io domain logic via standard Bridge.md JS API:
	//   lobby.hello() → sends "hello" message to Io, returns the greeting string
	app.get("/hello", (req, res) => ioCall("hello")
		.then((message) => res.json({ message }))
	);

	app.get("/99bottles", (req, res) => ioCall("99bottles")
		.then((message) => res.json({ message }))
	);

	const server = app.listen(3000, () => {
		console.log("Express listening on http://localhost:3000");
		console.log("Try: curl http://localhost:3000/hello");
	});

	const shutdown = () => {
		server.closeAllConnections();
		server.close(async () => {
			await closeIo();
			process.exit(0);
		});
	};

	process.on("SIGTERM", shutdown);
	process.on("SIGINT", shutdown);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
