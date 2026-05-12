FROM ubuntu:24.04

ENV DEBIAN_FRONTEND=noninteractive
ENV WASI_SDK_VERSION=33
ENV ARCH=x86_64
ENV OS=linux
ENV WASI_SDK_ROOT=/root/wasi-sdk
ENV IO_HOME=/opt/io

RUN rm -rf /var/lib/apt/lists/* \
 && apt-get clean \
 && apt-get update --fix-missing \
 && apt-get install -y --no-install-recommends \
    build-essential \
    git \
    curl \
    wget \
    ca-certificates \
    clang \
    llvm \
    pkg-config \
    python3 \
 && rm -rf /var/lib/apt/lists/*

# wasi-sdk
RUN wget https://github.com/WebAssembly/wasi-sdk/releases/download/wasi-sdk-${WASI_SDK_VERSION}/wasi-sdk-${WASI_SDK_VERSION}.0-${ARCH}-${OS}.tar.gz \
 && tar -xzf wasi-sdk-${WASI_SDK_VERSION}.0-${ARCH}-${OS}.tar.gz \
 && mv wasi-sdk-${WASI_SDK_VERSION}.0-${ARCH}-${OS} ${WASI_SDK_ROOT} \
 && rm wasi-sdk-${WASI_SDK_VERSION}.0-${ARCH}-${OS}.tar.gz

ENV PATH="${WASI_SDK_ROOT}/bin:${PATH}"

# wasmtime
RUN curl https://wasmtime.dev/install.sh -sSf | bash


# clone io
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

RUN make -j$(nproc) CFLAGS="${IO_CFLAGS}" || true
RUN make browser CFLAGS="${IO_CFLAGS}"

# convenient launcher
RUN printf '#!/bin/bash\nwasmtime /opt/io/build/bin/io_static "$@"\n' > /usr/local/bin/io \
 && chmod +x /usr/local/bin/io

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
