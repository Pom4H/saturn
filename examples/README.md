# Saturn examples

| Directory | Contents | Run |
|---|---|---|
| first-pump | Small public @saturn/core project | See its README |
| consumer | External package consumer and type contract | npm run test:consumer |
| pumping | Multi-file starter copied by the IDE | npm run site:dev |
| landing | Canonical pipe/cable project used in the landing | npm run site:dev |
| pump-bank | Downloadable 1/4/8-pump projects | npm run site:check |
| hydraulic-loop | Illustrative hydraulic simulation and its visual demo | npm run site:dev |
| plant | Multi-system training installation, reports and commissioning | npm run plant |
| diagram | Bounded scene-DSL editor, example circuits and opt-in series-flow preview | npm run dev |
| elements-lab | Equipment visual review application and fixtures | npm run lab |

Demo source is deliberately outside the library. Product adapters may explicitly load an example as a starter. The compiler, component registry and renderers do not select or import an example. Renderers only run a demo preview when the host injects it; live frames always take precedence. The plant runtime, drivers, authoring compiler and operator UI remain in plant/ because they are product implementation, not a sample project.
