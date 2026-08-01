# Jarvis — Autonomous Local Voice + Telegram Assistant

A fully local, fully autonomous AI assistant that holds natural voice conversations, searches
the web, dispatches longer research tasks to run in the background, and reports back over
Telegram — including while I'm away from the PC — all running on CPU-only hardware.

## Overview

Jarvis routes requests across two "lanes" depending on how heavy the task is, so voice
conversation stays fast even with no GPU:

```
Fast lane  → llama3.1:8b (direct) → natural voice conversation, quick answers
Slow lane  → dispatched to Hermes (background) → research/heavy tasks → result via Telegram
```

Both lanes share the same memory and routing logic, so it feels like one assistant whether
you're talking to it or texting it.

## Tech stack

| Component | Role |
|---|---|
| Ollama (`llama3.1:8b-instruct-q4_0`) | Fast-lane conversational model |
| Hermes CLI | Background task execution for the slow lane |
| faster-whisper (base, int8, CPU) | Speech-to-text |
| Kokoro TTS | Voice output (chosen over Piper — archived, lower quality) |
| python-telegram-bot | Two-way Telegram messaging |
| `memory.json` | Persistent facts/preferences store |
| Logitech C920 | Microphone input |

**Hardware constraint that shaped everything:** 32GB DDR4, CPU-only, no dedicated GPU — every
model and routing decision below was made against that ceiling, not against an idealized setup.

## Key engineering challenges

### 1. A model inserting its own dispatch tags into spoken output

`phi4-mini` kept emitting a literal `<|dispatched:get_current_weather_for_...|>` tag into its
responses — and worse, self-triggering background dispatch for things like weather queries
that should've been answered instantly in the fast lane. Several rounds of system-prompt
rewording didn't stop it:

```
Never use dispatch tags or special formatting in responses.
```

That instruction alone wasn't enough — the behavior was coming from the model itself, not the
prompt. The actual fix was recognizing this as a **model-specific behavior**, not a
prompt-engineering problem, and switching the task-dispatch role to `llama3.1:8b`, which
didn't exhibit the issue at all. As a safety net for voice output specifically, dispatch tags
are also stripped defensively before anything reaches TTS:

```python
clean = re.sub(r'<\|dispatched:.*?\|>', '', text)
```

### 2. Tiered routing tuned by real behavior, not by design on paper

The first cut of routing sent anything matching a dispatch keyword list to the slow lane —
which meant "What's the weather like?" got dispatched to a background research task instead of
answered directly, because "weather" happened to be on the trigger list. Fixed by testing real
queries against the routing logic and refining the keyword boundaries based on what actually
misfired, rather than assuming the first version of the list was right:

```python
def dispatch_to_hermes(task):
    # sends a task to Hermes in the background;
    # result is delivered via Telegram, not blocking voice conversation
    ...
```

### 3. A durable memory loop instead of a one-off chat log

Rather than just logging conversations, Hermes is instructed to end every completed task with
a `LEARNED: <fact>` line (or `LEARNED: NONE` if nothing's worth keeping):

```python
"...When complete, send Sam a detailed summary via Telegram, and end your response "
"with a single line starting with LEARNED: followed by any durable fact or pattern "
"about Sam worth remembering. If nothing is worth remembering, write LEARNED: NONE"
```

That line gets parsed out and written into `memory.json`, so preferences and facts compound
across sessions instead of resetting every time.

## Outcome

A working end-to-end system: voice input/output, two-way Telegram control from anywhere,
background task dispatch with asynchronous results, and a persistent memory file that grows
with real use — confirmed working end-to-end, including live dispatch tests like "Research
the best NAS drives under $200" correctly routing to the background and returning results over
Telegram.

## Lessons learned

- **Test a model's actual behavior against your exact prompt before committing it to a role.**
  The `phi4-mini` dispatch-tag issue cost several rounds of prompt debugging aimed at the wrong
  layer — the fix was swapping the model, not rewriting the prompt again.
- **Tune routing rules against real queries, not assumptions.** The weather-routing misfire
  only showed up once actual conversational phrasing hit the keyword list.

## Skills demonstrated

End-to-end system design across multiple interfaces (voice, chat) · practical model selection
based on observed behavior rather than benchmarks alone · CPU-only performance-constrained
architecture decisions · building durable state into an otherwise stateless chat loop ·
defensive output-sanitization (stripping model artifacts before they reach the user)
