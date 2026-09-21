# Saturn registry

The registry is intentionally boring: each item is source copied into the user's project.

```sh
saturn registry list
saturn add pump --project ./pump-station
saturn add hourly-water-report --project ./pump-station
```

There is no activation lifecycle, extension host, hidden install state or uninstall database. After copying, the files are ordinary project source and Git owns their history.

Use npm/Bun packages only for dependencies the project intentionally treats as external libraries.
