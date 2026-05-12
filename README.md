# Io Dev Container

A [Dev Container](https://containers.dev/) for experimenting with the [Io programming language](https://iolanguage.org/) — no local setup required.

## What is Io?

Io is a small, prototype-based language inspired by Smalltalk, Self, and Lisp. Everything is an object, and computation happens entirely through message passing. It's worth a look if you're curious about how far that idea can be taken.

```io
"Hello, World!" println
```

## What's inside

| Component | Details |
|---|---|
| Io (CLI) | Built from source, runs via [wasmtime](https://wasmtime.dev/) as a WebAssembly binary |
| Io (browser REPL) | Served at `http://localhost:8000`, opens automatically on container start |
| [WASI SDK](https://github.com/WebAssembly/wasi-sdk) v33 | Used to compile Io to WASM |
| VS Code extensions | C/C++ tools, WebAssembly language support |
| Node.js / npm | |

## Getting started

### Prerequisites

- [Docker](https://www.docker.com/)
- [VS Code](https://code.visualstudio.com/) with the [Dev Containers extension](https://marketplace.visualstudio.com/items?itemName=ms-vscode-remote.remote-containers)

### Open in Dev Container

1. Clone this repository
2. Open the folder in VS Code
3. When prompted, click **Reopen in Container** (or run `Dev Containers: Reopen in Container` from the command palette)

Or open it with [DevPod](https://devpod.sh/) for a IDE-agnostic alternative.

The browser REPL starts automatically and opens at `http://localhost:8000`.

## Usage

**Browser REPL** — open `http://localhost:8000` in your browser and start typing Io code.

**CLI** — open a terminal inside the container:

```sh
io
```

```io
Io> 2 + 2
==> 4
Io> list(1, 2, 3) select(x, x > 1) println
==> list(2, 3)
```

**Run a file:**

```sh
io hello.io
```

## License

[MIT](LICENSE)
