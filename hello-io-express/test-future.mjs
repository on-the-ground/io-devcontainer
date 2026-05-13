/**
 * 핵심 검증 테스트: JS Promise → IoFuture → actor chain
 *
 * test-future.io에 Lobby 메서드로 정의된 테스트를 이름으로 호출한다.
 * 각 메서드의 마지막 표현식 값이 "==> value"로 캡처되어 기대값과 비교된다.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { loadIo, ioEval } from "./io-bridge.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const WASM = "/opt/io/browser/io_browser.wasm";
const PASS = "\x1b[32mPASS\x1b[0m";
const FAIL = "\x1b[31mFAIL\x1b[0m";

async function test(label, methodName, expected) {
	const result = await ioEval(methodName);
	const actual = result.output.trim().replace(/^==> /, "");
	const ok = actual === expected;
	console.log(`${ok ? PASS : FAIL} ${label}`);
	if (!ok) {
		console.log(`     expected: ${JSON.stringify(expected)}`);
		console.log(`     actual:   ${JSON.stringify(actual)}`);
		console.log(`     status:   ${result.status}`);
	}
}

await loadIo(WASM);
console.log("Io VM loaded.\n");

// Load all test methods into the Io VM
const testIo = readFileSync(join(__dirname, "test-future.io"), "utf8");
const { status, output } = await ioEval(testIo);
if (status !== 0) {
	console.error("Failed to load test-future.io:", output);
	process.exit(1);
}
console.log("test-future.io loaded.\n");

await test("순수 Io FutureProxy (@actor) — f println",                             "test_pureFutureProxy",       "42");
await test("JS Promise.resolve(string) → result await println",                    "test_promiseResolveString",  "hello from promise");
await test("JS Promise.resolve(list) → result await size println",                 "test_promiseResolveListSize","3");
await test("[핵심] domain @handler → JS Promise.resolve → 결과 역전파",            "test_actorJsPromiseChain",   "handled: hello");
await test("[핵심] 지연 Promise (setTimeout 10ms) → actor chain",                  "test_delayedPromise",        "42");
await test("JS Promise.reject → try/catch → e.error 추출",                        "test_promiseReject",         "caught: Future rejected: async boom");
await test("[핵심] actor @ + JS Promise.reject → actor 내부 처리 → 에러 마커 역전파", "test_actorReject",        "ERR:Future rejected: actor failed");

console.log("\nDone.");
