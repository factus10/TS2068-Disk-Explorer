---
name: dis-narrative
description: Write a narrative describing what a disassembled vintage program does, from the .dis and .dis.json files the TS-2068 Disk Browser exports. Use this whenever someone points at a .dis file or a folder of them and asks what a program is, what it does, for a write-up, description, summary, or "Layer 2" — and also when they hand over a disassembly of a TS2068, ZX Spectrum, ZX81 or Sinclair program and ask you to make sense of it. Covers the whole job: mining the artifact, deciding what the evidence actually supports, and writing the file. Reach for it even if the request sounds like a casual "what is this thing?" rather than a formal ask, because the failure it prevents — a fluent description of a program nobody has established anything about — reads exactly like a good one.
---

# Writing a narrative from a .dis

The disassembler (Layer 1) refuses to say more than the bytes support: it traces from
real entry points, calls unreached bytes data, and will not file a listing when it knows
neither where a file loads nor where it starts. A narrative is Layer 2, and it is worth
having only if it holds the same line.

The failure mode is specific and seductive. A .dis for a 12KB program gives you a title
string, three named ROM calls and five thousand instructions. It is easy — and it reads
beautifully — to write four confident paragraphs about a program whose behaviour is
fifty unresolved calls deep. That document is worse than nothing, because unlike a wrong
disassembly it carries no signal that it is wrong.

So the discipline is: **every claim traces to the artifact, and the things you could not
establish get their own section.** A reader should finish knowing both what is known and
how much isn't.

## Start with the digest

```bash
python3 .claude/skills/dis-narrative/scripts/digest.py path/to/NAME.dis
```

(from the repo root; the path is relative to the repo, not to wherever the `.dis` lives.)

It reads `NAME.dis.json` alongside if present and prints the header, the sidecar facts,
the external-call table with a count of how many resolve, the text runs split into prose
and not-prose, and any entry point that is not the start of a decoded instruction.

Prefer it to reading the decoded listing, and never count anything off a `head` of the
file. A .dis runs to thousands of lines and the parts that carry meaning are a few dozen.
More to the point, the call table is long and the interesting fact about it is a *ratio*
— how many of the addresses this program calls can be named at all. The first narrative
written for this repo claimed "20 of the 23 external addresses are unidentified" because
its author read the first twelve lines of that table and assumed it ended there. The real
figures were 50 of 54. Counting by eye off a truncated view is how a document promising
that every fact was checked comes to contain one that wasn't.

That rule is about the *decoded instructions*, which may be fiction. It is not a reason
to avoid the bytes. The digest prints the load address and every entry point as raw
bytes precisely so you can check the trace against them, and reconstructing more of the
image from the listing's hex column is a legitimate and sometimes necessary move — on
one file it was the only way to establish the layout at all.

Read the decoded listing to answer a specific question — what an entry point does in its
first few instructions, say — and quote the address when you do.

## What the evidence is actually good for

Ranked by how much weight it bears:

**Text runs that read as prose.** The strongest identification there is. A title screen,
a credit line, a copyright, a menu prompt — these name the program, its author, its
publisher and its year outright. Quote them. The digest finds these by scanning the
bytes rather than trusting the tracer's idea of what is data, because a trace that
swallows the whole file as code emits no data runs at all and would otherwise hide every
string in the program. Its prose/not-prose split is a heuristic — glance at the rejects.

**Call sites.** The `.dis` header lists each entry point with the BASIC line that calls
it. This is the only place a routine's purpose is written down, and it can carry a
finding nothing in the bytes does: if six different BASIC programs on the disk call into
one CODE file, that file is a shared library for a suite, not a program. Count the
distinct callers before anything else.

**Resolved external calls.** `PRINT-A-1` eighteen times means character output. But see
the traps: the count of *unresolved* calls usually matters more.

**The stats line.** Code vs data bytes, conflicts, undocumented instructions. These bound
how much of the listing you should trust at all.

**Individual instructions.** Least useful per unit of effort, and the easiest place to
over-read. Go here last and only with a question.

## Traps

Each of these was hit on the first real attempt.

- **A hot one-byte restart address is padding, not calls.** `$FF` is `RST $38` and `$C7`
  is `RST $00`, so runs of filler decode as calls to `$0038` or `$0000`. Fifty-four of
  them means the tracer walked data, not that the program hooks the interrupt fifty-four
  times. The digest flags both; the reasoning generalises to any address that is one
  byte of filler away from being an instruction.
- **Unresolved externals are where the behaviour lives.** The symbol packs cover
  documented entry points, which is a small fraction of a ROM. If four of fifty-four
  addresses resolve, then a description built on those four covers almost none of the
  program — and will sound authoritative anyway. Say the ratio out loud.
- **Printable is not text.** `"qqqqp"`, `"yyyyx"` are graphics bytes that landed in the
  ASCII range. The digest separates these, but check its judgement.
- **Conflicts mean some instructions are fictional.** With conflicts recorded, at least
  one traced path is walking data, so any given line in the affected region may not be an
  instruction. Do not build an argument on one.
- **Line numbers suggest roles; they do not establish them.** A call at line 8010 sitting
  where setup usually sits is a reasonable guess. Label it as one.
- **Check what is *at* each entry point, not just whether the trace decoded it.** A
  caller names an address; the digest shows the eight bytes there. If they are `$00` or
  `$FF` filler, no routine lives there whatever the listing claims — the tracer will
  happily disassemble picture data at a bogus address and produce a plausible-looking
  page. On one album file 13 of 14 entry points were filler, because the file spans most
  of upper RAM and the harvest collected USR targets meant for whatever else loads
  there. Say which explanation holds: a wrong trace, or a caller aimed at other resident
  code that merely shares the address range.
- **The trace can be inverted.** On that same file the picture bitmaps were decoded as
  14237 bytes of "code" while the file's only real routine — 61 bytes at the load address
  — was emitted as `DEFB`. When that happens every derived section of the header, the
  external-call table included, is an artifact. The bytes at the load address are the one
  thing that still tells the truth; the digest prints them first for that reason.
- **`speculative: true` in the sidecar means the origin and entry point were both
  invented.** Do not write a narrative for one; there is nothing under it. (Layer 1 will
  not even export these, so you should only meet one from the viewer.)

## The file

Write `<name>.narrative.md` beside the `.dis`. These sections, in this order — the order
is what keeps it honest, because *What this does not establish* comes before anyone has
stopped reading:

```markdown
# <NAME> — narrative

- **Disk:** <image file — the `; from …` line of the .dis>
- **File:** <name>, <n> bytes, loads at $XXXX
- **Binds to:** sha256 <the sidecar's hash>
- **From:** <name>.dis / <name>.dis.json
- **Written by:** <model>, <date>

## What it is
## How the callers use it
## What the code does
## What this does not establish
## Provenance
```

**What it is** — the one or two claims the artifact supports outright. Usually the
credits plus the caller count.

**How the callers use it** — the entry-point table, straight from the call sites. Note
patterns: whether results are used or discarded, which callers share entry points. If
the callers turn out not to be calling this file at all, this is the section where you
show the table and then dismantle it — that is a better use of the space than omitting
it, because the next reader will otherwise wonder about the same addresses.

A long calling line is shown as a window around the call, with `…` wherever text was
dropped. The call itself is always inside the window, so what you see documents what it
claims to — but do not infer anything from what is missing beyond an ellipsis.

**What the code does** — only what resolved symbols and prose runs establish. Be brief
if the evidence is thin; a short section here is a finding in itself.

**What this does not establish** — the unresolved ratio, the conflict count, the
artifacts, and anything you inferred rather than read. Not optional, and not a
disclaimer: it is the part that makes the rest usable.

**Provenance** — which symbol packs produced the disassembly, whether the EXROM overlay
was on (it changes what `$0038` means), and the subject program's copyright if it states
one. If it does not, say so rather than attributing it: a publisher's name in the disk
image's filename is container metadata, not a claim the program makes about itself.

## Checking your own work

Before handing it over, grep each factual claim back against the `.dis`. Quoted strings,
counts, addresses, the checksum. This takes a minute and it is the whole basis on which
the document can be trusted — a narrative whose numbers came from a skim is exactly the
artifact this skill exists to avoid producing.

## Doing a folder

The exported folder of `.dis` files is the work queue; nothing else is needed. Run the
digest across it first and start where the evidence is richest — files with prose runs
and several distinct callers. Files whose digest shows no prose, one caller and a low
resolve ratio may not support a narrative worth writing, and saying so is a legitimate
outcome.
