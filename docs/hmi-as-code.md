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
renderer
   |
   +-- React -> HTML / SVG
   +-- future native / 3D projections
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
