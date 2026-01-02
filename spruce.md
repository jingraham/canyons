# Spruce: A Physics Compiler for Musical Instruments

**Spruce** is a physics compiler for building expressive, physically-modeled musical instruments. Users describe an instrument declaratively in terms of its physical components, how those compoments store energy, and how energy flows between components. Spruce then compiles this description into efficient, real-time audio code.

## 1. Core Principles

1.  **Declarative Physics**: Instrument models are defined symbolically in terms of their physical components and connections. Components themselves are defined as composable blocks that store, transfer, and dissipate energy. Once defined, components can be wired together like simple patching between modules.
2.  **Guaranteed Stability & Performance**: By leveraging tools from Geometric Numerical Integration, the compiler can decompose the full system into steppable subsystems and programmatically derive a stable, performant, and energy-preserving integration method. This includes numerics-complicating phenomena like hard contacts and stochasticity.
3.  **Musical Expressivity**: MIDI and MPE inputs and audio outputs are first-class citizens defined alongside the physics **at the Instrument level**. The expressive interface is part of the instrument's identity, not an afterthought.
4.  **Portable by Default**: Generated C++ kernels are pure, portable C++17 with minimal dependencies (standard library only). The same kernels deploy to VST/AU plugins, embedded systems, WASM, and native apps via target-specific harnesses—no platform-specific code in the physics implementation.

### Core ideas
Spruce combines three ideas
-  **port-Hamiltonian systems theory**, a generalization of Hamiltonian mechanics for simulations mixed energy domains (mechanical, acoustic, electrical, and signal) through the lens of energy flow
-  **geometric numerical integration**, which derives stable integration methods for systems based on their mathematical structure
-  **symbolic autodiff in python** to mirror widely used develop experience across modern machine learning frameworks like Pytorch and JAX
---

# Part I: Orientation

## 1. Compression

### 1.1 One Sentence

**Spruce** lets you build real-time musical instruments by describing physical energy storage and flow in Python, then compiles that description into efficient audio code with mathematical guarantees about stability and energy conservation.

### 1.2 One Paragraph

**Spruce** is a compiler for physically-modeled musical instruments. You describe an instrument as **energy-storing Blocks** (strings, resonators, contacts) connected by **ideal wires**. Each Block declares how it stores energy `H()`, dissipates energy `R()`, adds noise `S()`, and defines kinematic constraints. Connections enforce velocity continuity; effort emerges from energy gradients. Spruce verifies the model is physically admissible via `lint(block)` and proves `dH/dt = -R + P_in` symbolically with `verify_energy_balance()`, then generates real-time C++ audio code using structure-preserving numerical methods. The result: instruments that sound physical because the math guarantees they obey physics, even with hard contacts, friction, and stochasticity.

### 1.3 One Page

#### What It Is

**Spruce** compiles declarative physics into real-time musical instruments. Authors describe instruments as **networks of energy-storing components** rather than as differential equations or DSP graphs. The compiler handles the numerics, guarantees stability, and generates efficient code.

#### Core Abstractions

**1. Blocks store energy locally**
```python
class HammerString(Block):
    def __init__(self):
        super().__init__()
        self.hammer = PointMass(m="5 g")
        self.string = StiffString(n_modes=16)

        # Ports expose displacement/velocity for coupling
        hammer_port = self.hammer.port("body")
        strike_port = self.string.port("strike", position=0.12)

        # Nonlinear contact via add_potential()
        gap = hammer_port.displacement - strike_port.displacement
        self.add_potential(hertzian_potential(gap, k=q(1e9, "N/m^1.5"), alpha=1.5))

        # Output via observable
        pickup = self.string.port("pickup", position=0.15)
        self.set_observable("output", pickup.displacement)
```

**2. Ports link blocks with power-conjugate pairs**
Ports carry effort/flow (force/velocity), displacement/momentum, and a physical domain.
The `port.displacement` and `port.flow` attributes provide uniform access for both
lumped elements (PointMass) and distributed elements (StiffString with mode shapes).

**3. Couplings use add_potential() and add_dissipation()**
```python
# Nonlinear contact force via Hertzian potential
gap = hammer_port.displacement - strike_port.displacement
self.add_potential(hertzian_potential(gap, k=q(1e9, "N/m^1.5"), alpha=1.5))

# Velocity-dependent damping via Rayleigh term
v_rel = hammer_port.flow - strike_port.flow
self.add_dissipation(q(0.5) * c * v_rel**2)
```
The compiler extracts forces automatically (-∂V/∂q, -∂R/∂v) and routes to efficient solvers.

**4. Control enters via impulse**
Musical gestures (key velocity, strikes) enter via `ImpulseKick` or direct momentum injection.

**5. Audio exits via observation**
Output is a read-only **observable** (mic pressure, bridge velocity) that extracts no energy from the simulation.

#### What The Compiler Does

1. **Flattens** the Block hierarchy into states and connections via `compile_linear_plan`
2. **Extracts** modes via `linear_modes()` pattern matching (algebra, not calculus)
3. **Selects** kernel based on structure (diagonal, banded, low-rank)
4. **Resolves** junctions via fixed-cost scattering (Newton with bounded iterations)
5. **Generates** real-time C++ with deterministic, bit-exact output (given fixed seeds)

#### The Guarantee

If your model compiles, the generated instrument will:
- Never blow up (energy inequality enforced per-step)
- Sound deterministically identical given the same control stream and seed
- Run in real-time (atoms are chosen for efficiency within structure-preserving constraints)
- Respect your units (a `Newton` never becomes a `Volt` by accident)

#### What It's Not

- Not a general ODE solver (structure-preserving specialization trades generality for guarantees)
- Not a machine learning framework (though it borrows symbolic API patterns from PyTorch/JAX)
- Not a sound synthesis library (it compiles *models* into synthesis code)

---

## 2. Architecture Map

### 2.1 Dataflow Diagram

```
┌──────────────────┐
│ Symbolic Core    │  Expression (Units, AD, Printers)
│ (Expression)     │  Single public IR
└────────┬─────────┘
         │ Expression + Python objects
         ▼
┌──────────────────────────────────────────────────────────────┐
│ Physics Core (primitives.py, simple.py)                      │
│                                                              │
│  Block → compile_hr() / linear_modes() → ModeSpec           │
│  Block → add_potential() / add_dissipation() → Expression   │
│                                                              │
│  Protocols: LinearBlock, NoiseBlock, ImpulseBlock           │
│  NO RUNTIME CODE. Pure declarations.                        │
└─────────┬─────────────────────────────────────┬──────────────┘
          │ Protocol interfaces                  │
          ▼                                      │
┌──────────────────────────────────────────┐    │
│ Numerics Engine                          │    │
│                                          │    │
│  compile_to_expressions() → Fixtures     │    ▼
│  SymbolicRunner(fixtures)                │  ┌──────────────────┐
│                                          │  │ Instrument Layer │
│  expression_compiler.py:                 │  │ (bindings objs)  │
│    • compile_to_expressions()            │  └────────┬─────────┘
│    • SymbolicRunner                      │           │
│                                          │           │
│  structured_kernels.py:                  │           │
│    • TridiagonalSystem, LowRankCoupling  │           │
│                                          │           │
└────────┬────────────────────┬────────────┘           │
         │                    │                        │
         │ NumPy evaluation   │ Symbolic Expression    │
         ▼                    ▼                        │
┌──────────────────┐ ┌────────────────────────┐        │
│ SymbolicRunner   │ │ build_codegen_payload() │        │
│ (numpy backend)  │ │                        │        │
│                  │ │ sanitize → C++/WASM    │        │
│ .step()          │ │ compile_native_bundle()│        │
└──────────────────┘ └────────────┬───────────┘        │
                                  │                    │
                                  └────────────────────┤
                                                       ▼
                                  ┌──────────────────────┐
                                  │   Codegen Layer      │
                                  │  ┌────────────────┐  │
                                  │  │ Physics Code   │  │
                                  │  └────────────────┘  │
                                  │  ┌────────────────┐  │
                                  │  │ Bindings Code  │  │
                                  │  └────────────────┘  │
                                  │    Runtime ABI       │
                                  └──────────────────────┘
```

### 2.1.5 Dependency Graph (current path)

The following diagram shows **compile-time dependencies** between layers (what each layer imports/uses):

```mermaid
graph TD
    Symbolic[Symbolic Core<br/>Expression, Units, AD, Printers]
    Protocols[Physics Protocols<br/>LinearBlock, NoiseBlock, etc.]
    Physics[Physics Blocks<br/>PointMass, StiffString, Transducers]
    Numerics[Numerics Engine<br/>expression_compiler, structured_kernels]
    Instrument[Instrument Layer<br/>Bindings (objects)]
    CodegenPayload[Codegen Payload<br/>build_codegen_payload()]
    CodegenPhys[Codegen: Physics<br/>C++/WASM kernels]
    CodegenBind[Codegen: Bindings<br/>setChannel/noteOn]
    Runtime[Runtime ABI<br/>Combined executable]

    Symbolic --> Physics
    Symbolic --> Protocols
    Protocols --> Numerics
    Physics --> Numerics
    Numerics --> CodegenPayload

    Physics --> Instrument
    Symbolic --> Instrument

    CodegenPayload --> CodegenPhys
    Symbolic --> CodegenBind
    Instrument --> CodegenBind

    CodegenPhys --> Runtime
    CodegenBind --> Runtime

    classDef foundation fill:#e1f5e1
    classDef core fill:#e3f2fd
    classDef transform fill:#fff3e0
    classDef codegen fill:#f3e5f5

    class Symbolic foundation
    class Protocols,Physics core
    class Numerics,Instrument transform
    class CodegenPayload,CodegenPhys,CodegenBind codegen
    class Runtime codegen
```

**Key insights from this dependency structure:**

1. **Symbolic is foundational** — exports the single IR (`Expression`) plus AutoDiff and printers
2. **Protocols define the contract** — `LinearBlock`, `JunctionBlock`, etc. in `physics/protocols.py`
3. **Physics blocks are declarative** — implement protocols, return symbolic `Expression` from `constitutive()`
4. **Numerics imports only protocols** — no concrete class imports; adding new blocks doesn't touch numerics
5. **Unified expression compiler** generates update expressions:
   - `expression_compiler.py`: `compile_to_expressions()` produces all state updates
   - `structured_kernels.py`: O(n) solvers for tridiagonal and low-rank coupling
6. **Two execution paths** consume symbolic expressions:
   - **`SymbolicRunner`**: numpy backend (Python development/testing)
   - **`build_codegen_payload()`**: sanitized expressions for C++/WASM

**Protocol-based decoupling:** Physics blocks declare what they are (energy storage, constitutive laws). Numerics decides how to solve them. The protocol interfaces are the contract—no frozen IR needed.

### 2.2 Layer Responsibilities

| Layer | Job | Interface In | Interface Out |
|-------|-----|--------------|---------------|
| **Symbolic Core** | Unit-aware symbolic math, AD, printers | None (foundational) | `Expression` (single IR) |
| **Physics Core** | Typed physical graph (blocks/ports/constraints) | `Expression` | Python objects: `Block`, `Port`, `State`, plus observable expressions (`Expression`) |
| **Numerics Engine** | Compile physics graph to frozen Numerics IR (schedule + expressions + solver hints) | `Expression` + Physics objects | Frozen Numerics IR |
| **Instrument Layer** | Bind musical I/O to physics | `Expression` + Physics objects (read-only) | Binding objects (Python) |
| **Codegen: Physics** | Emit physics stepping code | `Expression` (printers) + Numerics IR | `process()` implementation |
| **Codegen: Bindings** | Emit control routing code | `Expression` (printers) + binding objects | `setChannel()`, `noteOn()`, etc. |

### 2.3 Symbolic Kernel Codegen (v1 focus)

- The new `spruce.symbolic.codegen` helpers wrap `to_cpp_array()` so demos can emit bundled kernels with a stable ABI. For v1 we expose `plucked_step(dt, q_in, p_in, q_out, p_out, n_modes)` plus manifest-declared observables such as `plucked_observable_H(q, p, n_modes)`.
- Tooling (`tools/build_plucked_string_wasm.py`, `tools/build_plucked_string_native.py`) reuses the shared bundle to produce WASM and native artifacts; the `Makefile` adds `plucked-string-wasm`, `plucked-string-native`, and `plucked-string-reference` shortcuts.
- Parity flows (`simulate_numpy_reference()`, `run_native_parity()`) compare NumPy vs generated code across multiple steps and surface max deviations for state + energy. CI runs the native parity test while the WASM harness (Node + AudioWorklet) remains a manual sign-off.
- Bundles include a manifest JSON (versioned) that captures variables, dims, kernel dependencies, and workspace metadata. All emitters (`generate_cpp_header`, `generate_ts_adapter`) read the manifest directly; `validate_manifest()` enforces structural sanity during development.

#### Current implementation notes (init-symbolic)

- `ExecutionPlan` is the contract. Every hoisted digest carries `prefilled` or
  `residual` role metadata, per-kernel footprints are serialized into the
  manifest, and printers/runtime loaders assert that kernels only touch the
  digests declared there.
- Printers and simplifiers stay purely symbolic; they never embed
  `workspace[...]` accessors into the DAG. Instead, `_workspace_entry_for_digest`
  consults the plan at emission time so the algebra produced upstream arrives in
  C++ verbatim.
- `compile_expressions_to_bundle()` emits a single fused update kernel per
  bundle today. Observables still ship as separate kernels, but they reuse the
  same plan metadata and ctypes loader surfaces, so future work can fuse them by
  extending the manifest rather than rewriting printers.
- Regression protection lives in
  `tests/symbolic_runtime/codegen/test_scalar_workspace.py` (workspace reuse),
  `tests/symbolic_runtime/codegen/test_manifest_helpers.py`
  (footprint/manifest parity), and the example parity helpers. These tests
  enforce the plan-driven contract end-to-end.

### 2.3 "Don't Bleed Across Layers" Checklist

- ✅ **Units & shapes**: defined in Symbolic Core, checked in Physics Core, manipulated (via Symbolic API) in Numerics
- ✅ **Domains & ports**: Physics Core only
- ✅ **Integration methods**: Numerics Engine only
- ✅ **MIDI/MPE**: Instrument Layer only
- ✅ **Target platform**: Codegen only
- ❌ **No** unit checking logic in Numerics (units already validated by Physics Core)
- ❌ **No** integrator choices in Physics definitions
- ❌ **No** MIDI inside Physics Core
- ❌ **No** Python closures in anything that becomes IR
- ❌ **No** runtime parameter mutation unless declared `actuated` (via power port)
- ✅ **Numerics uses Symbolic**: to compute gradients, manipulate `Expression`, construct update rules
- ✅ **Instrument uses Symbolic**: to express control scaling (e.g., `quantity("2 m/s") * velocity/127`)

---

## 3. For Different Readers

### If you're **building instruments**
- Start: §1.4 Demo Snippets, then Layer 2 (Physics Core)
- Focus: Blocks, ports, H/R/S, parameter taxonomy
- Skip: Symbolic operator tables, atom internals, codegen ABI

### If you're **implementing the compiler**
- Start: §2 Architecture Map, then layers in order
- Focus: layer interfaces, invariants, and lint rules
- Read: All sections, especially cross-layer guarantees

### If you're **debugging energy drift**
- Start: §11 Contract Tests, Layer 3 (Numerics)
- Focus: Atom guarantees, energy inequality, tolerances
- Tools: `energy_budget()`, `lint(explain=True)`

### If you're **porting to embedded**
- Start: Layer 5 (Codegen), Appendix F (Runtime ABI)
- Focus: RT safety, determinism, memory layout
- Skip: Python API, authoring ergonomics

---

## 1.4 Demo Snippets

### Snippet 1: Struck String

```python
from spruce.physics import Block, PointMass, StiffString
from spruce.physics.blocks import hertzian_potential
from spruce.symbolic.stdlib import q

class HammerString(Block):
    def __init__(self, n_modes=16):
        super().__init__()
        self.hammer = PointMass(m="0.005 kg")
        self.string = StiffString(n_modes=n_modes)

        # Port-based coupling with Hertzian contact
        hammer_port = self.hammer.port("body")
        strike_port = self.string.port("strike", position=0.12)
        gap = hammer_port.displacement - strike_port.displacement
        self.add_potential(hertzian_potential(gap, k=q(1e9, "N/m^1.5"), alpha=1.5))

        # Observable output at pickup position
        pickup = self.string.port("pickup", position=0.15)
        self.set_observable("output", pickup.displacement)

# Compile and run
inst = HammerString(n_modes=16)
runner = inst.compile(sample_rate=48000)

# Strike and generate audio
runner.set_state("root_hammer_p", np.array([0.005 * 2.0]))  # impulse
for _ in range(48000):
    audio_sample = runner.get_observable("output")
    runner.step()
```

**What just happened:**
- Declared two child blocks (hammer + string) with compositional pattern
- Used port.displacement for uniform access to position
- Added Hertzian contact potential via add_potential()
- Registered output via set_observable(), read via get_observable()

---

### Snippet 2: Expressive Control (MPE Cello)

```python
from spruce import Instrument, connect
from spruce.blocks.mechanical import BowedString
from spruce.blocks.acoustic import ResonantBody
from spruce.blocks.transducers import SignalToMechanical
from spruce.control import channel, normalize
from spruce.symbolic import quantity

class MPECello(Instrument):
    def __init__(self):
        super().__init__()
        
        self.string = BowedString(freq="196 Hz")
        self.body = ResonantBody.from_modal_file("cello_modes.json")
        
        # String couples to body at bridge
        self.connect(self.string.bridge_port, self.body.driving_port)
        
        # MPE control channels (signal domain sources)
        pressure_ctrl = normalize(channel("pressure", unit="val"))
        timbre_ctrl = normalize(channel("timbre", unit="val"))
        
        # Transducers convert signal → mechanical force (unitful, power-preserving)
        bow_force_expr = quantity("0.5 N/val") + quantity("9.5 N/val") * pressure_ctrl**2
        bow_force = SignalToMechanical(gain=bow_force_expr)
        
        # Bow position is a tunable parameter
        self.string.bow_position = quantity("0.05") + quantity("0.35") * timbre_ctrl
        
        self.connect(bow_force.output_port, self.string.bow_force_port)
        
        # Mic at soundhole (observable)
        self.set_observable("main", self.body.pressure_at(position=quantity("0.3")))
```

**Key differences:**
- Control channels are **signal-domain sources** (effort=`val`, flow=`val/s`)
- Cross-domain via **transducers** that preserve power accounting
- Bow position expression uses tunable parameters and control signals

---

### Snippet 3: Introspection (Energy Audit)

```python
inst = MPECello()

# Verify physics before compiling
report = inst.lint(explain=True)
print(report.summary())
# ✓ Units consistent
# ✓ J is skew-symmetric (‖J + Jᵀ‖ = 3e-14)
# ✓ R is positive-definite
# ✓ All constraints are index-1
# ✓ Bow friction: monotone certificate ✓

# Runtime energy budget
audio = inst.simulate(duration=quantity("1.0 s"), controls={...})
budget = inst.energy_budget(audio, window_size=2048)
print(budget)
# Total energy: 0.042 J
# Dissipated:   0.041 J (via R)
# Work in:      0.043 J (bow force × velocity)
# Residual:     3.2e-9 J (numerical drift)
```

**What this shows:**
- Pre-compilation verification catches physics errors
- Post-simulation energy accounting proves numerics are sound

---

### Snippet 4: Hierarchical Composition

```python
class TubeAmp(Block):
    """A composite block: preamp + tone + power stage."""
    def __init__(self):
        super().__init__()
        self.preamp = TriodeStage(gain="20")
        self.tone = ToneStack()
        self.power = PushPullOutput()
        
        # Internal wiring
        self.connect(self.preamp.output, self.tone.input)
        self.connect(self.tone.output, self.power.input)
        
        # Expose external ports (alias child ports)
        self.input = self.preamp.input
        self.output = self.power.output

class FuzzRig(Instrument):
    def __init__(self):
        super().__init__()
        
        self.guitar = PluckedString()
        self.fuzz = FuzzPedal()
        self.amp = TubeAmp()
        
        self.connect(self.guitar.output, self.fuzz.input)
        self.connect(self.fuzz.output, self.amp.input)
        
        self.set_observable("speaker", self.amp.speaker_pressure)
```

**Key insight:**
- Blocks compose hierarchically (`__setattr__` auto-registers children)
- `H()` and `R()` aggregate from children by default
- Control flows through the same port mechanism

---

### Snippet 5: Non-Canonical Storage (Advanced)

```python
class SpringMesh2D(Block):
    """2D mass-spring grid with non-canonical coordinates."""
    def __init__(self, grid_size):
        super().__init__()
        n = grid_size * grid_size
        
        # Cartesian positions and velocities
        # Units: m * m/s = m²/s (not action J·s)
        # → Compiler detects non-canonical, uses Poisson integrator
        self.x = State("m", shape=(n, 2))
        self.v = State("m/s", shape=(n, 2))
        
        self.mass_per_node = Parameter("0.01 kg")
        self.k_spring = Parameter("100 N/m")
    
    def H(self):
        # Kinetic + elastic potential
        K = 0.5 * self.mass_per_node.expr * (self.v.expr * self.v.expr).sum()
        
        # Spring potential between neighbors
        dx = self.x.expr[self.neighbor_pairs[:, 0]] - self.x.expr[self.neighbor_pairs[:, 1]]
        lengths = sqrt((dx * dx).sum(axis=1))
        extensions = lengths - self.rest_lengths
        U = 0.5 * self.k_spring.expr * (extensions * extensions).sum()
        
        return K + U
```

**Compiler handles this by:**
- Detecting non-canonical units (`m * m/s ≠ J·s`)
- Using Poisson/discrete-gradient integrator for Φ_H
- Still guarantees energy consistency (discrete gradient method)

---

# Part II: Layer Specifications

---

## 4. Layer 1: Symbolic Core

### Purpose
The "math brick": unit-aware symbolic expressions with autodiff and code printers. No physics semantics.

### Interface
- **In**: None (foundational layer)
- **Out**: `Expression` (to all other layers)

---

### 4.1 Key Objects

| Object | Role |
|--------|------|
| `Expression` | Immutable node: `(op, unit, shape, operands, attrs, hash)` |
| `unit` | Canonical SI base vector as a sorted, interned tuple (`(("kg",1),("m",1),("s",-2))`, `()` = dimensionless) |
| `Variable` | Named leaf constructor returning `Expression` |
| `quantity` | Parser for literals with units (`"5 kg"`, `"9.8 m/s^2"`) |
| `Operator` | Closed set of pure ops (see §4.2) |
| `AutoDiff` | Reverse-/forward-mode transforms (`grad`, `jvp`, `vjp`) |
| `Printer` | Emitters to LaTeX, C++; other backends optional |

**Expression fields:**

```python
@dataclass(frozen=True, slots=True)
class Expression:
    op: str
    unit: dict[str, Fraction]
    shape: tuple[int, ...]
    operands: tuple[Expression, ...]
    attrs: dict[str, Any]
    _hash: int
```

- Immutable; equality & hashing are purely structural (no reliance on `id()`)
- No dtype/precision stored in IR; backends choose numeric type later

---

### 4.2 Operator Set (Closed)

Arithmetic & math operators; all enforce units/shapes at construction.

| Category | Operators | Unit Rule | Shape Rule |
|----------|-----------|-----------|------------|
| **Arithmetic** | `+`, `-`, `*`, `/`, `**` | Dimensional analysis (see §4.3) | Shapes equal; no implicit broadcast |
| **Transcendental** | `sin`, `cos`, `exp`, `log` | Input dimensionless, result dimensionless | Shape preserved |
| **Root** | `sqrt` | Result unit = input^0.5 | Shape preserved |
| **Linear algebra** | `dot`, `matmul`, `sum`, `norm` | Units multiply/collapse | Follow tensor contraction rules |
| **Shape/index** | `broadcast_to`, `reshape`, `flatten`, `transpose`, `slice`, `gather`, `stack`, `concat` | Units preserved | See table below |
| **Conditionals** | `piecewise` | All branches same unit | Shapes match |
| **Comparisons** | `<`, `<=`, `>`, `>=`, `==`, `!=` | Return dimensionless expression | Shape from operands |
| **Special** | `stochastic_noise(amplitude, seed)`, `delta_impulse(magnitude)` | `[out]=[amplitude]`, `[out]=[magnitude]` | Shapes match inputs |

- Python comparison operators return `Expression`; using an expression in a Python boolean context (`if expr:`) raises.
- No implicit broadcasting; use `broadcast_to` explicitly.
- Operators are pure; no side effects.

#### Operator Registry (implementation note)
Each operator is registered with:
- Unit rule (validator + resultant unit computation)
- Shape rule (validator + resultant shape computation)
- Derivative rules (JVP/VJP)
- Cheap simplifications (canonicalization hints)
- Printing hints

This centralization ensures consistent behavior across transforms, AD, and printers.

---

### 4.3 Unit & Shape Rules

#### Arithmetic
```
[A] + [B]  ⇒ requires [A] == [B], result = [A]
[A] * [B]  ⇒ result = [A·B]
[A] / [B]  ⇒ result = [A/B]
[A] ** n   ⇒ result = [A^n]  (n rational)
```

#### Transcendental
```
sin([A]) ⇒ requires [A] = dimensionless, result = dimensionless
exp([A]) ⇒ requires [A] = dimensionless, result = dimensionless
sqrt([A]) ⇒ result = [A^0.5]
```

#### Linear Algebra
```
dot([A], [B])    ⇒ result unit [A·B]; result shape contracts last dim
matmul([A], [B]) ⇒ result unit [A·B]; matrix shape rules
sum([A], axis=k) ⇒ result unit [A]; axis removed from shape
norm([A])        ⇒ result unit [A]; shape reduced per definition
```

#### Shape Ops
```
broadcast_to(A, target_shape) ⇒ [result] = [A], shape = target_shape
reshape(A, new_shape)         ⇒ size preserved, units preserved
flatten(A)                    ⇒ units preserved, shape flattened
slice(A, ...)                 ⇒ units preserved, shape subset per slice
gather(A, indices)            ⇒ units preserved, shape = indices.shape + A.shape[1:]
stack([A_i], axis)            ⇒ units equal; shape adds new axis
concat([A_i], axis)           ⇒ units equal; shape joins along axis
```

**Error policy:** Mismatched units or shapes raise `UnitError`/`ShapeError` with operand units/shapes and suggested fixes. Errors include structured fields (op, lhs/rhs unit+shape, expression path) to support tooling.

#### Eager Normalization (Default)

- Construction finishes with a local normalization pass (`"basic"` level) that folds literal clusters in `add`/`mul`, trivial `pow`, and constant `piecewise` guards.
- Disable globally via `SPRUCESYM_NORMALIZATION=none` (handy for reproducible fixture generation) or locally with `with normalization("none"):` from `spruce.symbolic.policy`.

---

### 4.4 Automatic Differentiation

**JVP (forward mode):**
```python
df = jvp(f, primals=[x], tangents=[dx])
# df.unit == f.unit / x.unit
# df.shape == f.shape (broadcast with dx.shape)
```

**VJP (reverse mode):**
```python
f_val, vjp_fn = vjp(f, x)
grad = vjp_fn(dy)
# grad.unit == dy.unit * f.unit / x.unit
# grad.shape == x.shape
```

**Non-smooth semantics:**
- `stochastic_noise`, `delta_impulse`: non-differentiable → calling `grad` raises with targeted message
- Comparisons (`<`, `<=`, `>`, `>=`, `==`, `!=`): non-differentiable outside of constant-guard `piecewise`
- `piecewise`: differentiable branchwise only when guards are constant with respect to differentiation variables; otherwise raises

**Guarantees:**
- Units propagate via dimensional analysis
- Shapes preserved: `grad(expr, wrt).shape == wrt.shape`; `jvp`/`vjp` outputs match function signatures
- Deterministic (given expression DAG)

---

### 4.5 Printers

Each printer normalizes to a target language:

| Target | Features |
|--------|----------|
| **LaTeX** | Human-readable; normalizes to base SI; shows full unit strings |
| **C/C++** | Inlined math; efficient; single-assignment; no heap |
| **Torch** | Differentiable Tensor ops; GPU-ready |
| **JAX** | JIT-compilable; XLA-compatible |

**Example:**
```python
expr = quantity("5 kg") * quantity("9.8 m/s^2")
print(expr.to_latex())   # 5\,\mathrm{kg} \cdot 9.8\,\mathrm{m/s^2} = 49\,\mathrm{N}
print(expr.to_cpp())     # const double force = 49.0; // N
```

---

### 4.6 Non-Goals (Out of Scope)

- ❌ Ports, domains, power (that's Physics Core)
- ❌ Time stepping, integration (that's Numerics Engine)
- ❌ MIDI, audio I/O (that's Instrument Layer)
- ❌ Code optimization, SIMD (that's Codegen)

---

## 5. Layer 2: Declarative Physics

> **See [specs/physics.md](physics.md) for the complete specification.**

### Purpose

Provide a simplified API for building physically-modeled instruments. Authors compose **Blocks** (energy-storing elements) using **Hamiltonian H** and **Rayleigh R** functions, with couplings via `add_potential()` and `add_dissipation()`.

### Interface
- **In**: `Expression` from Symbolic Core
- **Out**: Python objects implementing protocol interfaces (`LinearBlock`, `NoiseBlock`, `ImpulseBlock`)

### Core Abstractions

| Concept | Role |
|---------|------|
| **Block** | Container for states, parameters, children, ports |
| **State** | Energy-storing variable with unit and optional role |
| **Port** | Power-conjugate pair (effort/flow) at block boundary |
| **Domain** | Physical domain: mechanical, electrical, acoustic, etc. |
| **Transducer** | Gyrator or Transformer for cross-domain coupling |
| **Protocol** | Interface contract between physics and numerics |

### Pre-Built Blocks (implement `LinearBlock`)

| Block | Description |
|-------|-------------|
| `PointMass` | Single DOF with canonical (q, p) pair |
| `LinearResonator` | Generic harmonic oscillator (m, k, c) |
| `StiffString` | N-mode diagonal resonator with sinusoidal shapes |

### Transducers (for cross-domain coupling)

| Transducer | Domain Coupling | Use Case |
|------------|-----------------|----------|
| `Gyrator` | effort↔flow | Voice coils, motors |
| `Transformer` | effort↔effort, flow↔flow | Gears, levers |
| `MagneticPickup` | mech → elec | Guitar pickups |
| `VoiceCoil` | elec → mech | Speakers |

### Injectors (implement `NoiseBlock`/`ImpulseBlock`)

| Block | Protocol | Behavior |
|-------|----------|----------|
| `NoiseSource` | `NoiseBlock` | White noise injection via Port-based API |
| `ImpulseKick` | `ImpulseBlock` | Discrete impulse via Port-based API |

### Key Principles

- **H/R-first authoring**: Blocks declare energy via `hamiltonian()` and `rayleigh()`
- **Energy-based coupling**: Use `add_potential()` and `add_dissipation()` for nonlinear forces
- **Protocol-based**: Numerics consumes `LinearBlock`, `NoiseBlock` protocols, not concrete classes
- **No StateBuffer access**: Physics has no knowledge of numerics internals

### 5.1 Non-Goals (Out of Scope)

- ❌ Integration method choice (that's Numerics Engine)
- ❌ Solver iterations, tolerances (that's Numerics Engine)
- ❌ Runtime solver code (that's Numerics Engine)
- ❌ MIDI bindings (that's Instrument Layer)
- ❌ Code generation (that's Codegen Layer)

---

## 6. Layer 3: Numerics Engine

> **See [specs/numerics.md](numerics.md) for the complete specification.**

### Purpose

Compile physics blocks into fixed-cost execution plans using **H/R-first compilation with Strang splitting**. Supports two execution paths: numeric (Python spike) and symbolic (numpy backend / codegen).

### The Four Atoms

| Atom | Role | Cost |
|------|------|------|
| **Φ_linear** | Fused LTI dynamics (modal banks, resonators) | O(N) to O(N·bw) |
| **Φ_nonlinear** | Nonlinear forces from add_potential/add_dissipation | O(N_terms) per step |
| **Φ_noise** | Stochastic injection (turbulence, thermal noise) | O(N_states) |
| **Φ_impulse** | Discrete events (note-on, strikes) | O(1) per event |

### Compilation Flow

```
Block (top-level system)
  │
  ├─ compile_to_expressions(inst, dt)
  │     ├─ extract H/R via compile_hr() or linear_modes()
  │     ├─ collect nonlinear forces from add_potential/add_dissipation
  │     ├─ detect structured coupling (tridiagonal, low-rank)
  │     └─ build symbolic update expressions
  │
  └─ ExpressionFixtures
      │
      ├───────────────────┬─────────────────────┐
      ▼                   ▼                     ▼
  SymbolicRunner     build_codegen_payload()    compile_instrument_to_bundle()
  (numpy backend)    (sanitized expressions)    (C++/WASM kernels)
```

### Timestepping Schedule: Strang Splitting

```
Φ_linear.half_step(dt/2)      ← linear bulk (Cayley)
apply_nonlinear_forces(dt)    ← F = -∂V/∂q - ∂R/∂v
apply_sources(dt)             ← noise and impulse injection
Φ_linear.half_step(dt/2)      ← linear bulk (Cayley)
```

### Key Principles

- **H/R-first extraction**: Compiler extracts (m, k, c) from hamiltonian/rayleigh via degree analysis
- **Protocol-based decoupling**: Numerics imports only protocols, not concrete classes
- **Unified kinematics**: `make_kinematics_accessor()` handles all block types
- **Symbolic pipeline**: Same expressions execute via numpy backend or compile to native
- **Strang splitting**: Half-linear → nonlinear/sources → half-linear preserves 2nd-order accuracy

---

### 6.5 Numerics IR (frozen)

Numerics outputs a frozen Numerics IR; Codegen consumes it directly (alongside symbolic expressions) for deterministic emission. Tooling may serialize it for caching/inspection, but the live compiler path always goes through this IR. Layout/workspace stays Codegen-only via `ExecutionPlan`.

### 6.1 Non-Goals (Out of Scope)

- ❌ Multirate (explicitly deferred)
- ❌ Adaptive step sizes (single h for real-time)
- ❌ Code emission (that's Codegen)
- ❌ MIDI adapters (that's Instrument Layer)

---

## 7. Layer 4: Instrument Declarative Layer

### Purpose
Bind musical I/O (MIDI, MPE, UI controls, audio) to physics **without changing physics**. This layer is pure metadata.

### Interface
- **In**: `Expression` (Symbolic Core: for control expressions) + Physics objects (read-only: reference ControlSources/observable expressions)
- **Out**: Binding objects (Python) — the compiler works with these directly

---

### 7.1 Key Concepts

#### ControlSources ≡ Signal-Domain ValueSources

Controls are **signal-domain power sources** (effort=`val`, flow=`val/s`):

```python
from spruce.control import channel, gate, event

# Continuous control
drive = channel("drive", unit="val", rate="zoh")

# Boolean gate
sustain = gate("sustain")

# Discrete event
strike = event("note_on")
```

**Reach physics via:**
1. Direct connection (if target is also signal domain)
2. Transducer (if crossing domains: signal → mechanical/electrical/acoustic)

---

#### Bindings

Map external controls to internal ControlSources:

```python
from spruce.adapters.midi import bind_cc, bind_gate, bind_event

bind_cc(cc=1, to="drive", range=(0, 1))
bind_gate(cc=64, to="sustain")
bind_event(note_on=True, to="note_on")
```

**Behind the scenes:**
- MIDI CC1 → writes to `ControlSource("drive")`
- Note-on → triggers `event("note_on")` → accumulates δ-control for Φ_I

---

#### Observable expressions for Audio

Audio outputs are **read-only expressions**:

```python
self.set_observable("main", self.body.pressure_at(mic_pos))
self.set_observable("aux", self.string.bridge_velocity)
```

No power extraction; purely for rendering.

**Rendering transforms** (optional):
```python
self.set_observable("main", self.body.pressure, render="A_weighted")
```

---

#### Presets

Frozen snapshot for reproducibility:

```python
preset = PresetSpec(
    ir_hash=0xDEADBEEF,
    stepper_hash=0x12345678,
    seed=42,
    params=(
        ("string.damping", 0.015),
        ("hammer.mass", 0.0053),
    ),
)
```

**Guarantee:** Same preset + same MIDI → bit-exact audio (within determinism tier).

---

### 7.2 Debug Snapshots (optional)

For tooling/packaging only, the compiler can optionally snapshot binding objects as frozen dataclasses (e.g., `spruce.debug.bindings_snapshot`). **Codegen never consumes these snapshots**—it walks the binding objects directly.

```python
from dataclasses import dataclass
from typing import Mapping, Optional, Tuple

@dataclass(frozen=True)
class ControlBinding:
    name: str
    source_id: str
    unit: str
    rate: str
    default: float

@dataclass(frozen=True)
class EventBinding:
    name: str
    targets: Tuple[Mapping[str, object], ...]

@dataclass(frozen=True)
class AudioBinding:
    name: str
    observable_id: str
    unit: str
    render: Optional[str]

@dataclass(frozen=True)
class PresetSpec:
    ir_hash: int
    stepper_hash: int
    seed: int
    params: Tuple[Tuple[str, float], ...]

@dataclass(frozen=True)
class BindingsSnapshot:
    controls: Tuple[ControlBinding, ...]
    events: Tuple[EventBinding, ...]
    audio: Tuple[AudioBinding, ...]
    preset: Optional[PresetSpec]

    def validate(self) -> None: ...
    def to_yaml(self) -> str: ...
```

**Core Fields:**
- `controls`: Every live control channel and its default.
- `events`: Discrete triggers wired to impulse/application targets.
- `audio`: Observable routing (one entry per output bus; these are read-only expressions).
- `preset`: Optional snapshot for reproducibility; stored as Python data, serialized only for packaging.

**Invariants:**
- Snapshots are frozen; the compiler never reads them back.
- `validate()` checks snapshot consistency for debugging purposes.
- Preset hashes are computed from the live binding objects, not from serialized snapshots.
- YAML/JSON export is for human debugging, packaging, or preset sharing only.

### 7.3 Example: MPE Cello (Full Stack)

```python
from spruce import Instrument
from spruce.blocks.mechanical import BowedString
from spruce.blocks.acoustic import ResonantBody
from spruce.blocks.transducers import SignalToMechanical
from spruce.control import channel, normalize, impulse
from spruce.adapters.midi import bind_channel_pressure, bind_timbre, bind_event
from spruce.symbolic import quantity

class MPECello(Instrument):
    def __init__(self):
        super().__init__()
        
        # Physics
        self.string = BowedString(freq="196 Hz")
        self.body = ResonantBody.from_modal_file("cello_modes.json")
        self.connect(self.string.bridge_port, self.body.driving_port)
        
        # Control sources (signal domain)
        pressure_src = normalize(channel("mpe_pressure", unit="val"))
        timbre_src = normalize(channel("mpe_timbre", unit="val"))
        
        # Transducer: signal → mechanical force
        bow_force_expr = quantity("0.5 N/val") + quantity("9.5 N/val") * pressure_src**2
        bow_force_transducer = SignalToMechanical(gain=bow_force_expr)
        self.connect(pressure_src.output_port, bow_force_transducer.input_port)
        self.connect(bow_force_transducer.output_port, self.string.bow_force_port)
        
        # Bow position from timbre control
        self.string.bow_position = quantity("0.05") + quantity("0.35") * timbre_src
        
        # Audio observable
        self.set_observable("main", self.body.pressure_at(quantity("0.3")), render="A_weighted")
    
    def note_on(self, note, velocity):
        v0 = quantity("0.5 m/s") * (velocity / 127)
        impulse(self.string.p_fundamental, v0)

# Bindings (Instrument Layer)
inst = MPECello()
bind_channel_pressure(to="mpe_pressure")
bind_timbre(cc=74, to="mpe_timbre")
bind_event(note_on=True, to="note_on")

# Compile
inst.compile(target="cpp", output="mpe_cello.hpp")
```

**Bindings (example):**
```python
Bindings(
    controls=(
        ControlBinding(
            name="mpe_pressure",
            source_id="control.mpe_pressure",
            unit="val",
            rate="audio",
            default=0.0,
        ),
        ControlBinding(
            name="mpe_timbre",
            source_id="control.mpe_timbre",
            unit="val",
            rate="zoh",
            default=0.0,
        ),
    ),
    events=(
        EventBinding(
            name="note_on",
            targets=(
                {"kind": "impulse", "state_id": "string.p_fundamental", "magnitude_expr": "0.5 * (velocity / 127)"},
            ),
        ),
    ),
    audio=(
        AudioBinding(
            name="main",
            observable_id="body.pressure",
            unit="Pa",
            render="A_weighted",
        ),
    ),
    preset=PresetSpec(
        ir_hash=0xABCDEF,
        stepper_hash=0x123456,
        seed=42,
        params=(),
    ),
)
```

---

### 7.4 Non-Goals (Out of Scope)

- ❌ Physics computation (Physics Core)
- ❌ Integration methods (Numerics Engine)
- ❌ Code generation (Codegen Layer)
- ✅ Only binding metadata

---

## 8. Layer 5: Codegen Layer

### Purpose
Compile symbolic `Expression` trees into portable, real-time C++ kernels that deploy to any target platform (VST/AU/embedded/WASM/native) via target-specific harnesses.

**Core Philosophy: Portability by Default**

Generated C++ is pure C++17 with minimal dependencies (cmath, cstdint). The same kernels work in:
- **VST/AU plugins** (Logic Pro, Ableton, etc.)
- **Embedded systems** (Eurorack, ARM microcontrollers)
- **WASM** (Web browsers, AudioWorklet)
- **Native apps** (standalone, testing)

**Platform integration happens in thin harness layers, NOT in generated kernels.** This ensures physics code is tested once and deployed everywhere.

See **[specs/codegen.md](codegen.md)** for comprehensive documentation.

### Interface

The Codegen Layer comprises **two independent subsystems**:

#### Codegen: Physics
- **In**: `Expression` trees (Symbolic Core) + `ExecutionPlan` (Numerics Engine)
- **Out**: Portable C++ kernels (step functions, observables, workspace management)

#### Codegen: Bindings
- **In**: `Expression` (Symbolic Core: printers) + binding objects (from Instrument layer)
- **Out**: Control routing implementation (`setChannel()`, `noteOn()`, event dispatch)

Both subsystems emit code that combines into the Runtime ABI.

---

### Layout Contract & Host Utilities

The host contract for Layer 5 consists of:

- **Layout headers** (`*_layout.hpp`) mirror the manifest in pure C++ constexpr
  data (`total_state_floats`, `var_offset`, `idx_gate_c4`, grouped indices, etc.)
  inside `namespace spruce::<prefix>::layout`.
- **Manifest `layout_v2`** duplicates the same offsets/lengths in JSON so tooling
  can validate ABI compatibility without parsing C++.
- **`domain_metadata`** is a pass-through bag for instrument-layer semantics
  (notes, hammer masses, UI hints) that stays outside codegen.
- **`spruce/include/host_utils.hpp`** exposes `bind_state_spans`,
  `bind_state_spans_dynamic`, and `swap_buffers`, letting adapters consume the
  layout header without reimplementing double-buffering or pointer arithmetic.

All example adapters (`piano_keyboard`, `plucked_string`, `piano_string`) now
follow the same pattern: allocate two flat arrays sized by
`layout::total_state_floats`, bind spans once per step, call the structured
kernel, and swap buffers.  Contract tests in
`tests/symbolic_runtime/codegen/test_layout_contract.py` keep the manifest and
layout header in sync and execute a tiny C++ harness via the generated data to
prove the host utilities hit the same results as the symbolic math.

---

### 8.1 C++ Runtime ABI (Aspirational)

**Note:** This section describes the future high-level instrument ABI (Layers 2-4 integration). The current implementation (Layer 1 + 5) generates **portable kernel functions** with a simpler, lower-level ABI. See [specs/codegen.md](codegen.md) for the current kernel ABI.

```cpp
class SpruceInstrument {
public:
    // Lifecycle
    SpruceInstrument(float sample_rate);
    ~SpruceInstrument();
    void reset();

    // Audio processing (RT-safe)
    void process(float* output, size_t num_frames) noexcept;

    // Control (RT-safe)
    void setChannel(const char* name, float value) noexcept;
    void noteOn(uint8_t note, uint8_t velocity) noexcept;
    void noteOff(uint8_t note, uint8_t velocity = 64) noexcept;
    void controlChange(uint8_t cc, uint8_t value) noexcept;
    void pitchBend(int16_t bend) noexcept;
    void mpePressure(uint8_t note, uint8_t pressure) noexcept;

    // Error handling (polled)
    SpruceError getError() const noexcept;
    void clearError() noexcept;

    // Metadata (diagnostics)
    const char* getIRHash() const noexcept;
    const char* getStepperHash() const noexcept;
    uint64_t getSeed() const noexcept;
};
```

---

### 8.2 RT Safety Contract

**Inside `process()`:**
- ✅ Stack allocation only
- ✅ Fixed iteration counts (bounded solvers)
- ✅ No heap, no locks, no exceptions
- ✅ Deterministic execution time (within CPU tier)

**Outside `process()`:**
- Constructor/destructor may allocate
- `setChannel()` writes to lock-free ring buffer (consumed in `process()`)

---

### 8.3 Determinism Contract

**Inputs:**
- Annotated Python objects (atoms/schedule)
- Seed (from preset or default)
- CPU feature tier (AVX2, AVX512, NEON)

**Guarantee:**
Given identical:
1. Annotated objects (verified via `stepper_hash` computed from them)
2. Seed
3. Control stream (MIDI/MPE)
4. Backend/CPU tier

Output audio is **bit-exact** (strict determinism tier).

**Embedded metadata:**
```cpp
struct SpruceMetadata {
    uint64_t ir_hash;
    uint64_t stepper_hash;
    uint64_t seed;
    const char* cpu_features;  // "avx2", "avx512", "neon"
};
```

---

### 8.4 Error Model

Errors are **polled** (not thrown):

```cpp
enum SpruceError {
    SPRUCE_OK = 0,
    SPRUCE_CONSTRAINT_DIVERGED,  // Φ_C failed to converge
    SPRUCE_ENERGY_VIOLATED,      // Discrete energy inequality broken
    SPRUCE_NUMERICAL_INVALID,    // NaN/Inf detected
};
```

**Usage:**
```cpp
inst.process(buffer, frames);
if (inst.getError() != SPRUCE_OK) {
    // Log, fallback, or reset
    inst.clearError();
}
```

---

### 8.5 Emission Strategy

**From frozen IR + ExecutionPlan:**
1. Allocate state/param arrays (layout derived in Codegen; numerics does not prescribe offsets)
2. Unroll schedule loop (ordered atoms from Numerics IR)
3. Emit `Expression` as inlined C++ (using printers from Symbolic Core)
4. Insert solver loops for atoms (Φ_C: SSN/prox; Φ_I: restitution)
5. Embed RNG state (Philox counter)

**Optimizations:**
- Constant folding (parameters baked in)
- Common subexpression elimination
- SIMD (when CPU tier allows)
- Loop unrolling (bounded iterations)

---

### 8.6 Non-Goals (Out of Scope)

- ❌ Authoring API (Physics Core)
- ❌ Symbolic math (Symbolic Core)
- ❌ Atom design (Numerics Engine)
- ✅ Only code emission (consumes Numerics IR + `Expression` nodes; builds its own layout/workspace via `ExecutionPlan`)

---

# Part III: Cross-Cutting Concerns

---

## 9. Parameter Taxonomy

### Motivation

The old spec conflated "parameters" with "controls". This caused confusion about "mutate parameters live". The taxonomy cleanly separates compile-time, build-time, and runtime concerns.

---

### 9.1 Three Kinds

| Kind | Change Topology? | Change at Build? | Change at Runtime? | How? |
|------|------------------|------------------|---------------------|------|
| **structural** | YES | YES | NO | Python only; pre-IR |
| **tunable** | NO | YES | NO | Build parameter (baked in) |
| **actuated** | NO | NO | YES (continuous) | Enters dynamics; power accounted |

---

### 9.2 Structural

**Changes topology or shapes.**

```python
class MyString(Block):
    def __init__(self, n_modes: int):
        super().__init__()
        self.n_modes = Parameter(n_modes, kind=ParameterKind.STRUCTURAL)
        
        # Shape depends on structural param
        self.q = State("m", shape=(n_modes,))
        self.p = State("kg*m/s", shape=(n_modes,))
```

**Rules:**
- Can only change in Python before `inst.compile()`
- Changing it requires recompilation (topology/shapes change)

---

### 9.3 Tunable

**Fixed at build; no runtime mutation.**

```python
class Resonator(Block):
    def __init__(self):
        super().__init__()
        self.damping = Parameter("0.02")  # Default is TUNABLE
    
    def R(self):
        v = self.p.expr / self.m.expr
        return 0.5 * self.damping.expr * v**2
```

**Rules:**
- Value baked into compiled code (constant folding)
- To change, rebuild with new value

**Use case:** Physical constants (Young's modulus, string length).

---

### 9.4 Actuated

**Varies continuously at runtime; appears directly in `H()` with power auto-computed.**

```python
class BowedString(Block):
    def __init__(self, n_modes=16):
        super().__init__()
        self.q = State("m", shape=(n_modes,))
        self.p = State("kg*m/s", shape=(n_modes,))
        
        # Actuated parameter: varies at runtime
        self.bow_force = Parameter("1 N", kind=ParameterKind.ACTUATED)
    
    def H(self):
        """Actuated parameter appears directly in H — power is computed automatically."""
        string_energy = 0.5 * (self.p.expr @ self.p.expr) + \
                       0.5 * (self.omega**2 * self.q.expr) @ self.q.expr
        
        # Bow force couples to string via work term
        q_at_bow = (self._mode_shape_at_bow() * self.q.expr).sum()
        return string_energy - self.bow_force.expr * q_at_bow
```

**Rules:**
- Power accounting: \(P_{in} = \Sigma (\partial H / \partial u) \cdot \dot{u}\) is computed automatically from actuated params in `H()`
- No separate `external_forcing()` needed—the param's presence in `H()` defines its effect on dynamics

**Use case:** Bow force, breath pressure, active damping.

---

### 9.5 Migration from SPEC_II

**Old (SPEC_II):**
```python
inst.param('string.damping').set(quantity("0.02"))  # Runtime mutation
```

**New (SPEC_III):**
```python
# Option 1: Make it tunable (rebuild to change)
self.damping = Parameter("0.02")
# Value baked into compiled code

# Option 2: Make it actuated (runtime-variable, power-accounted)
self.damping = Parameter("0.02", kind=ParameterKind.ACTUATED)
# Use external_forcing() to declare how it affects dynamics
```

---

## 10. Diagnostics Philosophy

### Principle

**Every error includes:**
1. **Layer name** (Symbolic, Physics, Numerics, Instrument, Codegen)
2. **Violated rule** (unit mismatch, rank deficiency, etc.)
3. **Symbol path** (hierarchical ID: `block.path.symbol`)
4. **Concrete fix** (what to change)

---

### 10.1 Example Errors

#### Symbolic Core

```
[Symbolic] Unit mismatch in addition
  Expression: N + m/s
  Location: block.hammer.H(), line 42
  → Fix: Check dimensions; perhaps multiply by mass?
```

---

#### Physics Core

```
[Physics] Port domain mismatch
  Connection: hammer.force_port (MECHANICAL) ⇄ lfo.output_port (SIGNAL)
  → Fix: Insert transducer:
      transducer = SignalToMechanical(gain=quantity("40 N/val"))
      self.connect(lfo.output_port, transducer.input_port)
      self.connect(transducer.output_port, hammer.force_port)
```

```
[Physics] Actuated parameter not connected to port
  Parameter: bow_force (kind=actuated)
  Owner: string.bow
  → Fix: Declare a power port and connect bow_force as an effort source
```

---

#### Numerics Engine

```
[Numerics] Constraint Jacobian rank deficient
  Expected rank: 4
  Actual rank: 3
  Tolerance: 1e-9
  Offending constraint: contact.gap == 0
  → Fix: System is index-2; add a velocity-level constraint or regularize
```

```
[Numerics] Φ_C solver diverged
  Constraint: felt_hammer.complementarity
  Iterations: 32 (max)
  Residual: 1.2e-6 (tolerance: 1e-8)
  → Fallback: Using Φ_IMR (implicit midpoint) with warning
```

---

#### Instrument Layer

```
[Instrument] Unbound control
  Control: channel("mod")
  Referenced in: overdrive.gain
  → Fix: Bind to MIDI CC:
      bind_cc(cc=1, to="mod", range=(0, 1))
```

---

### 10.2 Explain Mode

`inst.lint(explain=True)` outputs detailed diagnostics:

```
explain(self.string.boundary_port)
  Layer: Physics Core
  Landing: J[42, 87] (skew-symmetric connection)
  Domain: MECHANICAL
  Units: effort=N, flow=m/s, power=W
  Causality:
    effort = interface unknown (solved by Dirac node)
    flow = provided by PortFunction
  Certificate: passive (proven)
  Atom: Φ_C (reason: complementarity constraint from FeltHammer)
  Specialization: at=0.20 (bound via with_={'at': 0.20})
  Fallback: none (Φ_IMR not used)
```

---

## 11. Contract Tests

Each layer has a canonical test that validates its guarantees.

---

### 11.1 Symbolic Core

**Test: Units propagate through AD**

```python
from spruce.symbolic import quantity, autodiff

x = quantity("1 m")
y = 0.5 * x**2  # Expr: 0.5 m^2

grad = autodiff(y, wrt=x)

assert grad.unit == "m"  # dy/dx has units m^2 / m = m
```

---

### 11.2 Physics Core

**Test: Energy conservation (two resonators + ideal wire)**

```python
class TwoResonators(Instrument):
    def __init__(self):
        super().__init__()
        self.res_a = LinearResonator(m="1 kg", k="100 N/m")
        self.res_b = LinearResonator(m="2 kg", k="200 N/m")
        
        # Ideal connection (zero energy)
        self.connect(self.res_a.port, self.res_b.port)
        
        self.set_observable("energy", self.total_energy())

inst = TwoResonators()
fixtures = compile_to_expressions(inst, dt=1e-4)
runner = SymbolicRunner(fixtures)
# Energy balance verified through structure-preserving Cayley updates

# Simulate with fine timestep
audio = inst.simulate(duration=quantity("1.0 s"), dt=quantity("0.0001 s"))
energy_drift = abs(audio['energy'][-1] - audio['energy'][0])

assert energy_drift < 1e-12  # Energy conserved to machine precision
```

---

### 11.3 Numerics Engine

**Test: Φ_C converges on felt hammer**

```python
class HammerString(Instrument):
    def __init__(self):
        super().__init__()
        self.hammer = PointMass(m="5 g")
        self.string = ModalString(freq="440 Hz", n_modes=16)
        self.contact = FeltHammer(k="1e9 N/m^2.5")
        
        # Contact is a Block with its own H() and constraints()
        self.connect(self.hammer.port, self.contact.port_a)
        self.connect(self.contact.port_b, self.string.boundary)

inst = HammerString()
dynamics = derive_drift(inst)

# Check that contact generates complementarity
assert len(dynamics.complementarity) > 0

# Simulate and check convergence
diagnostics = inst.simulate(duration=quantity("0.1 s"), return_diagnostics=True)
assert all(d['Φ_C_iters'] < 32 for d in diagnostics)
assert all(d['Φ_C_residual'] < 1e-8 for d in diagnostics)
```

---

### 11.4 Instrument Layer

**Test: Preset reproducibility**

```python
inst = StruckString()
preset = inst.to_preset(name="Test", seed=42)

midi_stream = [
    (0.0, 'note_on', 60, 100),
    (0.5, 'note_off', 60, 64),
]

audio1 = inst.process(preset, midi_stream)
audio2 = inst.process(preset, midi_stream)

assert np.array_equal(audio1, audio2)  # Bit-exact
```

---

### 11.5 Codegen Layer

**Test: No heap allocation in process()**

```cpp
// Static analysis or runtime allocator hook
void* operator new(size_t) {
    throw std::runtime_error("Heap allocation in RT context");
}

SpruceInstrument inst(48000.0f);
float buffer[128];

// Should not throw
inst.process(buffer, 128);
```

---

## 12. Decision Trees

### 12.1 "How should I model this control?"

```
Does the control affect energy H(x) or dissipation R(x)?
 │
 ├─ NO ──▶ Pure observable; no parameter needed
 │
 └─ YES ─▶ Is it a δ-impulse (instantaneous)?
            ├─ YES ──▶ impulse() (routed to Φ_I)
            └─ NO ───▶ Is it continuous?
                        ├─ YES ──▶ actuated parameter (appears in H(); power auto-computed)
                        └─ NO ───▶ tunable parameter (rebuild to change)
```

---

### 12.2 "How does canonical pairing work?"

```
Declare states with physical units:
 │
 ├─ q (m) and p (kg*m/s) → q*p = J·s (action)
 │         → Compiler detects canonical pair
 │         → Uses symplectic Φ_H (efficient, 2nd order)
 │
 └─ x (m) and v (m/s) → x*v = m²/s (not action)
               → Compiler uses Poisson Φ_H (still energy-consistent)
```

**No explicit annotation needed.** Just use correct physical units and the compiler infers structure.

**Examples:**
- **Canonical**: Modal coordinates `(q_n, p_n)` where `p = m*v`
- **Non-canonical**: Cartesian mesh `(x, v)`, Eulerian fluid `(ρ, u)`

---

### 12.3 "My model won't compile - where do I look?"

```
Check the error message layer tag:
 │
 ├─ [Symbolic] ──▶ Units/shapes in expressions
 │                 → Review operator rules (§4.2-4.4)
 │
 ├─ [Physics] ───▶ Ports, domains, parameters
 │                 → Check port domain compatibility
 │                 → Verify parameter kind (actuated → needs port)
 │                 → Ensure block locality (H/R/S use only local states)
 │
 ├─ [Numerics] ──▶ Constraints, causality, rank
 │                 → Constraint Jacobian rank (index-1?)
 │                 → Causality assignment (algebraic loops?)
 │
 └─ [Instrument] ─▶ Bindings
                   → Unbound controls?
                   → Observable expression references valid?
```

---

# Part IV: Appendices

---

## Appendix A: Complete Operator Set

| Op | Signature | Unit Rule | AD Rule | Notes |
|----|-----------|-----------|---------|-------|
| `add` | `(A, B) → C` | `[A] == [B]`, `[C] = [A]` | `∂C/∂A = 1`, `∂C/∂B = 1` | Shapes must match |
| `sub` | `(A, B) → C` | `[A] == [B]`, `[C] = [A]` | `∂C/∂A = 1`, `∂C/∂B = -1` | |
| `mul` | `(A, B) → C` | `[C] = [A·B]` | `∂C/∂A = B`, `∂C/∂B = A` | Element-wise |
| `div` | `(A, B) → C` | `[C] = [A/B]` | `∂C/∂A = 1/B`, `∂C/∂B = -A/B²` | |
| `pow` | `(A, n) → C` | `[C] = [A^n]` | `∂C/∂A = n·A^(n-1)` | `n` rational |
| `sin` | `(A) → C` | `[A] = 1`, `[C] = 1` | `∂C/∂A = cos(A)` | Dimensionless |
| `cos` | `(A) → C` | `[A] = 1`, `[C] = 1` | `∂C/∂A = -sin(A)` | Dimensionless |
| `exp` | `(A) → C` | `[A] = 1`, `[C] = 1` | `∂C/∂A = exp(A)` | Dimensionless |
| `log` | `(A) → C` | `[A] = 1`, `[C] = 1` | `∂C/∂A = 1/A` | Dimensionless |
| `sqrt` | `(A) → C` | `[C] = [A^0.5]` | `∂C/∂A = 0.5/√A` | |
| `abs` | `(A) → C` | `[C] = [A]` | `∂C/∂A = sign(A)` | |
| `sign` | `(A) → C` | `[C] = 1` | `∂C/∂A = 0` (except at 0) | |
| `dot` | `(A, B) → C` | `[C] = [A·B]` | Chain rule | Contracts last dim |
| `matmul` | `(A, B) → C` | `[C] = [A·B]` | Chain rule | Matrix multiply |
| `sum` | `(A, axis) → C` | `[C] = [A]` | `∂C/∂A = 1` (broadcast) | |
| `piecewise` | `(conds, vals) → C` | All `vals` same unit | Subdifferential | |
| `stochastic_noise` | `(amp, seed) → C` | `[C] = [amp·√t]` | Stratonovich correction | |
| `delta_impulse` | `(mag) → C` | `[C] = [mag·t]` | N/A (discrete event) | |

---

## Appendix B: Domains & Units Table

| Domain | Effort | Flow | Power | Typical Use |
|--------|--------|------|-------|-------------|
| **Mechanical (transl.)** | `N` | `m/s` | `W` | Springs, masses, dampers |
| **Mechanical (rot.)** | `N*m` | `rad/s` | `W` | Rotors, torsion springs |
| **Electrical** | `V` | `A` | `W` | Circuits, inductors, capacitors |
| **Acoustic** | `Pa` | `m^3/s` | `W` | Resonators, tubes, horns |
| **Thermal** | `K` | `W/K` | `W` | Heat transfer (rare) |
| **Signal** | `val` | `val/s` | `val^2/s` | Control, abstract sources |

**Cross-domain conversion:**
All require explicit **Transducer** with power-preserving gain.

Example:
```python
# Signal → Mechanical
SignalToMechanical(gain=quantity("40 N/val"))
# Units: val * (val/s) * (N/val) = N·m/s ✓

# Mechanical → Acoustic
MechanicalToAcoustic(gain=quantity("1e5 Pa*s/m"))  # Radiation impedance
# Units: (N) * (m/s) * (Pa*s/m) = Pa·m^3/s ✓
```

---

## Appendix C: Atom Details

> **Note:** Atoms are selected via **Waterfall Dispatch** based on detected structure. See [specs/numerics.md](numerics.md) for the complete stepper library and dispatch logic.

### C.1 Φ_H: Hamiltonian Flow

**Purpose:** Conservative dynamics (energy-preserving).

#### LTI Systems (Quadratic H)

**Method:** Cayley Transform (rational symplectic)

```
Φ_h = (I - h/2·A)⁻¹(I + h/2·A)
```

where `A = J - R` with `J` skew-symmetric and `R ⪰ 0`.

**Properties:** A-stable, contractive ($||\Phi_h|| \le 1$), symplectic when `R = 0`. Resolvent precomputed; runtime is pure FMA. **Spectral Matching** corrects phase error at compile time.

**Guarantee:** Unconditionally stable; energy strictly non-increasing.

---

#### Separable H = T(p) + V(q)

**Method:** Störmer-Verlet (2nd-order symplectic)

```
q_{n+1/2} = q_n + (h/2) ∂H/∂p|_{p_n}
p_{n+1}   = p_n - h ∂H/∂q|_{q_{n+1/2}}
q_{n+1}   = q_{n+1/2} + (h/2) ∂H/∂p|_{p_{n+1}}
```

**Guarantee:** `H(q_{n+1}, p_{n+1}) ≈ H(q_n, p_n)` with error `O(h³)`. Stability requires `ω·h < 2`.

---

#### General (Safety Net)

**Method:** Discrete gradient

```
x_{n+1} = x_n + h J(x) ∇_d H(x_n, x_{n+1})
```

where `∇_d H` satisfies:
```
H(x_{n+1}) - H(x_n) = ∇_d H · (x_{n+1} - x_n)
```

**Guarantee:** Exact energy conservation (to solver tolerance). Unconditionally stable.

---

### C.2 Φ_D: Dissipation

**Purpose:** Energy dissipation (always non-increasing).

#### Linear PSD

**Method:** Exact integration (matrix exponential or analytic)

```
x_{n+1} = exp(-h R_lin) x_n
```

**Guarantee:** `R(x_{n+1}) ≤ R(x_n)` (exact).

---

#### Nonlinear

**Method:** Implicit midpoint

```
x_{n+1} = x_n - h ∂R/∂x|_{(x_n + x_{n+1})/2}
```

**Guarantee:** `R(x_{n+1}) ≤ R(x_n)` (to solver tolerance).

---

### C.3 Φ_S: Stochastic

**Purpose:** Stochastic forces (thermal noise, bow chatter, etc.).

**Method:** Stratonovich integration (symmetric)

```
x_{n+1} = x_n + B(x_n) ξ √h
```

where `ξ ~ N(0, I)` from Philox RNG.

**Guarantee:** Stratonovich-consistent (weak order 2 for smooth drift).

---

### C.4 Φ_C: Constraints

**Purpose:** Persistent constraints, complementarity, contacts.

**Method:** Proximal operator or semi-smooth Newton

```
x_{n+1} = prox_{ψ}(x_n - h ∇H)
```

or

```
Solve: ∇φ(x)ᵀ λ = 0, φ(x) ≤ 0, λ ≥ 0, λ·φ(x) = 0
```

**Tolerances:**
- Residual: `rtol = 1e-8`
- Complementarity: `ctol = 1e-10`
- Max iterations: 32

**Guarantee:** Power-orthogonal (no energy created by constraints).

---

### C.5 Φ_I: Impulse Layer

**Purpose:** Rigid impacts, restitution, δ-controls.

**Method:** Restitution law + impulse accumulator

```
v_post = -e v_pre + (1 + e) v_contact
```

where `e ∈ [0, 1]` is restitution coefficient.

**Impulse ledger:**
```python
impulses = [
    {
        "target": "state_id",
        "kind": "kick | impact | complementarity",
        "magnitude": ...,
        "units": "kg*m/s",
    },
]
```

**Guarantee:** Discrete energy inequality `ΔH ≤ W_impulses`.

---

## Appendix D: Event Ordering & Impulse Ledger

### Event Ordering (Per Sample)

```
Sample k start
  │
  ├─ [ACCUMULATE] δ-controls from:
  │    - impulse() calls
  │    - note_on/note_off events
  │    - complementarity impulses (from previous Φ_C)
  │
  ├─ Φ_H(h/2) ──────▶ x₁
  ├─ Φ_D(h)   ──────▶ x₂
  ├─ Φ_S(√h)  ──────▶ x₃
  ├─ Φ_C(h)   ──────▶ x₄  (may generate new impulses for next sample)
  │
  ├─ [Φ_I] ──────────▶ Apply accumulated impulses
  │    └─ Rigid impacts (restitution)
  │    └─ δ-controls (kicks)
  │
  ├─ Φ_H(h/2) ──────▶ x₅ = x_{k+1}
  │
Sample k+1 start
```

### Impulse Ledger Schema

```yaml
impulses:
  - target: "state_id" | "port_id"
    kind: kick | impact | complementarity
    magnitude: <float>
    units: "kg*m/s" | "N*s" | ...
    provenance:
      source: "note_on" | "contact.gap<0" | "impulse(hammer.p)"
      timestamp: <sample_index>
```

**Energy accounting:**
```
ΔH ≤ W_impulses + W_control - Q_dissipated
```

where `W_impulses` is computed from the ledger.

---

## Appendix E: Expression IR (Schema)

### E.1 Symbolic IR

```python
ExpressionIR(
    nodes=(
        Node(
            id=0,
            op="mul",
            inputs=(...),
            unit="N",
            shape=(...),
            attrs={"constant": None},
        ),
        # ... existing nodes ...
    ),
    free_symbols=(
        FreeSymbol(name="block.path.q", unit="m", shape=(), role="state"),
    ),
    invariants={
        "units_checked": True,
        "shapes_checked": True,
        "dag_acyclic": True,
    },
)
```

---

### E.2–E.4 (reserved)

## Appendix F: C++ Runtime ABI (Complete)

```cpp
#include <cstdint>
#include <cstddef>

namespace spruce {

enum class SpruceError {
    OK = 0,
    CONSTRAINT_DIVERGED,
    ENERGY_VIOLATED,
    NUMERICAL_INVALID,
};

struct SpruceMetadata {
    uint64_t ir_hash;
    uint64_t stepper_hash;
    uint64_t seed;
    const char* cpu_features;
    const char* version;
};

class SpruceInstrument {
public:
    // Lifecycle
    explicit SpruceInstrument(float sample_rate);
    ~SpruceInstrument();
    
    SpruceInstrument(const SpruceInstrument&) = delete;
    SpruceInstrument& operator=(const SpruceInstrument&) = delete;
    
    // State
    void reset() noexcept;
    
    // Audio (RT-safe)
    void process(float* output, size_t num_frames) noexcept;
    
    // Control (RT-safe; lock-free ring buffer internally)
    void setChannel(const char* name, float value) noexcept;
    void noteOn(uint8_t note, uint8_t velocity) noexcept;
    void noteOff(uint8_t note, uint8_t velocity = 64) noexcept;
    void controlChange(uint8_t cc, uint8_t value) noexcept;
    void pitchBend(int16_t bend) noexcept;  // [-8192, 8191]
    void mpePressure(uint8_t note, uint8_t pressure) noexcept;
    void mpeTimbre(uint8_t note, uint8_t timbre) noexcept;
    
    // Error handling (polled)
    SpruceError getError() const noexcept;
    void clearError() noexcept;
    
    // Metadata
    const SpruceMetadata* getMetadata() const noexcept;
    
private:
    struct Impl;
    Impl* impl_;
};

}  // namespace spruce
```

---

## Appendix G: Glossary

| Term | Definition |
|------|------------|
| **Atom** | Minimal structure-preserving stepper on a state slice |
| **Block** | Component owning local physics (H/R/S/constraints) and ports |
| **Canonical pair** | Conjugate coordinates `(q, p)` detected via unit analysis (`q*p = J·s`) |
| **Cayley Transform** | Rational map $(I - \frac{h}{2}A)^{-1}(I + \frac{h}{2}A)$; A-stable, symplectic/contractive |
| **Certificate** | Author-provided proof hint (passive, monotone, linear) |
| **Complementarity** | Unilateral constraint: `gap ≥ 0, force ≥ 0, gap·force = 0` |
| **Connection** | Ideal wire enforcing velocity continuity (`flow_a = flow_b`) |
| **Constraint** | Algebraic relation `g(x) = 0` enforced via Lagrange multipliers |
| **Discrete Gradient** | Gradient formulation ensuring exact energy conservation in discrete time |
| **Domain** | Energy category (mechanical, electrical, acoustic, signal) |
| **Dynamics** | Complete system specification: drift + diffusion + constraints + complementarity |
| **Impulse layer (Φ_I)** | Resolves δ-controls and rigid impacts with restitution |
| **Observable expression** | Read-only expression for audio/diagnostics (no power extraction) |
| **Passivity** | Property that energy is non-increasing; preserved by contractive maps |
| **Poisson integrator** | Structure-preserving integrator for non-canonical coordinates |
| **Port** | Power interface exposing flow (velocity-like quantity) |
| **Power-Orthogonality** | Constraint forces do no work ($\lambda^T \dot{g} = 0$) |
| **Proximal operator** | Resolvent of a monotone operator (used in Φ_C) |
| **Restitution** | Coefficient `e ∈ [0,1]` controlling energy loss in impacts |
| **Safety Net** | Guarantee of fallback to unconditionally stable method (DiscreteGradient) |
| **Source** | Exogenous signal in signal domain (effort=val, flow=val/s) |
| **Spectral Matching** | Compile-time parameter correction to eliminate frequency warping in rational integrators |
| **State** | Energy-storing variable (position, momentum, etc.) |
| **Stepper** | Integration kernel (explicit, implicit, or linear-solve) that produces update expressions |
| **Stochastic** | Noise amplitudes via `S()`; Stratonovich interpretation |
| **Stratonovich** | Stochastic integration preserving chain rule |
| **Symplectic** | Structure-preserving integration for canonical (q, p) systems |
| **System** | Flattens Block hierarchy, validates physics, derives equations of motion |
| **Transducer** | Power-preserving cross-domain bridge with unitful gain |
| **Waterfall Dispatch** | Structure-based stepper selection: LTI → Cayley, Separable → Verlet, General → DiscreteGradient |

---

**End of Spruce Specification**
