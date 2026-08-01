# Local AI Experiments

A collection of local-first AI infrastructure projects — all running on consumer hardware,
with no cloud APIs and no managed services. I'm building this out while learning Linux
systems administration and local AI deployment, largely by hitting real problems and
documenting how I found and fixed them.

Background: self-taught starting from hands-on hardware experience (retail computer sales),
some formal CS coursework, and a lot of trial-and-error on my own homelab since. Everything
below is real, working infrastructure I run day to day — not tutorials I followed.

## Hardware

| Machine | Specs | Role |
|---|---|---|
| PC1 | i5, 32GB DDR4, GTX 1080 8GB | Primary inference machine |
| PC2 | i7, 20GB DDR3, no GPU | RAM/RPC donor, secondary services |
| Mac (external boot) | — | Portable Ubuntu install, runs assistant from external SSD |

Both primary machines run Ubuntu 24.04 with Docker.

## Projects

| Project | What it does | Key challenge solved |
|---|---|---|
| [SAM AI Pipeline](./sam-ai-pipeline/) | Six-model local pipeline that turns a plain-English request into planned, written, tested, and human-approved code | Three stacked silent failures (regex, templating engine mismatch, SSH heredoc) that each "succeeded" without throwing an error |
| [Hermes Agent Stack](./hermes-agent-stack/) | Local autonomous agent with persistent cross-session memory and sandboxed execution | Diagnosed silent config-schema drift in a forked service by introspecting the live running config, not guessing at a typo |
| [Two-PC Cluster](./two-pc-cluster/) | Pools a second machine's RAM over the network so a GPU box can run models bigger than its own VRAM | Told apart five compounding failures (permissions, build flags, a renamed binary, BIOS limits, an RPC protocol mismatch) in one rebuild session |
| [Jarvis Assistant](./jarvis-assistant/) | Fully local voice + Telegram assistant, CPU-only, with fast/slow task routing | Recognized a model-specific misbehavior (not a prompt problem) and swapped models instead of continuing to patch the prompt |
| [Multi-Machine Deployment](./multi-machine-deployment/) | Runs the same assistant identically across different, non-dedicated hardware — including a Mac booted entirely from an external drive | Diagnosed a "disk full" error down to a wrong default mount point, and worked within (not around) Apple's T2 boot security |

Each project README follows the same shape: what I was trying to do, the tech stack, the
specific problems I ran into and how I actually diagnosed them (not just the fix), the
outcome, and what I'd take into the next project.

## Note on images

Screenshots and terminal output for these projects are being added incrementally — some
already exist and are being slotted in, others are being recreated and captured fresh. The
write-ups reflect real sessions either way.

## Skills across this portfolio

Systematic debugging of silent (non-erroring) failures · Linux service management
(`systemd --user`) · Docker-based sandboxing and containerized services · distributed/clustered
inference (llama.cpp RPC) · cross-session memory systems · voice + messaging interface design
· hardware-aware architecture decisions on constrained/non-dedicated machines
