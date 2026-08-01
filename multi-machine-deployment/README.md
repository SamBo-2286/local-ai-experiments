# Multi-Machine AI Deployment — Old & Non-Native Hardware

Getting a local AI assistant (Odysseus) running reliably across multiple machines that
weren't originally set up for it — including a Mac running Ubuntu entirely from an external
drive, with its native macOS install never touched.

## Overview

Rather than requiring dedicated hardware, the assistant runs from a portable external drive
that can move between physical machines:

```
External SSD (Ubuntu 24.04 + Ollama + Odysseus)
        │
        ├── boots on: repurposed CPU-only PC (i5-7400, 32GB RAM, no GPU)
        └── boots on: Mac (via external boot, native macOS untouched)
```

## Tech stack

| Component | Role |
|---|---|
| Ubuntu 24.04 | Installed to and booted from external/USB drives |
| Ollama | Local inference, model choice tuned per machine's real specs |
| Odysseus | The assistant itself, running identically across machines |
| Gmail API | Productivity integration |

## Key engineering challenges

### 1. A boot-security limitation, not a user error

Getting a Mac to boot from an external Ubuntu drive first required determining whether the
machine has Apple's **T2 security chip**, which restricts external booting by default.
Machines without it can boot an external drive immediately by holding Option (⌥) at startup;
machines with it need the security policy unlocked in Recovery Mode first. Diagnosing which
category a given Mac falls into — rather than assuming one universal set of steps — was the
actual troubleshooting step here.

### 2. Storage planning under a full "wrong" partition

A model download failed partway through:

```
no space left on device
```

The instinct might be to assume the external drive itself was too small. Checking `df -h`
showed the real situation: the system partition (`/cow`) was 100% full at 3.9GB, while the
actual external drive (`/dev/disk/by-label/writable`) had 864GB free — Ollama had simply been
defaulting to the wrong mount point. Fixed by explicitly redirecting model storage to the real
external volume:

```bash
sudo mkdir -p /media/ubuntu/writable/ollama
sudo OLLAMA_MODELS=/media/ubuntu/writable/ollama ollama pull tinyllama
```

### 3. Matching model choice to real hardware, not ideal hardware

For the CPU-only i5-7400 box, model recommendations were based on actual usable memory after
OS overhead (roughly 20–23GB usable out of 32GB) rather than simply picking "the best model
available" — CPU-only inference has fundamentally different constraints than a GPU box, and
model choice needs to reflect that rather than assuming more RAM automatically means a bigger
model is the right call.

## Outcome

Odysseus running reliably across multiple machines with very different hardware profiles,
including a Mac that never had its native OS touched — the entire assistant lives on a
portable external drive that can move to a different physical machine if needed, without
reinstalling anything.

## Lessons learned

- **Check the actual mount point before assuming a drive is too small.** The "no space left"
  error looked like a capacity problem; it was actually a misdirected default.
- **Security features that look like bugs are usually intentional.** The T2 chip's boot
  restriction isn't a fault to work around destructively — it's a real security boundary that
  needs a proper unlock step, diagnosed per-machine rather than assumed away.

## Skills demonstrated

Hardware-aware deployment decisions · working within vendor security restrictions without
destructive workarounds · diagnosing storage/mount-point issues from symptoms that look like a
different problem · portable, non-invasive system design (host machine's native OS left
untouched)
