FROM mcr.microsoft.com/devcontainers/typescript-node

ARG WASI_SDK_VERSION=33

ENV DEBIAN_FRONTEND=noninteractive
ENV WASI_SDK_ROOT=/opt/wasi-sdk
ENV IO_HOME=/opt/io

USER root

RUN apt-get update \
 && apt-get install -y --no-install-recommends \
    build-essential \
    clang \
    llvm \
    pkg-config \
    python3 \
 && rm -rf /var/lib/apt/lists/*

# wasi-sdk
RUN ARCH=$(uname -m) \
 && WASI_TARBALL="wasi-sdk-${WASI_SDK_VERSION}.0-${ARCH}-linux" \
 && curl -fsSL "https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/${WASI_TARBALL}.tar.gz" -o /tmp/wasi-sdk.tar.gz \
 && tar -xzf /tmp/wasi-sdk.tar.gz -C /opt \
 && mv "/opt/${WASI_TARBALL}" "${WASI_SDK_ROOT}" \
 && rm /tmp/wasi-sdk.tar.gz

ENV PATH="${WASI_SDK_ROOT}/bin:${PATH}"

# wasmtime - latest release, direct binary download (no curl|bash)
RUN ARCH=$(uname -m) \
 && WT_VER=$(curl -fsSL -o /dev/null -w '%{url_effective}' \
             'https://github.com/bytecodealliance/wasmtime/releases/latest' \
             | grep -oE '[0-9]+\.[0-9]+\.[0-9]+') \
 && curl -fsSL "https://github.com/bytecodealliance/wasmtime/releases/download/v${WT_VER}/wasmtime-v${WT_VER}-${ARCH}-linux.tar.gz" \
    | tar -xz --strip-components=1 -C /usr/local/bin "wasmtime-v${WT_VER}-${ARCH}-linux/wasmtime"

# clone io
# TODO: pin IO_COMMIT to a specific git hash for reproducible builds
RUN git clone https://github.com/IoLanguage/io.git ${IO_HOME}

WORKDIR ${IO_HOME}

RUN git config --global url."https://github.com/".insteadOf git@github.com: \
 && git submodule sync --recursive \
 && git submodule update --init --recursive

ENV IO_CFLAGS="-I ./deps/parson \
-I ./deps/libtommath \
-DLTM_ISO_C99 \
-D__STDC_IEC_559__=1 \
-I./libs/garbagecollector/source \
-I./libs/basekit/source \
-I./libs/iovm/source \
-I ./libs/basekit/source/simd_cph/include \
-Wno-incompatible-pointer-types"

RUN make -j$(nproc) CFLAGS="${IO_CFLAGS}"
RUN make browser CFLAGS="${IO_CFLAGS}"

# io_static is a WASI binary produced by wasi-sdk, runnable via wasmtime
RUN printf '#!/bin/bash\nwasmtime /opt/io/build/bin/io_static "$@"\n' > /usr/local/bin/io \
 && chmod +x /usr/local/bin/io

RUN chown -R node:node ${IO_HOME}

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

USER node

ENTRYPOINT ["/entrypoint.sh"]
