# canyons

A sequencer for continuous expression and composition

Some core ideas
- music programming should feel like shaders for time
- continuous and discrete programming should sit side by side and easily flow from each other
- what would "optimal algorithmic compression look like" for pieces that where phrasing and structure and choices having underlying arcs and structure in them combined with discrete motifs

# Requirements
Core abstraction is transforming signals, which are functions of time. 

Signals can be composed and manipulated with arithmetic -> these can then be used as modulation lanes, envelopes, overarching coordinates within broader compositional structure, and even playhead positions that can advance you through discrete sequences

A lot of care and the core “musicality devex” is about making it natural and easy to be musical - eg it should be easy to make expressions that are integer multiples of other expressions, easy to compose one signal maybe giving the shape of several pieces with a local signal transformation that gives it swing, easy natural strucure via multi scale temporal stuff, etc

Discrete patterning of note and other discrete sequences and a thoughtful way of how those interact, are modulated by, and in turn can modulate continuous control sequences

Core engine sequence MIDI/MPE instruments at up to standard “MIDI control rates” eg up to 250 Hz or so. 

Has a basic synthesizer engine inside of it with a few basic instruments that are MIDI and MPE responsive (eventually we will want to be able to install some other synth modules of this form which we have been building which are WASM based)

In-editor visualization of control sequences and note patterns with playheads scrubbing through time, directly inspired by strudel

Fluent API JS live coding

MIT license, open source

# Examples to design towards

Examples of “aha moment” hello worlds:

Sequencing a real, breathing performance of bolero should be shocking succinct and in a sense should be like a “sufficiency argument” / solomonoff compression of the shortest programs to produce expressive human music + composition together 

It should be only a few lines to make “generative Phillip glass” piece that combines ostinato (like a little musical phrase / phrases) being cycled through back and forth with progressive layering , rubato and flowing dynamics where you actually sequencing the “flowing control signals” first and then drive the pattern and modulate the instruments with them. This should work both with a Midi piano and more strikingly an MIDI MPE cello

“Multiscale generative composing” hello world where you first sequence the “envelope of an entire piece” and then use that / modulate it with sub signals which can be discretized into routing decisions between sub patterns as well as rubato/ dynamics fluctuations like a real human performance would include

Also should include some funk, jazz and electronic hello world examples to make clear it is about all kinds and styles of music and they can natually fit in this paradigm

——-
Obviously scaling those ideas and making them performant and robust in JavaScript will be non trivial and require some careful thinking about the core underlying engine (also with repl hot reloading and similar live coding requirements) 
