# Admin proptest regressions

The `.txt` files in `tests/` are compact proptest seed corpora. They replay
before new cases run in the regular unit-test job and in the nightly extended
run. Keep failure seeds here; do not add generated `test_snapshots/` JSON as
property-test corpora.

When a property test finds a failure, proptest prints the seed and writes it to
the matching corpus file. Preserve that seed, add a short comment explaining
the failure when practical, and commit the changed `.txt` file with the fix.
For a new property-test module, configure `FileFailurePersistence::Direct` to
point at a file under this directory so CI replays it.

Run the standard admin tests with:

```sh
cargo test -p bc-forge-admin
```

Run a longer local fuzz pass with:

```sh
PROPTEST_CASES=2000 cargo test -p bc-forge-admin
```
