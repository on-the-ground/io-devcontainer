/**
 * Io VM — Node.js WASM bridge
 *
 * Implements the standard Io↔JS bridge interface documented in:
 *   /opt/io/agents/wasm/Bridge.md
 *
 * WASM exports used (documented in Bridge.md § "WASM Exports"):
 *   _initialize, io_init, io_get_input_buf, io_get_input_buf_size,
 *   io_eval_input, io_get_output, io_get_output_len,
 *   io_get_bridge_buf, io_get_bridge_buf_size,
 *   io_send, io_release, io_get_lobby_handle,
 *   io_resolve_future, io_reject_future, io_resume_eval
 *
 * WASM imports provided (documented in Bridge.md § "WASM Imports"):
 *   js.js_get_global, js.js_call, js.js_get_prop, js.js_set_prop,
 *   js.js_call_func, js.js_typeof, js.js_new_function, js.js_release,
 *   js.js_watch_promise
 *   + wasi_snapshot_preview1.*
 */

import { readFileSync } from "node:fs";

// --- State ---

let wasm = null;
let memory = null;

// Callback set by ioEval when eval suspends waiting for a JS Promise (status=2).
// resumeIfAwaiting() delivers the final result once the Promise settles.
let pendingAsyncResolve = null;

// --- Handle table (Bridge.md § "Handle Tables / jsHandles") ---

const jsHandles = new Map();
let nextHandle = 1;

function registerHandle(obj) {
	if (obj == null) return 0;
	const h = nextHandle++;
	jsHandles.set(h, obj);
	return h;
}

function getHandle(h) {
	return jsHandles.get(h) ?? null;
}

function releaseHandle(h) {
	jsHandles.delete(h);
}

// --- String helpers ---

function readStringFromWasm(ptr, len) {
	return new TextDecoder().decode(new Uint8Array(memory.buffer, ptr, len));
}

function writeStringToWasm(bufPtr, maxLen, str) {
	const encoded = new TextEncoder().encode(str);
	const bytes = new Uint8Array(memory.buffer);
	const writeLen = Math.min(encoded.length, maxLen - 1);
	bytes.set(encoded.subarray(0, writeLen), bufPtr);
	bytes[bufPtr + writeLen] = 0;
	return writeLen;
}

function readCString(ptr) {
	const bytes = new Uint8Array(memory.buffer);
	let end = ptr;
	while (bytes[end] !== 0) end++;
	return new TextDecoder().decode(bytes.subarray(ptr, end));
}

function getMemoryView() {
	return new DataView(memory.buffer);
}

// --- WASI shim (wasi_snapshot_preview1) ---

let capturedOutput = "";

const wasi_snapshot_preview1 = {
	fd_write(fd, iovs_ptr, iovs_len, nwritten_ptr) {
		const view = getMemoryView();
		const bytes = new Uint8Array(memory.buffer);
		let totalWritten = 0;
		for (let i = 0; i < iovs_len; i++) {
			const base = view.getUint32(iovs_ptr + i * 8, true);
			const len  = view.getUint32(iovs_ptr + i * 8 + 4, true);
			const text = new TextDecoder().decode(bytes.subarray(base, base + len));
			if (fd === 1 || fd === 2) capturedOutput += text;
			totalWritten += len;
		}
		view.setUint32(nwritten_ptr, totalWritten, true);
		return 0;
	},
	fd_read(fd, iovs_ptr, iovs_len, nread_ptr) {
		getMemoryView().setUint32(nread_ptr, 0, true);
		return 0;
	},
	fd_close(fd) { return 0; },
	fd_seek(fd, offset_lo, offset_hi, whence, newoffset_ptr) {
		getMemoryView().setBigUint64(newoffset_ptr, 0n, true);
		return 0;
	},
	fd_fdstat_get(fd, buf) {
		const view = getMemoryView();
		view.setUint8(buf, fd <= 2 ? 2 : 4);
		view.setUint16(buf + 2, 0, true);
		view.setBigUint64(buf + 8, 0n, true);
		view.setBigUint64(buf + 16, 0n, true);
		return 0;
	},
	fd_fdstat_set_flags(fd, flags) { return 0; },
	fd_filestat_set_size(fd, size) { return 70; },
	fd_readdir(fd, buf, buf_len, cookie, bufused_ptr) {
		getMemoryView().setUint32(bufused_ptr, 0, true);
		return 0;
	},
	fd_renumber(fd, to) { return 70; },
	fd_prestat_get(fd, buf) { return 8; },
	fd_prestat_dir_name(fd, path, path_len) { return 8; },
	path_open() { return 76; },
	path_create_directory() { return 76; },
	path_filestat_get() { return 76; },
	path_remove_directory() { return 76; },
	path_rename() { return 76; },
	path_unlink_file() { return 76; },
	clock_time_get(clock_id, precision, time_ptr) {
		// Use process.hrtime.bigint() for nanosecond precision
		getMemoryView().setBigUint64(time_ptr, process.hrtime.bigint(), true);
		return 0;
	},
	environ_sizes_get(count_ptr, buf_size_ptr) {
		const view = getMemoryView();
		view.setUint32(count_ptr, 0, true);
		view.setUint32(buf_size_ptr, 0, true);
		return 0;
	},
	environ_get(environ_ptr, buf_ptr) { return 0; },
	args_sizes_get(argc_ptr, buf_size_ptr) {
		const view = getMemoryView();
		view.setUint32(argc_ptr, 0, true);
		view.setUint32(buf_size_ptr, 0, true);
		return 0;
	},
	args_get(argv_ptr, buf_ptr) { return 0; },
	proc_exit(code) { throw new Error(`Io called exit(${code})`); },
	poll_oneoff(in_ptr, out_ptr, nsubscriptions, nevents_ptr) {
		getMemoryView().setUint32(nevents_ptr, 0, true);
		return 0;
	},
};

// --- Binary serialization (Bridge.md § "Binary Serialization Format") ---

const TYPE_NIL        = 0;
const TYPE_TRUE       = 1;
const TYPE_FALSE      = 2;
const TYPE_NUMBER     = 3;
const TYPE_STRING     = 4;
const TYPE_ARRAY      = 5;
const TYPE_OBJECT     = 6;
const TYPE_JSREF      = 7;
const TYPE_IOREF      = 8;
const TYPE_ERROR      = 9;
const TYPE_UNDEFINED  = 10;
const TYPE_TYPEDARRAY = 11;
const TYPE_FUTURE     = 12;
const TYPE_BIGINT     = 13;

const TYPED_ARRAY_CTORS = [
	Uint8Array, Uint16Array, Uint32Array,
	Int8Array, Int16Array, Int32Array,
	Float32Array, Float64Array,
];
const TYPED_ARRAY_MAP = new Map(TYPED_ARRAY_CTORS.map((c, i) => [c, i]));

function getBridgeBuf() {
	return {
		ptr:  wasm.exports.io_get_bridge_buf(),
		size: wasm.exports.io_get_bridge_buf_size(),
	};
}

function serializeToWasm(val, buf, offset, visited) {
	if (val === null)      { buf[offset] = TYPE_NIL;       return offset + 1; }
	if (val === undefined) { buf[offset] = TYPE_UNDEFINED; return offset + 1; }
	if (val === true)      { buf[offset] = TYPE_TRUE;      return offset + 1; }
	if (val === false)     { buf[offset] = TYPE_FALSE;     return offset + 1; }

	if (typeof val === "number") {
		buf[offset] = TYPE_NUMBER;
		new DataView(buf.buffer, buf.byteOffset).setFloat64(offset + 1, val, true);
		return offset + 9;
	}

	if (typeof val === "string") {
		const enc = new TextEncoder().encode(val);
		buf[offset] = TYPE_STRING;
		new DataView(buf.buffer, buf.byteOffset).setUint32(offset + 1, enc.length, true);
		buf.set(enc, offset + 5);
		return offset + 5 + enc.length;
	}

	if (typeof val === "bigint") {
		const enc = new TextEncoder().encode(val.toString());
		buf[offset] = TYPE_BIGINT;
		new DataView(buf.buffer, buf.byteOffset).setUint32(offset + 1, enc.length, true);
		buf.set(enc, offset + 5);
		return offset + 5 + enc.length;
	}

	if (typeof val === "symbol") {
		throw new Error("bridge error: JS Symbol cannot cross the bridge");
	}

	if (ArrayBuffer.isView(val) && !(val instanceof DataView)) {
		const itemType = TYPED_ARRAY_MAP.get(val.constructor);
		if (itemType !== undefined) {
			const view = new DataView(buf.buffer, buf.byteOffset);
			buf[offset] = TYPE_TYPEDARRAY;
			buf[offset + 1] = itemType;
			view.setUint32(offset + 2, val.length, true);
			buf.set(new Uint8Array(val.buffer, val.byteOffset, val.byteLength), offset + 6);
			return offset + 6 + val.byteLength;
		}
	}

	if (!visited) visited = new Set();

	if (Array.isArray(val)) {
		if (visited.has(val)) throw new Error("bridge error: cyclic structure cannot be serialized");
		visited.add(val);
		buf[offset] = TYPE_ARRAY;
		new DataView(buf.buffer, buf.byteOffset).setUint32(offset + 1, val.length, true);
		let pos = offset + 5;
		for (const item of val) pos = serializeToWasm(item, buf, pos, visited);
		visited.delete(val);
		return pos;
	}

	if (val instanceof Map) {
		if (visited.has(val)) throw new Error("bridge error: cyclic structure cannot be serialized");
		visited.add(val);
		const entries = [...val.entries()];
		buf[offset] = TYPE_OBJECT;
		new DataView(buf.buffer, buf.byteOffset).setUint32(offset + 1, entries.length, true);
		let pos = offset + 5;
		for (const [k, v] of entries) {
			const keyEnc = new TextEncoder().encode(String(k));
			new DataView(buf.buffer, buf.byteOffset).setUint32(pos, keyEnc.length, true);
			pos += 4;
			buf.set(keyEnc, pos);
			pos += keyEnc.length;
			pos = serializeToWasm(v, buf, pos, visited);
		}
		visited.delete(val);
		return pos;
	}

	if (val instanceof Set) {
		if (visited.has(val)) throw new Error("bridge error: cyclic structure cannot be serialized");
		visited.add(val);
		const items = [...val];
		buf[offset] = TYPE_ARRAY;
		new DataView(buf.buffer, buf.byteOffset).setUint32(offset + 1, items.length, true);
		let pos = offset + 5;
		for (const item of items) pos = serializeToWasm(item, buf, pos, visited);
		visited.delete(val);
		return pos;
	}

	if (val != null && typeof val.then === "function") {
		buf[offset] = TYPE_FUTURE;
		new DataView(buf.buffer, buf.byteOffset).setInt32(offset + 1, registerHandle(val), true);
		return offset + 5;
	}

	// All other objects pass by reference (Bridge.md § "Passing Convention")
	buf[offset] = TYPE_JSREF;
	new DataView(buf.buffer, buf.byteOffset).setInt32(offset + 1, registerHandle(val), true);
	return offset + 5;
}

function deserializeFromWasm(buf, offset) {
	const type = buf[offset++];
	const view = new DataView(buf.buffer, buf.byteOffset);

	switch (type) {
	case TYPE_NIL:       return { value: null,      offset };
	case TYPE_TRUE:      return { value: true,      offset };
	case TYPE_FALSE:     return { value: false,     offset };
	case TYPE_UNDEFINED: return { value: undefined, offset };

	case TYPE_NUMBER: {
		const val = view.getFloat64(offset, true);
		return { value: val, offset: offset + 8 };
	}

	case TYPE_STRING: {
		const len = view.getUint32(offset, true);
		offset += 4;
		return { value: new TextDecoder().decode(buf.subarray(offset, offset + len)), offset: offset + len };
	}

	case TYPE_BIGINT: {
		const len = view.getUint32(offset, true);
		offset += 4;
		const str = new TextDecoder().decode(buf.subarray(offset, offset + len));
		return { value: BigInt(str), offset: offset + len };
	}

	case TYPE_ARRAY: {
		const count = view.getUint32(offset, true);
		offset += 4;
		const arr = [];
		for (let i = 0; i < count; i++) {
			const r = deserializeFromWasm(buf, offset);
			arr.push(r.value);
			offset = r.offset;
		}
		return { value: arr, offset };
	}

	case TYPE_OBJECT: {
		const count = view.getUint32(offset, true);
		offset += 4;
		const map = new Map();
		for (let i = 0; i < count; i++) {
			const klen = view.getUint32(offset, true);
			offset += 4;
			const key = new TextDecoder().decode(buf.subarray(offset, offset + klen));
			offset += klen;
			const r = deserializeFromWasm(buf, offset);
			map.set(key, r.value);
			offset = r.offset;
		}
		return { value: map, offset };
	}

	case TYPE_JSREF: {
		const h = view.getInt32(offset, true);
		return { value: getHandle(h), offset: offset + 4 };
	}

	case TYPE_IOREF: {
		const h = view.getInt32(offset, true);
		return { value: makeIoProxy(h), offset: offset + 4 };
	}

	case TYPE_TYPEDARRAY: {
		const itemType = buf[offset++];
		const count = view.getUint32(offset, true);
		offset += 4;
		const Ctor = TYPED_ARRAY_CTORS[itemType] ?? Uint8Array;
		const byteLen = count * Ctor.BYTES_PER_ELEMENT;
		const copy = new Uint8Array(byteLen);
		copy.set(buf.subarray(offset, offset + byteLen));
		return { value: new Ctor(copy.buffer, 0, count), offset: offset + byteLen };
	}

	case TYPE_ERROR: {
		const len = view.getUint32(offset, true);
		offset += 4;
		const msg = new TextDecoder().decode(buf.subarray(offset, offset + len));
		offset += len;
		let ioError = null;
		if (offset + 4 <= buf.length) {
			const errHandle = view.getInt32(offset, true);
			offset += 4;
			if (errHandle) ioError = makeIoProxy(errHandle);
		}
		const err = new Error(msg);
		if (ioError) err.ioError = ioError;
		return { value: err, offset };
	}

	default:
		return { value: null, offset };
	}
}

function serializeError(msg, originalError) {
	const { ptr, size } = getBridgeBuf();
	const buf = new Uint8Array(memory.buffer, ptr, size);
	const encoded = new TextEncoder().encode(msg);
	buf[0] = TYPE_ERROR;
	const view = new DataView(memory.buffer, ptr);
	view.setUint32(1, encoded.length, true);
	buf.set(encoded, 5);
	const errHandle = originalError != null ? registerHandle(originalError) : 0;
	view.setInt32(5 + encoded.length, errHandle, true);
	return -1;
}

// --- JS imports (Bridge.md § "WASM Imports") ---

const js = {
	js_call(handle, namePtr, nameLen, argc) {
		try {
			const obj = getHandle(handle);
			if (obj == null) return serializeError("js_call: invalid handle");

			const name = readStringFromWasm(namePtr, nameLen);
			const prop = obj[name];

			const { ptr, size } = getBridgeBuf();
			const buf = new Uint8Array(memory.buffer, ptr, size);

			const args = [];
			let offset = 0;
			for (let i = 0; i < argc; i++) {
				const r = deserializeFromWasm(buf, offset);
				args.push(r.value);
				offset = r.offset;
			}

			let result;
			if (argc > 0) {
				if (typeof prop !== "function") return serializeError(`${name} is not a function`);
				result = prop.apply(obj, args);
			} else {
				result = typeof prop === "function" ? prop.call(obj) : prop;
			}

			serializeToWasm(result, buf, 0);
			return 0;
		} catch (e) {
			return serializeError(e.message ?? String(e), e);
		}
	},

	js_get_prop(handle, namePtr, nameLen) {
		try {
			const obj = getHandle(handle);
			if (obj == null) return serializeError("js_get_prop: invalid handle");
			const name = readStringFromWasm(namePtr, nameLen);
			const { ptr, size } = getBridgeBuf();
			serializeToWasm(obj[name], new Uint8Array(memory.buffer, ptr, size), 0);
			return 0;
		} catch (e) {
			return serializeError(e.message ?? String(e), e);
		}
	},

	js_set_prop(handle, namePtr, nameLen) {
		try {
			const obj = getHandle(handle);
			if (obj == null) return;
			const name = readStringFromWasm(namePtr, nameLen);
			const { ptr, size } = getBridgeBuf();
			obj[name] = deserializeFromWasm(new Uint8Array(memory.buffer, ptr, size), 0).value;
		} catch (_) {}
	},

	js_call_func(handle, argc) {
		try {
			const fn = getHandle(handle);
			if (typeof fn !== "function") return serializeError("js_call_func: not a function");
			const { ptr, size } = getBridgeBuf();
			const buf = new Uint8Array(memory.buffer, ptr, size);
			const args = [];
			let offset = 0;
			for (let i = 0; i < argc; i++) {
				const r = deserializeFromWasm(buf, offset);
				args.push(r.value);
				offset = r.offset;
			}
			serializeToWasm(fn(...args), buf, 0);
			return 0;
		} catch (e) {
			return serializeError(e.message ?? String(e), e);
		}
	},

	js_typeof(handle, buf, sz) {
		return writeStringToWasm(buf, sz, typeof getHandle(handle));
	},

	js_get_global() {
		return registerHandle(globalThis);
	},

	js_release(h) {
		releaseHandle(h);
	},

	js_watch_promise(promiseHandle, futureIoHandle) {
		const promise = getHandle(promiseHandle);
		if (!promise || typeof promise.then !== "function") return;
		promise.then(
			(value) => {
				const { ptr, size } = getBridgeBuf();
				serializeToWasm(value, new Uint8Array(memory.buffer, ptr, size), 0);
				wasm.exports.io_resolve_future(futureIoHandle);
				resumeIfAwaiting();
			},
			(error) => {
				const { ptr, size } = getBridgeBuf();
				const msg = error instanceof Error ? error.message : String(error);
				serializeToWasm(msg, new Uint8Array(memory.buffer, ptr, size), 0);
				wasm.exports.io_reject_future(futureIoHandle);
				resumeIfAwaiting();
			}
		);
	},

	js_new_function(codePtr, codeLen) {
		try {
			const code = readStringFromWasm(codePtr, codeLen);
			return registerHandle(new Function(code));
		} catch (e) {
			serializeError(e.message ?? String(e), e);
			return 0;
		}
	},
};

// --- Async eval resume (Bridge.md § "Async / Promises") ---

// Called from js_watch_promise after a Promise settles and io_resolve/reject_future fires.
// Drives io_resume_eval until the suspended eval session completes or awaits again.
function resumeIfAwaiting() {
	if (!wasm) return;
	const status = wasm.exports.io_resume_eval();
	if (status === 2) return; // still awaiting another Promise — next settle will resume again

	const outPtr = wasm.exports.io_get_output();
	const outLen = wasm.exports.io_get_output_len();
	let output = outLen > 0 ? readCString(outPtr) : "";
	if (capturedOutput) { output = capturedOutput + output; capturedOutput = ""; }

	if (pendingAsyncResolve) {
		const resolve = pendingAsyncResolve;
		pendingAsyncResolve = null;
		resolve({ status, output });
	}
}

// --- IoProxy factory (Bridge.md § "JS API") ---

const ioProxyRegistry = typeof FinalizationRegistry !== "undefined"
	? new FinalizationRegistry((h) => { if (wasm?.exports.io_release) wasm.exports.io_release(h); })
	: null;

function makeIoProxy(ioHandle) {
	const fn = function() {};
	fn.__ioHandle = ioHandle;
	const proxy = new Proxy(fn, {
		get(target, prop) {
			if (prop === "__ioHandle") return target.__ioHandle;
			if (prop === Symbol.toPrimitive || prop === "valueOf" || prop === "toString")
				return () => `[IoObject handle=${target.__ioHandle}]`;
			return (...args) => ioSend(target.__ioHandle, String(prop), ...args);
		},
		set(target, prop, value) {
			ioSend(target.__ioHandle, "setSlot", String(prop), value);
			return true;
		},
		apply(target, thisArg, args) {
			return ioSend(target.__ioHandle, "call", ...args);
		},
	});
	ioProxyRegistry?.register(proxy, ioHandle);
	return proxy;
}

function ioSend(ioHandle, messageName, ...args) {
	if (!wasm) throw new Error("Io VM not loaded");

	const { ptr, size } = getBridgeBuf();
	const buf = new Uint8Array(memory.buffer, ptr, size);

	let offset = 0;
	for (const arg of args) offset = serializeToWasm(arg, buf, offset);

	const inputBufPtr = wasm.exports.io_get_input_buf();
	const nameEncoded = new TextEncoder().encode(messageName);
	new Uint8Array(memory.buffer, inputBufPtr, nameEncoded.length).set(nameEncoded);

	const status = wasm.exports.io_send(ioHandle, inputBufPtr, nameEncoded.length, args.length);

	const resultBuf = new Uint8Array(memory.buffer, ptr, size);
	const { value } = deserializeFromWasm(resultBuf, 0);

	if (status !== 0) {
		if (value instanceof Error) throw value;
		throw new Error("Io message send failed");
	}
	return value;
}

// --- Public API (Bridge.md § "JS API") ---

export const io = {
	get lobby() {
		if (!wasm) throw new Error("Io VM not loaded");
		return makeIoProxy(wasm.exports.io_get_lobby_handle());
	},
	send(handle, msg, ...args) {
		return ioSend(handle.__ioHandle ?? handle, msg, ...args);
	},
};

/**
 * Load and initialize the Io VM from a WASM file path.
 * Must be called once before using io.lobby.
 */
export async function loadIo(wasmPath) {
	const bytes = readFileSync(wasmPath);
	const { instance } = await WebAssembly.instantiate(bytes, { wasi_snapshot_preview1, js });
	wasm = instance;
	memory = wasm.exports.memory;

	if (wasm.exports._initialize) wasm.exports._initialize();
	wasm.exports.io_init();
}

/**
 * Evaluate a string of Io code.
 * Returns { status, output } for synchronous completion.
 * Returns Promise<{ status, output }> when eval suspends on a JS Promise (status=2).
 */
export function ioEval(code) {
	if (!wasm) throw new Error("Io VM not loaded");

	const inputBufPtr  = wasm.exports.io_get_input_buf();
	const inputBufSize = wasm.exports.io_get_input_buf_size();
	const encoded = new TextEncoder().encode(code);

	if (encoded.length >= inputBufSize)
		return { status: -1, output: `Error: input too long (max ${inputBufSize - 1} bytes)` };

	const bytes = new Uint8Array(memory.buffer);
	bytes.set(encoded, inputBufPtr);
	bytes[inputBufPtr + encoded.length] = 0;

	capturedOutput = "";
	const status = wasm.exports.io_eval_input();

	// status=2 means the eval loop hit FRAME_STATE_AWAIT_JS — suspended on a JS Promise.
	// resumeIfAwaiting() will be called by js_watch_promise when the Promise settles.
	if (status === 2) {
		return new Promise((resolve) => { pendingAsyncResolve = resolve; });
	}

	const outPtr = wasm.exports.io_get_output();
	const outLen = wasm.exports.io_get_output_len();
	let output = outLen > 0 ? readCString(outPtr) : "";
	if (capturedOutput) { output = capturedOutput + output; capturedOutput = ""; }

	return { status, output };
}
