# Third-party notices

Saturn itself is licensed under MIT. Some vendored target/profile components retain their upstream licenses.

## Firmverse portable Saturn toolchain

Pinned source: `Pom4H/firmverse@2a960fd1cfa068296cd96d9b0b501c66c36140dd`.

The copied package, its license and embedded runtime license are preserved under:

```text
plant/vendor/firmverse/
```

See [provenance](plant/vendor/firmverse/PROVENANCE.md).

## Saturn FBD profile / Open Device

Pinned source: `Pom4H/open-device@007ada38d2cce27b37413f38952ca11b919842c1`.

The profile is redistributed under Apache-2.0. Its embedded FBD runtime is MIT, copyright 2014 Alexey Lutovinin. The corresponding notices are preserved under:

```text
plant/vendor/saturn/
```

See [provenance](plant/vendor/saturn/PROVENANCE.md).

Built PWA artifacts include the applicable third-party notice file. Redistributors should preserve these notices and re-check provenance when updating pinned target assets.
