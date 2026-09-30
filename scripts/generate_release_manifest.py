#!/usr/bin/env python3
"""Build checksums.txt and manifest.json for a GitHub Release.

The workflow passes the artifacts it just built. This script does not walk the
checkout: a release checkout has no compiled WASM or npm tarballs until those
steps run, and a walk would hash unrelated files.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import sys
import tempfile
from pathlib import Path


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8192), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_image_digest(metadata_path: Path) -> str:
    data = json.loads(metadata_path.read_text(encoding="utf-8"))
    digest = data.get("containerimage.digest") or data.get("digest")
    if not isinstance(digest, str) or not digest.startswith("sha256:"):
        raise SystemExit(
            f"{metadata_path} has no containerimage.digest; the indexer image was not built"
        )
    return digest


def write_manifest(output_dir: Path, entries: list[dict]) -> None:
    if not entries:
        raise SystemExit("refusing to publish an empty release manifest")
    output_dir.mkdir(parents=True, exist_ok=True)
    checksums_path = output_dir / "checksums.txt"
    lines = []
    for entry in entries:
        if "filename" not in entry:
            continue
        lines.append(f"{entry['checksum']}  {entry['filename']}")
    checksums_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    manifest_path = output_dir / "manifest.json"
    manifest_path.write_text(json.dumps(entries, indent=2) + "\n", encoding="utf-8")
    print(f"Wrote {checksums_path} and {manifest_path} ({len(entries)} entries)")


def self_test() -> None:
    with tempfile.TemporaryDirectory() as tmp:
        root = Path(tmp)
        artifact = root / "sample.tgz"
        artifact.write_bytes(b"bc-forge")
        metadata = root / "image.json"
        metadata.write_text(
            json.dumps({"containerimage.digest": "sha256:" + "ab" * 32}),
            encoding="utf-8",
        )
        out = root / "out"
        entries = collect_entries(
            files=[("sdk", "1.2.3", artifact)],
            images=[("indexer", "1.0.0", "bc-forge-indexer", metadata)],
        )
        write_manifest(out, entries)
        checksums = (out / "checksums.txt").read_text(encoding="utf-8")
        expected = sha256_file(artifact)
        if not checksums.startswith(expected + "  sample.tgz"):
            raise SystemExit("self-test checksum mismatch")
        manifest = json.loads((out / "manifest.json").read_text(encoding="utf-8"))
        if manifest[1]["digest"] != "sha256:" + "ab" * 32:
            raise SystemExit("self-test image digest mismatch")
    print("self-test ok")


def collect_entries(
    files: list[tuple[str, str, Path]],
    images: list[tuple[str, str, str, Path]],
) -> list[dict]:
    entries: list[dict] = []
    for component, version, path in files:
        if not path.is_file():
            raise SystemExit(f"missing release file: {path}")
        checksum = sha256_file(path)
        entries.append(
            {
                "component": component,
                "version": version,
                "filename": path.name,
                "checksum": checksum,
            }
        )
    for component, version, image, metadata in images:
        digest = load_image_digest(metadata)
        entries.append(
            {
                "component": component,
                "version": version,
                "image": image,
                "digest": digest,
                "checksum": digest.removeprefix("sha256:"),
            }
        )
    return entries


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output-dir", default="release_assets")
    parser.add_argument(
        "--file",
        action="append",
        nargs=3,
        metavar=("COMPONENT", "VERSION", "PATH"),
        default=[],
        help="Downloadable file to hash. Repeat for each artifact.",
    )
    parser.add_argument(
        "--image",
        action="append",
        nargs=4,
        metavar=("COMPONENT", "VERSION", "NAME", "METADATA"),
        default=[],
        help="Indexer image. METADATA is a docker buildx metadata file.",
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args()

    if args.self_test:
        self_test()
        return

    files = [(item[0], item[1], Path(item[2])) for item in args.file]
    images = [(item[0], item[1], item[2], Path(item[3])) for item in args.image]
    entries = collect_entries(files, images)
    write_manifest(Path(args.output_dir), entries)


if __name__ == "__main__":
    try:
        main()
    except BrokenPipeError:
        sys.exit(0)
