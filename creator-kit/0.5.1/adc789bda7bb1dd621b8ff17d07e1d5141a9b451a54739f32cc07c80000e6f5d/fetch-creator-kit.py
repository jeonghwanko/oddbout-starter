"""Download a hash-pinned public ODDBOUT kit. Never log in, execute it or change network policy."""
import argparse
import hashlib
import json
import os
import pathlib
import re
import stat
import sys
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import zipfile

ORIGIN = "https://oddbout.com"
MAX_ARCHIVE = 20_000_000
MAX_EXPANDED = 128_000_000
MAX_FILES = 10_000
MAX_MANIFEST = 64_000
HASH = re.compile(r"[a-f0-9]{64}\Z")
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
REQUIRED_RUNTIME = {
    "package.json", "package-lock.json", "AGENTS.md", "mcp/server.mjs",
    "scripts/creation-tool.mjs", "scripts/sprite-gen.mjs", "docs/DELIVERY.md",
    "vendor/sprite-gen/LICENSE", "vendor/sprite-gen/NOTICE", "vendor/sprite-gen/SKILL.md",
    "vendor/sprite-gen/pyproject.toml", "vendor/sprite-gen/sprite_gen/cli.py",
}


class KitError(Exception):
    pass


def require(condition, code):
    if not condition:
        raise KitError(code)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return (json.dumps(value, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def unique_object(pairs):
    result = {}
    for key, value in pairs:
        require(key not in result, "duplicate-json-key")
        result[key] = value
    return result


def parse_json(data):
    try:
        return json.loads(data, object_pairs_hook=unique_object)
    except (ValueError, UnicodeError) as error:
        raise KitError("invalid-json") from error


def safe_path(name):
    require(isinstance(name, str) and 0 < len(name) <= 240, "unsafe-archive-path")
    require(unicodedata.normalize("NFC", name) == name, "noncanonical-archive-path")
    require(not re.search(r'[\\:\x00-\x1f\x7f<>"|?*]', name), "unsafe-archive-path")
    parts = name.split("/")
    for part in parts:
        require(part not in ("", ".", "..") and not part.endswith((" ", ".")), "unsafe-archive-path")
        base = part.split(".")[0].upper()
        require(base not in {"CON", "PRN", "AUX", "NUL", *(f"COM{i}" for i in range(10)),
                             *(f"LPT{i}" for i in range(10))}, "reserved-archive-path")
        require(part.casefold() not in {".git", ".ssh", ".venv", "node_modules", "__pycache__", "output", "outputs"}
                and not part.casefold().startswith(".env"), "private-or-generated-archive-path")
    return parts


def inspect_archive(archive_path):
    archive_path = pathlib.Path(archive_path)
    require(archive_path.is_file() and not archive_path.is_symlink(), "archive-not-regular-file")
    require(0 < archive_path.stat().st_size <= MAX_ARCHIVE, "archive-size-limit")
    archive_hash = hashlib.sha256()
    with archive_path.open("rb") as stream:
        while chunk := stream.read(65536):
            archive_hash.update(chunk)
    with zipfile.ZipFile(archive_path) as archive:
        entries = archive.infolist()
        require(0 < len(entries) <= MAX_FILES, "archive-file-count-limit")
        names, regular, expanded = {}, {}, 0
        for entry in entries:
            require(entry.filename == entry.orig_filename, "unsafe-archive-path")
            name = entry.filename.removesuffix("/") if entry.is_dir() else entry.filename
            safe_path(name)
            key = name.casefold()
            require(key not in names, "duplicate-archive-path")
            names[key] = entry.is_dir()
            kind = stat.S_IFMT(entry.external_attr >> 16)
            require(kind in ((0, stat.S_IFDIR) if entry.is_dir() else (0, stat.S_IFREG)), "nonregular-archive-entry")
            require(not entry.flag_bits & 1, "encrypted-archive-entry")
            require(entry.compress_type in (zipfile.ZIP_STORED, zipfile.ZIP_DEFLATED), "unsupported-zip-compression")
            expanded += entry.file_size
            require(0 <= entry.file_size <= 32_000_000 and expanded <= MAX_EXPANDED, "expanded-size-limit")
            if not entry.is_dir():
                regular[name] = entry
        for name in names:
            parts = name.split("/")
            require(all(names.get("/".join(parts[:i]), True) for i in range(1, len(parts))), "archive-file-directory-conflict")
        require({"plugin.json", ".app.json", "launcher.mjs", "runtime-manifest.json"} <= regular.keys(), "missing-plugin-files")
        require("kit-location.json" not in regular and "mcp.json" not in regular, "nonportable-plugin")
        require(regular["runtime-manifest.json"].file_size <= 2_000_000 and
                regular["plugin.json"].file_size <= MAX_MANIFEST, "metadata-size-limit")
        metadata = parse_json(archive.read("plugin.json"))
        require(isinstance(metadata, dict) and metadata.get("name") == "oddbout", "unexpected-plugin")
        version = metadata.get("version", "")
        require(isinstance(version, str) and VERSION.fullmatch(version), "invalid-kit-version")
        require(metadata.get("extensions", {}).get("com.openai", {}).get("requires_local_executor") is not True,
                "desktop-only-plugin")
        manifest_bytes = archive.read("runtime-manifest.json")
        manifest = parse_json(manifest_bytes)
        require(isinstance(manifest, dict) and manifest.get("schemaVersion") == 1 and
                manifest.get("distribution") == "source" and manifest.get("platform") == "any" and
                manifest.get("arch") == "any", "unsupported-runtime-manifest")
        hashes = manifest.get("files")
        require(isinstance(hashes, dict) and REQUIRED_RUNTIME <= hashes.keys(), "missing-runtime-files")
        require(set(hashes) == {name.removeprefix("runtime/") for name in regular if name.startswith("runtime/")},
                "runtime-inventory-mismatch")
        for relative, expected in hashes.items():
            safe_path(relative)
            require(isinstance(expected, str) and HASH.fullmatch(expected), "invalid-runtime-hash")
            actual = hashlib.sha256()
            with archive.open("runtime/" + relative) as stream:
                while chunk := stream.read(65536):
                    actual.update(chunk)
            require(actual.hexdigest() == expected, "runtime-integrity-failed")
        # Read every non-runtime entry too, to catch corrupt CRCs before extracting anything.
        for name in regular:
            if not name.startswith("runtime/"):
                with archive.open(name) as stream:
                    while stream.read(65536):
                        pass
    return {"name": "oddbout", "version": version, "bytes": archive_path.stat().st_size,
            "sha256": archive_hash.hexdigest(), "runtimeManifestSha256": digest(manifest_bytes),
            "files": len(regular), "expandedBytes": expanded}


def validate_url(url):
    require(isinstance(url, str) and url.startswith(ORIGIN + "/creator-kit/"), "unapproved-download-origin")
    parsed = urllib.parse.urlsplit(url)
    require(parsed.scheme == "https" and parsed.netloc == "oddbout.com" and not parsed.query and not parsed.fragment,
            "unsafe-download-url")
    require("%" not in parsed.path and not re.search(r"[\\\s\x00-\x1f]", url), "unsafe-download-url")
    safe_path(parsed.path.lstrip("/"))
    return url


def validate_release(data, expected_hash):
    require(isinstance(expected_hash, str) and HASH.fullmatch(expected_hash), "reviewed-manifest-hash-required")
    require(len(data) <= MAX_MANIFEST and digest(data) == expected_hash, "release-integrity-failed")
    release = parse_json(data)
    require(isinstance(release, dict) and set(release) == {
        "schemaVersion", "name", "version", "artifact", "bootstrap", "runtimeManifestSha256"}, "invalid-release-fields")
    require(release["schemaVersion"] == 1 and release["name"] == "oddbout" and
            isinstance(release["version"], str) and VERSION.fullmatch(release["version"]), "invalid-release")
    require(isinstance(release["runtimeManifestSha256"], str) and HASH.fullmatch(release["runtimeManifestSha256"]),
            "invalid-runtime-manifest-hash")
    for key, maximum in (("artifact", MAX_ARCHIVE), ("bootstrap", 1_000_000)):
        item = release[key]
        require(isinstance(item, dict) and set(item) == {"url", "bytes", "sha256"}, "invalid-release-file")
        require(type(item["bytes"]) is int and 0 < item["bytes"] <= maximum and
                isinstance(item["sha256"], str) and HASH.fullmatch(item["sha256"]), "invalid-release-file")
        validate_url(item["url"])
    release_id = digest((release["artifact"]["sha256"] + "\n" + release["bootstrap"]["sha256"] + "\n").encode())
    prefix = f'{ORIGIN}/creator-kit/{release["version"]}/{release_id}/'
    require(release["artifact"]["url"] == prefix + f'oddbout-{release["version"]}.zip' and
            release["bootstrap"]["url"] == prefix + "fetch-creator-kit.py", "release-url-mismatch")
    return release, prefix + "release.json"


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise KitError("download-redirect-rejected")


def fetch_bytes(url, maximum, *, open_url=None):
    validate_url(url)
    # Keep the host's proxy and certificate configuration. No credential/session loading.
    opener = open_url or urllib.request.build_opener(NoRedirect()).open
    request = urllib.request.Request(url, headers={"User-Agent": "ODDBOUT-kit/1", "Accept-Encoding": "identity"})
    started, chunks, total = time.monotonic(), [], 0
    try:
        with opener(request, timeout=30) as response:
            require(response.status == 200, "download-status-not-200")
            require(response.geturl() == url, "download-redirect-rejected")
            require(response.headers.get("Content-Encoding", "identity") == "identity", "encoded-download-rejected")
            length = response.headers.get("Content-Length")
            if length is not None:
                require(length.isdigit() and int(length) <= maximum, "download-size-limit")
            while chunk := response.read(min(65536, maximum + 1 - total)):
                total += len(chunk)
                require(total <= maximum, "download-size-limit")
                require(time.monotonic() - started <= 120, "download-deadline")
                chunks.append(chunk)
            require(length is None or total == int(length), "download-truncated")
    except urllib.error.HTTPError as error:
        raise KitError(f"download-http-{error.code}") from error
    except (urllib.error.URLError, TimeoutError, OSError) as error:
        # Do not echo proxy URLs, headers or lower-level credential-bearing error strings.
        raise KitError("download-network-failed") from error
    return b"".join(chunks)


def install(*, manifest_hash, destination, manifest_url=None, manifest_file=None, archive_file=None):
    require(bool(manifest_url) != bool(manifest_file), "one-release-source-required")
    require(not archive_file or manifest_file, "offline-archive-requires-local-manifest")
    destination = pathlib.Path(destination)
    require(destination.is_absolute() and destination.parent.is_dir(), "new-absolute-destination-required")
    require(os.path.normcase(str(destination.resolve())) == os.path.normcase(os.path.abspath(destination)),
            "destination-link-rejected")
    require(not destination.exists() and not destination.is_symlink(), "destination-already-exists")
    require(isinstance(manifest_hash, str) and HASH.fullmatch(manifest_hash), "reviewed-manifest-hash-required")
    if manifest_url:
        validate_url(manifest_url)
    destination.mkdir()  # Exclusive reservation: a retry cannot overwrite a previous attempt.
    stage = "release-download"
    result_path = destination / "install-result.json"
    try:
        if manifest_file:
            require(pathlib.Path(manifest_file).stat().st_size <= MAX_MANIFEST, "release-size-limit")
            data = pathlib.Path(manifest_file).read_bytes()
        else:
            data = fetch_bytes(manifest_url, MAX_MANIFEST)
        release, expected_url = validate_release(data, manifest_hash)
        require(not manifest_url or manifest_url == expected_url, "release-url-mismatch")
        (destination / "release.json").write_bytes(data)
        stage = "archive-download"
        artifact = release["artifact"]
        archive_path = destination / "package.zip"
        if archive_file:
            require(pathlib.Path(archive_file).stat().st_size == artifact["bytes"], "archive-size-mismatch")
            archive_data = pathlib.Path(archive_file).read_bytes()
        else:
            archive_data = fetch_bytes(artifact["url"], artifact["bytes"])
        require(len(archive_data) == artifact["bytes"] and digest(archive_data) == artifact["sha256"], "archive-integrity-failed")
        with archive_path.open("xb") as stream:
            stream.write(archive_data)
        stage = "archive-verification"
        inspected = inspect_archive(archive_path)
        require(inspected["version"] == release["version"] and
                inspected["runtimeManifestSha256"] == release["runtimeManifestSha256"], "release-content-mismatch")
        stage = "extraction"
        plugin = destination / "plugin"
        plugin.mkdir()
        with zipfile.ZipFile(archive_path) as archive:
            for entry in archive.infolist():
                if entry.is_dir():
                    continue
                target = plugin.joinpath(*safe_path(entry.filename))
                target.parent.mkdir(parents=True, exist_ok=True)
                with archive.open(entry) as source, target.open("xb") as output:
                    while chunk := source.read(65536):
                        output.write(chunk)
        result = {"status": "verified-and-extracted", "transport": "local-archive" if archive_file else "https",
                  "releaseSha256": manifest_hash, "artifact": inspected, "plugin": str(plugin),
                  "execution": "not-run", "dependencies": "not-installed", "generation": "not-run",
                  "nextStep": "Use a separate per-user runtime/workspace to run node launcher.mjs --status; then install locked dependencies."}
        result_path.write_bytes(json_bytes(result))
        return result
    except Exception as error:
        code = str(error) if isinstance(error, KitError) else type(error).__name__
        result_path.write_bytes(json_bytes({"status": "failed", "stage": stage, "error": code,
                                           "execution": "not-run", "retry": "Inspect this attempt; use a new empty destination."}))
        raise KitError(code) from error


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    inspect = commands.add_parser("inspect", help="Verify an existing archive without extracting or executing it")
    inspect.add_argument("archive")
    download = commands.add_parser("download", help="Verify a reviewed release and extract into a new directory")
    source = download.add_mutually_exclusive_group(required=True)
    source.add_argument("--manifest-url")
    source.add_argument("--manifest-file")
    download.add_argument("--manifest-sha256", required=True)
    download.add_argument("--destination", required=True)
    download.add_argument("--archive", help="Existing ZIP for offline verification; requires --manifest-file")
    args = parser.parse_args()
    try:
        result = inspect_archive(args.archive) if args.command == "inspect" else install(
            manifest_hash=args.manifest_sha256, destination=args.destination, manifest_url=args.manifest_url,
            manifest_file=args.manifest_file, archive_file=args.archive)
        print(json.dumps(result, ensure_ascii=False, indent=2))
        return 0
    except Exception as error:
        print(json.dumps({"status": "failed", "error": str(error) if isinstance(error, KitError) else type(error).__name__}), file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
