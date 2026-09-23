# Saturn authoring DSL

The canonical project API is `@saturn/core`. Its implementation and contract live in the plant model; there is no second scene DSL.

See [plant/dsl.md](./plant/dsl.md) for the language reference and [ADR 0004](./adr/0004-package-and-dsl-names.md) for naming rules.

Physical topology is explicit:

```ts
import { pipe, cable } from '@saturn/core';

const suction = pipe('suction', tank.ports.outlet, pump.ports.inlet);
const power = cable('pump-power', drive.ports.output, pump.ports.power, { medium: 'power' });
```

`pipe()` is the authored fluid connection. A generic `connect()` is not part of the Saturn project API.
