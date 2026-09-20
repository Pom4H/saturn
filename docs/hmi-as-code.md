# HMI as code

Saturn HMI is a typed application model, not serialized React callbacks.

```text
project.ts
   |
   v
HmiApplication
   |
   +-- screens / routes
   +-- bindings
   +-- typed actions
   +-- dialogs
   |
   v
renderer / target
   |
   +-- React -> HTML / SVG application shell
   +-- Firmverse Saturn display emulator -> 320x240 vector frames
   +-- FBD screen projection -> compatibility fallback
   +-- future C23/satgui physical projection
```

The application model stays serializable and inspectable by Studio. React is only a projection.

## Screens and routes

```ts
const main = screen('main', {
  route: '/',
  body: button('openP101', 'P101', navigate('pump', { id: 'P101' })),
})

const pump = screen('pump', {
  route: '/pump/:id',
  body: [
    readout('current', bind('P101.current'), { unit: 'A', digits: 1 }),
    button('start', 'Пуск', command('P101', 'start')),
  ],
})
```

A screen is URL-addressable. `/pump/P101` can be opened directly and resolved back to `screen('pump')`.

## Actions

The common operator paths are data:

```ts
navigate(screen)
back()
command('P101', 'start')
write('P101.speedSetpoint', 1450)
toggle('P101.auto')
open(dialog)
close()
ack('P101.fault')
sequence(...)
confirm('Остановить насос?', command('P101', 'stop'))
script('customWorkflow')
```

A renderer turns a button into a normal browser click handler, but the callback only dispatches the action already present in HMI IR. Studio can therefore inspect and rewrite the behavior without parsing arbitrary JavaScript.

`script()` is the explicit escape hatch. It names trusted host code; executable functions are not embedded in project IR.

## Runtime boundary

`HmiRuntime` owns only application state: current screen, route parameters, dialogs and signal values. Side effects are injected through `HmiEnvironment`.

```ts
const runtime = new HmiRuntime(operatorHmi, {
  command: cmd => runtimeClient.command(runId, cmd),
  write: (signal, value) => control.write(signal, value),
  ack: alarm => alarms.ack(alarm),
  confirm: message => window.confirm(message),
})
```

This keeps the same HMI usable with a simulated runtime, Saturn server, Firmverse, or a future native shell.

## React

Saturn does not make React part of the project format. The adapter accepts the React API from the host:

```ts
const HmiRenderer = createReactHmiRenderer(React)

root.render(
  <HmiRenderer
    runtime={runtime}
    equipment={{
      pump: PumpSvg,
      valve: ValveSvg,
    }}
  />
)
```

Equipment renderers may return ordinary HTML or SVG. The same HMI model can therefore use semantic HTML for controls/tables and SVG for process equipment without another project representation.

## Safety

Operator commands are semantic commands, not raw register writes by default:

```ts
command('P101', 'start')
```

The command adapter remains responsible for authorization, interlocks, live/revision checks and transport retry policy. A React button never gets direct PLC transport access.


## Saturn 320x240 display target

The front-panel preview is not allowed to invent equipment motion in CSS. A
target-specific scene is evaluated by `SaturnDisplayEmulator` from Firmverse.

```text
topology + bindings
        |
        v
SaturnDisplayScene
        |
        +-- tank(level)
        +-- pump(rpm)
        +-- flow(flow)
        +-- lamp(state)
        +-- text / geometry
        |
        v
Firmverse SaturnDisplayEmulator
        |
        | model time + live signals
        v
DisplayDrawCommand[]     <- positions already animated here
        |
        v
React SVG projection     <- drawing only
```

Rotor angle, moving flow packets, reservoir waterline and lamp pulse are
calculated from supplied model time and signal values inside Firmverse. Rendering
twice at the same model time is observation-only. Browser tests also assert that
visible Firmverse commands have no CSS/WebAnimation motion.

This contract is deliberately separate from the legacy FBD screen records. FBD
screens stay useful as a bounded compatibility and diagnostic target. A richer
physical Saturn implementation can map the same display scene/frame contract to
the controller's native graphics API instead of reducing the design to FBD
rectangles and text.
