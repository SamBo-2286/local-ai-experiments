# Two-PC Distributed Inference Cluster

Pooling two separate machines so a GPU-equipped PC can run models larger than its own VRAM
allows, by borrowing a second machine's spare RAM over the network via llama.cpp's RPC
backend.

## Overview

```
PC1 (i5, 32GB DDR4, GTX 1080 8GB)  ──wired gigabit──  PC2 (i7, 20GB DDR3, no GPU)
      runs llama-server                                    runs ggml-rpc-server
      (primary inference)                                  (RAM donor over RPC)
```

PC1's `llama-server` connects to PC2's RPC service and treats PC2's spare RAM as an
additional memory pool — letting PC1 load models that wouldn't otherwise fit in its own
GPU VRAM + system RAM.

## Tech stack

| Component | Role |
|---|---|
| llama.cpp (built with `-DGGML_RPC=ON`) | Inference engine + RPC backend, both machines |
| Ubuntu 24.04 | OS on both machines |
| systemd | Manages the RPC server as a persistent service on PC2 |
| Wired gigabit networking | Connects PC1 ↔ PC2 |

## Key engineering challenges

PC2's drive failed and needed a full rebuild, which turned into diagnosing five separate,
compounding problems in a single session. The real skill here wasn't any one fix — it was
correctly telling apart failures that could easily have been mistaken for each other.

### 1. Filesystem permissions from the rebuild
A botched `/` permissions issue from the drive rebuild had to be fixed before anything else on
PC2 would run correctly.

### 2. A missing build flag
PC2's `llama.cpp` build didn't include the RPC backend at all, because the build was missing
`-DGGML_RPC=ON`:

```bash
cmake -B build -DGGML_CUDA=ON -DGGML_RPC=ON
```

Found by checking what was actually present in the build output directory rather than
assuming the source itself was broken.

### 3. A renamed binary
The binary name had changed between the version originally documented and the version built
from current `master` — the systemd service was pointed at a path that no longer existed.
Fixed by locating the actual built binary and updating the service definition:

```ini
[Unit]
Description=llama.cpp RPC Server
After=network.target

[Service]
Type=simple
User=sam2
ExecStart=/home/sam2/llama.cpp/build/bin/ggml-rpc-server --host 0.0.0.0 --port 50052
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
```

### 4. A BIOS boot-order limitation
PC2's BIOS won't auto-boot to the rebuilt SSD — this was diagnosed as a hardware/firmware
limitation, not an OS misconfiguration, and documented as a known manual step (select the SSD
at the boot menu) rather than something to keep chasing as a "bug."

### 5. An RPC protocol version mismatch
Once networking and the binary were both fixed, PC1 could connect to PC2 — but crashed during
model warmup, not at connection time:

```
ggml-rpc.cpp:498: Remote RPC server crashed or returned malformed response
```

The crash happening specifically at warmup (when real tensor data first moves across the
connection), rather than at initial connection, pointed away from a networking problem and
toward a protocol-level one. Root cause: llama.cpp doesn't guarantee RPC wire-protocol
stability across versions, and PC1's `llama-server` was built weeks earlier than PC2's
freshly-built server — the two disagreed on message format. Fixed by rebuilding PC1 with the
same flags and an up-to-date version, so both sides spoke the same protocol version.

## Outcome

Fully working cluster, confirmed via PC1's own log output:

```
RPC0    : 10.0.0.2:50052 (19452 MiB, 19452 MiB free)
```

PC1 successfully connected to PC2's RPC server and reported **~19GB of additional pooled
memory**, alongside its own 7.2GB free VRAM and 32GB system RAM — verified running stably
for 15+ minutes under load with clean reload behavior afterward.

This meaningfully expands what PC1 can run: 20–34B models now fit that didn't fit locally
before. The understood tradeoff is that RPC-hosted layers add per-token network latency — a
**capacity win, not a speed win** — since every layer living on PC2 requires a network
round-trip per token over the wired link.

## Lessons learned

- **A crash location tells you where to look.** The RPC crash happening at warmup rather than
  connection time was the key clue that ruled out a networking explanation and pointed
  straight at a protocol mismatch.
- **Pin build versions across distributed nodes from the start.** Protocol drift between
  nodes is a known class of distributed-systems bug and is preventable by process (a shared
  build script or pinned commit) rather than something to just fix after the fact.

## Skills demonstrated

Systematic troubleshooting across compounding, unrelated failures · understanding distributed
systems tradeoffs (capacity vs. latency) · Linux service management (systemd) · reading crash
logs to correctly localize a fault before attempting a fix · documentation discipline
(capturing fixes for future reference rather than just moving on)
