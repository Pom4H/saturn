# Industrial protocols and database drivers

Saturn production I/O is server-owned. The browser never opens a fieldbus socket and project source never contains protocol credentials.

## Project declaration

A project declares a logical external signal:

```ts
import { external, signal, derived } from '@scada/plant';

export const temperature = external('FURNACE.TEMP', {
  connection: 'opc-main',
  address: 'ns=2;s=Furnace.Temperature',
  unit: 'C',
  pollMs: 250,
  history: { deadband: 0.1, maxInterval: 5000, retention: 30 * 86400000 },
});

export const normalized = derived(
  'FURNACE.TEMP.NORMALIZED',
  signal('FURNACE.TEMP'),
  'C',
);
```

`connection` is a logical server connection ID. The project does not know its host, certificate, password or token.

A production project may contain no simulation models at all. External tags and/or controllers are sufficient.

## Server connections

Server-only configuration:

```json
{
  "connections": [
    {
      "id": "plc-main",
      "driver": "modbus-tcp",
      "readOnly": false,
      "options": {
        "host": "10.20.0.15",
        "port": 502,
        "unitId": 1
      }
    }
  ]
}
```

Set:

```sh
SATURN_CONNECTIONS_FILE=/run/secrets/saturn-connections.json
```

Do not commit production connection files.

## Driver ABI

Protocol drivers implement:

```ts
interface ProtocolDriver {
  kind: 'protocol';
  id: string;
  schemes: readonly string[];
  connect(config: ConnectionConfig): Promise<ProtocolSession>;
}

interface ProtocolSession {
  read(points: readonly ProtocolPoint[]): Promise<Record<string, DriverSample>>;
  write?(point: ProtocolPoint, value: number): Promise<void>;
  close(): Promise<void> | void;
}
```

Database drivers implement:

```ts
interface DatabaseDriver {
  kind: 'database';
  id: string;
  schemes: readonly string[];
  query(config: ConnectionConfig, request: {
    language: string;
    query: string;
    params?: unknown[] | Record<string, unknown>;
    maxRows: number;
    timeoutMs: number;
    readOnly: true;
  }): Promise<Record<string, unknown>[]>;
}
```

A trusted installed module exports:

```ts
export function installSaturn(registry: DriverRegistry) {
  registry.register(myProtocolDriver);
  registry.register(myDatabaseDriver);
}
```

and is loaded by the server/worker administrator:

```sh
SATURN_DRIVER_MODULES=@company/saturn-opcua,@company/saturn-clickhouse
```

Project files cannot import these packages.

## Built-in reference drivers

The MVP ships:

### Modbus TCP

Driver ID: `modbus-tcp`.

Addresses:

```text
holding:400:u16
holding:401:i16
input:120:u16
coil:10:bool
discrete:11:bool
```

The built-in driver implements FC 1/2/3/4 reads and FC 5/6 single-value writes for explicitly writable points.

It is deliberately small. Production deployments that need batching, 32/64-bit layouts, endian profiles, RTU, diagnostics or vendor-specific semantics should install a dedicated driver package rather than grow special cases in the kernel.

### SQLite

Driver ID: `sqlite`.

This is available under Node and Bun through the server adapter.

### Bun SQL

Driver ID: `bun-sql`, registered only when the worker/server runs on Bun.

It is intended for PostgreSQL, MySQL/MariaDB and SQLite connections supported by Bun's SQL API. Saturn still applies its own row, time and read-only job budgets.

## Protocol coverage strategy

Saturn does not put every industrial stack into the core package. The ABI is the compatibility surface.

Target adapters can cover, without kernel changes:

- OPC UA;
- Modbus TCP/RTU;
- MQTT and Sparkplug B;
- Siemens S7;
- EtherNet/IP / CIP;
- BACnet/IP;
- DNP3;
- IEC 60870-5-104;
- IEC 61850;
- CAN / CANopen / J1939;
- SNMP;
- vendor SDKs and serial gateways;
- existing OPC/fieldbus gateways through a sidecar.

Some protocols, especially real-time Ethernet stacks and vendor native SDKs, are better implemented as an isolated sidecar process close to the field network. The Saturn adapter then speaks to that sidecar. The same quality/timestamp contract still applies.

## Database coverage strategy

The database worker is similarly adapter-based. SQL is not hard-coded into the worker ABI: `language` is supplied to the selected driver.

Drivers can therefore expose read-only query languages for:

- PostgreSQL / TimescaleDB;
- MySQL / MariaDB;
- SQLite;
- Microsoft SQL Server;
- Oracle;
- ODBC data sources;
- ClickHouse;
- InfluxDB;
- historian vendor APIs;
- REST/query gateways;
- document/time-series databases through a driver-specific read language.

Every job is bounded by timeout, maximum rows and response size. Production credentials live only in worker/server configuration.

## Quality semantics

Protocol reads must return:

```ts
{ value, quality, time }
```

with quality one of `good | bad | stale | offline`.

Saturn marks a previously good value stale when its configured polling freshness is exceeded. Driver/read failures become bad/offline values, not numeric zero.

External samples then enter the same graph as model/controller outputs:

```text
driver -> external sample -> derived expressions -> alarms
                                    |             -> HMI
                                    |             -> historian
                                    +------------- -> reports
```

## Writes

The protocol ABI has a write method, but field writes are not exposed as arbitrary database-like operations. Production writes must go through declared controls and the server authorization/audit path.

Do not give report/database workers field-write credentials.
