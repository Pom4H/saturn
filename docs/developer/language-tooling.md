# Saturn developer guide: TypeScript DSL, language tooling and coding agents

> Status: architecture and implementation guide.  
> Product: **Saturn**.  
> Canonical project DSL: **`@saturn/core`**.  
> Application package: **`@saturn/scada`**.  
> Related decisions: [ADR-0001](../adr/0001-saturn-system-architecture.md), [ADR-0002](../adr/0002-extension-packages.md), [ADR-0004](../adr/0004-package-and-dsl-names.md).

## 1. Why this document exists

Saturn projects are authored as TypeScript, but they are not arbitrary JavaScript programs. The goal is to get the full developer experience of TypeScript — types, navigation, refactoring, completion, diagnostics and agent compatibility — while preserving a bounded declarative project model that Saturn can validate, version, diff and execute reproducibly.

This document defines how new DSL entities, extensions, CodeMirror integration, diagnostics and agent-facing tooling must be designed.

The central rule is:

> **Saturn does not invent a programming language. TypeScript is the authoring language; `@saturn/core` is the domain type system; the Saturn compiler defines the permitted declarative subset and engineering invariants.**

If a Saturn entity cannot be understood through TypeScript types, source navigation and structured Saturn diagnostics, its public API is not finished.

---

## 2. Current state and target state

### Current state

Today Saturn already has:

- a bounded TypeScript AST compiler in `plant/compiler.ts`;
- a typed project DSL in `plant/dsl.ts`;
- CodeMirror 6 in browser shells;
- project files as a map of UTF-8 source files;
- source-preserving visual edits;
- runtime/project separation;
- installed model metadata;
- a first interactive DSL reference in the shell;
- `@saturn/core` as the canonical project import, with `@scada/plant` accepted temporarily as a migration alias.

The important limitation is that CodeMirror currently knows TypeScript syntax, but not the complete semantic project model. Existing manual completion logic is transitional.

### Target state

~~~text
                    Project files
                 plant.ts / systems/*.ts
                         |
        +----------------+----------------+
        |                                 |
 TypeScript language service        Saturn compiler
 types / symbols / refs             bounded AST
 completion / hover                 domain validation
 rename / inlay hints               topology / units
 signature help                     source mapping
        |                                 |
        +----------------+----------------+
                         |
                  Language host
                         |
                CodeMirror / agents
~~~

CodeMirror is the editor UI. It must not become the source of language semantics.

---

## 3. Package and identity rules

Canonical names:

~~~text
@saturn/scada          Saturn application/distribution
@saturn/core           project DSL and portable public contracts
@saturn/my-extension   first-party/example extension naming pattern
~~~

Rules:

1. New project examples import from `@saturn/core`.
2. Public code identifiers are stable and locale-independent.
3. Extensions may use third-party npm scopes, but first-party examples use `@saturn/*`.
4. The same project source must work in browser, standalone Saturn and CI.
5. A renderer, HMI target or extension must not invent another project IR.

---

## 4. Use TypeScript as the domain type system

Do not reduce the DSL to stringly typed factories.

Prefer:

~~~ts
const pump = simulation('P-101', 'pump', {
  system: water,
  at: { x: 320, y: 180 },
})

const suction = pipe(
  'suction',
  tank.outlet,
  pump.inlet,
  {
    medium: 'water',
    diameter: mm(100),
  },
)
~~~

over APIs that require repeated string lookup:

~~~ts
signal('P-101.flow')
port(pump, 'inlet')
command('P-101', 'start')
~~~

String forms may remain for serialization boundaries or explicit dynamic lookup, but public authored APIs should expose structural typed references whenever possible.

### 4.1 Preserve literal identity

Stable IDs should remain literal types where practical:

~~~ts
const pump = simulation('P-101', 'pump', ...)
~~~

The type system should preserve useful information such as:

~~~ts
pump.id       // "P-101"
pump.kind     // "pump"
~~~

This enables typed commands, typed navigation, better diagnostics and agent reasoning.

### 4.2 Hide implementation fields

Internal transport objects such as `node: Simulation` must not dominate completion.

The desired public shape is domain-oriented:

~~~ts
pump.inlet
pump.outlet
pump.rpm
pump.flow
pump.temperature
~~~

Internal compiler data may be stored through private mappings, symbols or conversion functions.

### 4.3 Prefer inferred APIs

Model definitions should be declared once and drive:

- TypeScript types;
- compiler validation;
- completion;
- hover documentation;
- inspector fields;
- shell DSL reference;
- generated HMI metadata;
- extension compatibility checks;
- agent-readable schemas.

Do not maintain separate hand-written lists for each surface.

Use literal inference and `satisfies` to retain narrow types while checking definitions:

~~~ts
export const model = {
  ports: {
    inlet: fluidIn(),
    outlet: fluidOut(),
  },
  signals: {
    flow: flow.m3h(),
    rpm: speed.rpm(),
  },
  parameters: {
    inertia: number({ min: 0, max: 100 }),
  },
} satisfies ModelDefinition
~~~

---

## 5. Physical topology is typed by meaning

Physical media are not generic graph edges.

### 5.1 `pipe()`

`pipe()` means a physical pipe carrying a fluid or gas.

Examples of media:

- water;
- steam;
- oil;
- glycol;
- compressed air;
- process gas.

It must not be used as a generic “process connection”.

Target type shape:

~~~ts
interface FluidOutPort<M extends FluidMedium> {
  direction: 'out'
  medium: M
}

interface FluidInPort<M extends FluidMedium> {
  direction: 'in'
  medium: M
}

function pipe<
  const ID extends string,
  M extends FluidMedium,
>(
  id: ID,
  from: FluidOutPort<M>,
  to: FluidInPort<M>,
  options?: PipeOptions<M>,
): Pipe<ID, M>
~~~

This should make an electrical-to-fluid connection fail at type-check time before the Saturn compiler runs.

### 5.2 `cable()`

`cable()` describes a physical electrical/control connection.

The public API should distinguish at least the domain meaning of:

- power;
- analog;
- discrete/control.

Do not force all cable media into one untyped string when a useful generic type can be preserved.

### 5.3 Data buses

A data bus is not a pipe and should not be modeled as one.

Protocols such as CAN, Modbus/RS-485, Ethernet and field buses should get an explicit typed abstraction when their common contract is mature enough. Do not prematurely overload `cable()` or `pipe()` just to avoid adding a meaningful entity.

### 5.4 Signal dependencies are not physical topology

A relationship such as:

~~~ts
pump.flow -> alarm -> HMI
~~~

is data dependency, not a physical cable or pipe.

The Project IR and UI must keep these graphs distinct.

---

## 6. Units should protect engineering boundaries

TypeScript should prevent dimensionally invalid APIs where mistakes are expensive or common.

Prefer:

~~~ts
diameter: mm(100)
pressure: bar(6)
flow: m3h(12)
temperature: celsius(72)
~~~

over unqualified numbers when the unit is part of the contract.

Do not turn every scalar into a complex unit-algebra system. Use strong units primarily at engineering boundaries:

- length / diameter;
- pressure;
- temperature;
- flow;
- voltage;
- current;
- frequency / rotational speed;
- time where ambiguity is realistic.

Runtime IR may normalize units internally, but the authored API should remain explicit and type-safe.

---

## 7. CodeMirror is a host, not the language engine

Current CodeMirror syntax support is useful, but `javascript({ typescript: true })` only gives TypeScript parsing/highlighting. It is not enough for project-aware semantics.

Saturn language intelligence must come from a language-service layer.

### Desired browser composition

~~~ts
new EditorView({
  state: EditorState.create({
    doc,
    extensions: [
      basicSetup,
      javascript({ typescript: true }),
      saturnLanguage({
        workspace,
        locale,
      }),
    ],
  }),
})
~~~

`saturnLanguage()` should compose:

- completion;
- diagnostics;
- hover;
- signature help;
- go to definition;
- references;
- rename;
- inlay hints;
- code actions;
- Saturn source highlighting/selection integration.

### CodeMirror APIs

CodeMirror supports asynchronous completion sources and custom completion ranking/details through `@codemirror/autocomplete`.

Diagnostics should be projected through `@codemirror/lint`; quick fixes map naturally to diagnostic actions.

References:

- https://codemirror.net/docs/ref/
- https://codemirror.net/examples/autocompletion/
- https://codemirror.net/examples/lint/

---

## 8. Language-service architecture

Define a host-independent contract before wiring editor UI.

Example shape:

~~~ts
interface SaturnLanguageService {
  update(snapshot: ProjectSnapshot): Promise<void>

  completions(request: CompletionRequest): Promise<CompletionResult>
  hover(request: PositionRequest): Promise<HoverResult | null>
  signatureHelp(request: PositionRequest): Promise<SignatureHelp | null>

  definitions(request: PositionRequest): Promise<SourceLocation[]>
  references(request: PositionRequest): Promise<SourceLocation[]>

  rename(request: RenameRequest): Promise<WorkspaceEdit | RenameError>
  diagnostics(request: DiagnosticsRequest): Promise<SaturnDiagnostic[]>
  codeActions(request: CodeActionRequest): Promise<SaturnCodeAction[]>
  inlayHints(request: RangeRequest): Promise<InlayHint[]>
}
~~~

The UI must not know whether this is backed by:

- TypeScript native LSP;
- embedded TypeScript LanguageService;
- a browser Worker;
- another editor host.

### 8.1 Standalone Saturn

TypeScript 7 is native and its editor foundation uses LSP. Standalone Saturn should prefer the native TypeScript language server when practical.

Official TypeScript 7 announcement:

- https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/

Do not bind Saturn domain semantics directly to LSP message formats. LSP is one transport/provider behind `SaturnLanguageService`.

### 8.2 Browser/PWA Saturn

The browser needs an embedded TypeScript environment.

A practical implementation path is the TypeScript compiler/language service in a Worker with a virtual filesystem. The official TypeScript VFS exists specifically for controlled compiler and language-service environments:

- https://www.typescriptlang.org/dev/typescript-vfs/

The browser workspace should contain:

~~~text
/project/
  plant.ts
  systems/*.ts
  hmi/*.ts

/node_modules/
  @saturn/core/index.d.ts
  installed-extension declarations

/.saturn/
  generated.d.ts

/lib/
  TypeScript standard library declarations
~~~

Update the virtual file incrementally. Do not recreate the entire language service on each keystroke.

---

## 9. Saturn-aware completion

Raw TypeScript completion is not the desired UX.

The pipeline is:

~~~text
TypeScript completions
        +
project context
        +
extension metadata
        |
     filter/rank
        |
 CodeMirror completion
~~~

Example:

~~~ts
simulation('P-101', '█')
~~~

Preferred suggestions:

~~~text
pump
tank
valve
grundfos.cr95      @saturn/grundfos
...
~~~

Do not lead with irrelevant global JavaScript symbols.

Example:

~~~ts
pipe('suction', tank.█)
~~~

Preferred suggestions should be compatible fluid output ports, not internal fields.

The primary way to achieve this is a good public type shape. UI filtering is secondary.

### Completion item presentation

Canonical inserted identifier:

~~~text
flow
~~~

Localized display detail in Russian:

~~~text
flow    Расход · м³/ч
~~~

Localized display detail in English:

~~~text
flow    Flow · m³/h
~~~

Never localize the inserted code identifier.

---

## 10. Hover, signature help and inlay hints

### Hover

A Saturn hover should combine TypeScript and domain information.

Example for `pump.flow`:

~~~text
P-101.flow
Signal<number, "m³/h">

Расход
Источник: модель pump
Архивирование: deadband 0.1 / max interval 10 s

Используется:
  low-flow alarm
  operator HMI
  hourly-flow report

Live:
  12.42 m³/h · good
~~~

The live section is optional context. The source/type description must remain valid while offline.

### Signature help

For:

~~~ts
pipe('suction', █
~~~

show:

~~~text
pipe(
  name: string,
  from: FluidOutPort<M>,
  to: FluidInPort<M>,
  options?: PipeOptions<M>
): Pipe
~~~

Saturn may enrich the current parameter with compatible objects from the project.

### Inlay hints

Useful hints include:

~~~ts
parameters: {
  inertia: 1.6,        // s
  nominalFlow: 12,     // m³/h
}

pipe(
  'suction',
  tank.outlet,         // water · out
  pump.inlet,          // water · in
)
~~~

Do not add decorative hints that overwhelm normal TypeScript readability.

---

## 11. Diagnostics are structured and i18n-first

Never make the diagnostic message string the identity of an error.

Bad:

~~~ts
throw new AppError('Pipe input has incompatible medium')
~~~

Preferred internal form:

~~~ts
interface SaturnDiagnostic {
  code: string
  severity: 'error' | 'warning' | 'info'

  source: SourceLocation

  message: {
    key: string
    args: Record<string, string | number | boolean>
  }

  data?: Record<string, unknown>
  related?: RelatedLocation[]
  fixes?: SaturnCodeAction[]
}
~~~

Example:

~~~ts
{
  code: 'SATURN_PIPE_MEDIUM_MISMATCH',
  severity: 'error',
  message: {
    key: 'diagnostics.pipe.mediumMismatch',
    args: {
      from: 'tank.outlet',
      to: 'boiler.inlet',
      fromMedium: 'water',
      toMedium: 'steam',
    },
  },
  data: {
    fromMedium: 'water',
    toMedium: 'steam',
  },
}
~~~

### Russian rendering

~~~text
Труба соединяет несовместимые среды: вода → пар.
~~~

### English rendering

~~~text
Pipe connects incompatible media: water → steam.
~~~

The code remains:

~~~text
SATURN_PIPE_MEDIUM_MISMATCH
~~~

in every locale.

### Diagnostic JSON for agents

Machine output should include both localized display text and stable semantics:

~~~json
{
  "code": "SATURN_PIPE_MEDIUM_MISMATCH",
  "locale": "ru",
  "message": "Труба соединяет несовместимые среды: вода → пар.",
  "messageKey": "diagnostics.pipe.mediumMismatch",
  "data": {
    "fromMedium": "water",
    "toMedium": "steam"
  }
}
~~~

Agents should be able to reason from `code` and `data` without parsing translated prose.

---

## 12. i18n rules for types and metadata

### 12.1 Code identity is never translated

Keep stable canonical identifiers:

~~~text
FluidInPort
FluidOutPort
Signal
Pipe
Pressure
Flow
water
steam
pump.flow
~~~

Do not create locale-specific code such as:

~~~text
ВходЖидкости
AusgangRohr
~~~

This would break:

- Git diffs;
- extensions;
- documentation links;
- agent workflows;
- code search;
- interoperability.

### 12.2 Human descriptions are localized

A hover may show:

~~~text
FluidInPort<Water>
Вход трубопровода

Среда: вода
Направление: вход
~~~

or:

~~~text
FluidInPort<Water>
Pipe inlet

Medium: water
Direction: input
~~~

### 12.3 Localize metadata at the source

User-facing domain metadata should support localized text:

~~~ts
type LocalizedText =
  | string
  | {
      en: string
      ru?: string
      de?: string
      zh?: string
    }
~~~

Example model metadata:

~~~ts
defineModel('pump', {
  title: {
    en: 'Centrifugal pump',
    ru: 'Центробежный насос',
  },

  ports: {
    inlet: fluidIn({
      title: {
        en: 'Suction',
        ru: 'Всасывание',
      },
    }),

    outlet: fluidOut({
      title: {
        en: 'Discharge',
        ru: 'Нагнетание',
      },
    }),
  },
})
~~~

The same metadata should feed:

- completion detail;
- hover;
- inspector;
- DSL reference;
- generated HMI;
- reports where appropriate;
- diagnostics;
- agent schemas.

Do not maintain separate translation metadata for each UI.

---

## 13. TypeScript diagnostics and Saturn diagnostics

TypeScript and Saturn answer different questions.

TypeScript:

> Are these types compatible?

Saturn compiler:

> Is this a valid Saturn project/installation?

Example raw TypeScript error:

~~~text
TS2322
Type 'ElectricalOutPort' is not assignable to type 'FluidInPort<Water>'
~~~

When Saturn recognizes the domain types, the UI may wrap it with a domain diagnostic:

~~~text
SATURN_PORT_TYPE

Нельзя соединить электрический выход SATURN-1.DO1
с входом трубопровода P-101.inlet.

SATURN-1.DO1
  ElectricalOutPort<24V>

P-101.inlet
  FluidInPort<Water>

Underlying diagnostic: TypeScript TS2322
~~~

Do not hide the TypeScript code entirely; it is useful for developers and agents.

For ordinary TypeScript errors that have no domain interpretation, display the TypeScript diagnostic normally through the locale-aware presentation layer.

---

## 14. Code actions and semantic rename

Diagnostics should be actionable.

Example:

~~~text
SATURN_PIPE_MEDIUM_MISMATCH

Quick fixes:
  Connect to pump.inlet
  Show compatible ports
~~~

A code action is structured data, not a localized command string.

~~~ts
{
  id: 'connect-compatible-port',
  title: {
    key: 'fix.connectCompatiblePort',
    args: { port: 'pump.inlet' },
  },
  edit: ...
}
~~~

### Two rename operations

For:

~~~ts
const pump = simulation('P-101', 'pump', ...)
~~~

the IDE should distinguish:

1. **Rename TypeScript symbol**: `pump -> feedPump`.
2. **Rename Saturn identity**: `P-101 -> P-201`.

The second operation is Saturn-specific because it may affect:

- signal IDs;
- topology;
- HMI bindings;
- report references;
- alarms;
- history/migration warnings.

Never implement identity rename as blind text replacement.

---

## 15. Source mapping is part of the Project IR

Compiled entities need source identity.

Target concept:

~~~ts
interface SourceLocation {
  uri: string
  from: number
  to: number
}

interface ProjectEntitySource {
  entityId: string
  declaration: SourceLocation
  generatedFrom?: SourceLocation
}
~~~

This enables:

- go to definition from the diagram;
- diagnostics on exact source ranges;
- semantic rename;
- engineering diff;
- agent inspection;
- visual selection ↔ code selection;
- safe source-preserving edits.

Source ranges are ephemeral and tied to a specific source version. Never apply a visual edit computed against stale ranges.

---

## 16. Extensions must extend the language automatically

Installing an extension must be able to extend the TypeScript workspace.

Example:

~~~ts
declare module '@saturn/core' {
  interface ModelCatalog {
    'grundfos.cr95': GrundfosCR95
  }

  interface FluidCatalog {
    glycol: Glycol
  }
}
~~~

After installation, completion for:

~~~ts
simulation('P-201', '█')
~~~

should include the new model without a hard-coded editor change.

Extension metadata/types should provide enough information for:

- model names;
- model options;
- ports;
- signals;
- parameters;
- units;
- commands;
- localized documentation.

Trusted extension code and declarative project source remain different trust layers; see ADR-0002.

---

## 17. Coding-agent contract

The best agent integration is a strong software-engineering interface, not a special “AI generate” button.

A coding agent should be able to work using:

~~~text
filesystem
TypeScript / LSP
Git
tests
Saturn compiler
structured Saturn diagnostics
~~~

Target commands:

~~~sh
saturn check
saturn inspect P-101
saturn topology
saturn signals
saturn diff HEAD~1
saturn render
saturn simulate
~~~

These are semantic developer/agent APIs, not separate project models.

### 17.1 `saturn check`

Human mode may use localized text.

Machine mode must return stable JSON:

~~~json
{
  "diagnostics": [
    {
      "file": "systems/water.ts",
      "from": 412,
      "to": 428,
      "code": "SATURN_PIPE_MEDIUM_MISMATCH",
      "severity": "error",
      "messageKey": "diagnostics.pipe.mediumMismatch",
      "data": {
        "fromMedium": "water",
        "toMedium": "steam"
      },
      "fixes": [
        {
          "id": "connect-compatible-port",
          "data": {
            "port": "pump.inlet"
          }
        }
      ]
    }
  ]
}
~~~

### 17.2 `saturn inspect`

Target output should expose a semantic object graph:

~~~text
P-101
kind: pump
declaration: systems/water.ts:18
system: water

ports:
  inlet   FluidInPort<Water>
  outlet  FluidOutPort<Water>

signals:
  flow  Signal<Flow, "m³/h">
  rpm   Signal<Speed, "rpm">

consumers:
  low-flow alarm
  operator HMI
  hourly-flow report

connections:
  suction
  discharge
~~~

Provide a JSON mode for tools and agents.

### 17.3 Engineering diff

Git line diff is necessary but insufficient.

Target `saturn diff` example:

~~~text
Configuration impact

+ P-102 pump
+ suction-backup pipe
+ discharge-backup pipe

Changed
  AUTO-PUMP control logic

Runtime impact
  topology changed
  restart/re-apply required

Unaffected
  historian schema
  P-101 identity
~~~

CI should eventually be able to attach this semantic review to pull requests.

---

## 18. CodeMirror interaction with diagram and runtime

The editor, diagram and inspector should be different views of the same semantic graph.

Examples:

- cursor in a `pipe()` declaration -> highlight the pipe;
- cursor on `pump.rpm` -> select P-101 and the RPM signal;
- click equipment -> reveal source declaration;
- “Find references” -> show HMI/alarm/report consumers;
- “Open DSL docs” -> open the shell reference on the current symbol;
- runtime hover -> enrich static symbol data with current quality/value.

Do not let live telemetry modify project source or editor undo history.

---

## 19. Forbidden design shortcuts

Do not:

1. add regex completion for a new entity when TypeScript types can model it;
2. add a second signal identity for HMI;
3. localize code identifiers;
4. identify errors by English/Russian strings;
5. put runtime observations into TypeScript source;
6. use `pipe()` for arbitrary graph connections;
7. expose internal IR fields just because they are convenient to implement;
8. make CodeMirror the owner of project semantics;
9. duplicate extension metadata across compiler/editor/docs;
10. implement source rename with global string replacement;
11. return only human prose from agent-facing commands;
12. let an installed extension silently execute merely because a project references its name.

---

## 20. Implementation sequence

The migration should be incremental.

### Phase 1 — common diagnostics and i18n

- define `SaturnDiagnostic`, `SaturnCodeAction`, `LocalizedText`;
- replace new string-only domain errors with stable codes/message keys;
- add locale rendering at UI/CLI boundaries;
- preserve structured diagnostic data in tests.

### Phase 2 — language host boundary

- introduce `SaturnLanguageService`;
- keep CodeMirror integration behind that interface;
- make project snapshots/versioning explicit;
- move transitional hand-written completion behind the service.

### Phase 3 — stronger `@saturn/core` types

- typed simulation refs;
- typed ports;
- typed signals;
- literal model IDs;
- meaningful engineering units;
- remove public/internal `node` leakage.

### Phase 4 — TypeScript-backed browser tooling

- virtual workspace in Worker;
- TypeScript language service;
- completion;
- hover;
- signature help;
- diagnostics;
- definitions/references.

### Phase 5 — standalone TypeScript LSP

- connect the same host-independent contract to the TypeScript 7 language server;
- preserve identical Saturn diagnostics and metadata across browser/standalone;
- add rename, references, inlay hints and code actions.

### Phase 6 — agent CLI

- `saturn check --json`;
- `saturn inspect --json`;
- semantic `diff`;
- source-aware quick fixes;
- stable schemas/versioning.

### Phase 7 — remove duplicated intelligence

Delete or reduce legacy manual completion/metadata paths only after equivalent behavior has tests through the new language service.

---

## 21. Required tests for every new DSL entity

A new public DSL entity is not complete until tests cover:

- TypeScript type inference;
- allowed compiler syntax;
- invalid compiler syntax;
- source location;
- completion;
- hover/signature metadata;
- i18n title/description;
- structured diagnostics;
- shell DSL reference presence;
- extension interaction if extensible;
- machine-readable inspection;
- browser and standalone parity where relevant.

The existing DSL-reference invariant must continue to fail CI if a public DSL function exists without documentation metadata.

---

## 22. Review checklist

Before merging a language/DSL PR, ask:

- Can TypeScript express this constraint before runtime?
- Is there one canonical source of metadata?
- Does the public type expose domain concepts instead of compiler internals?
- Are IDs stable and locale-independent?
- Are user-facing descriptions localizable?
- Does every diagnostic have a stable code and structured data?
- Can a coding agent resolve the error without parsing prose?
- Does CodeMirror consume the language service instead of reimplementing semantics?
- Is source mapping preserved?
- Is this physical topology, signal dependency or runtime state?
- Does the change preserve one Project IR?
- Is the entity present in interactive DSL documentation?

If several answers are “no”, redesign before adding more editor-specific code.

---

## 23. External implementation references

- TypeScript 7: https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/
- TypeScript VFS: https://www.typescriptlang.org/dev/typescript-vfs/
- CodeMirror reference: https://codemirror.net/docs/ref/
- CodeMirror autocompletion: https://codemirror.net/examples/autocompletion/
- CodeMirror lint/diagnostics: https://codemirror.net/examples/lint/

These are implementation references, not Saturn architectural authorities. Saturn's stable contracts are the source types, compiler, ADRs and this guide.
