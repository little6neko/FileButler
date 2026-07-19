# FileButler

FileButler is a self-hosted dual-pane file manager for Linux and Docker deployments. It provides administrator initialization, root-bounded browsing, batch file operations, PowerRename-style batch rename, background jobs, audit records, and SQLite persistence.

## Local Build

Build the frontend assets:

```bash
npm --prefix web ci
npm --prefix web run build
```

Build the Linux binary:

```bash
go build -o bin/filebutler ./cmd/filebutler
```

Run with a config file:

```bash
./bin/filebutler -config configs/filebutler.example.yaml
```

## Docker

Prebuilt multi-architecture images for `linux/amd64` and `linux/arm64` are published to GitHub Container Registry:

```bash
docker pull ghcr.io/little6neko/filebutler:latest
docker pull ghcr.io/little6neko/filebutler:v0.1.0
```

The `latest` tag tracks the newest version release. Version tags such as `v0.1.0` are immutable releases. If the package is private, authenticate before pulling with a GitHub token that has `read:packages` permission:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u little6neko --password-stdin
```

Run a published image with mounted storage roots and SQLite data:

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/configs/filebutler.docker.yaml:/app/filebutler.yaml:ro" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/downloads:/data/downloads" \
  -v "$PWD/media:/data/media" \
  ghcr.io/little6neko/filebutler:${FILEBUTLER_TAG:-latest}
```

To build the image locally instead:

```bash
docker build -t filebutler:local .
```

Run the local image:

```bash
docker run --rm -p 8080:8080 \
  -v "$PWD/configs/filebutler.docker.yaml:/app/filebutler.yaml:ro" \
  -v "$PWD/data:/app/data" \
  -v "$PWD/downloads:/data/downloads" \
  -v "$PWD/media:/data/media" \
  filebutler:local
```

Or use Compose:

```bash
docker compose up --build
```

Open `http://127.0.0.1:8080`, create the first administrator account, then log in with that account. Initialization closes after the first administrator is created.

## Security

Use an HTTPS reverse proxy for production deployments. Do not expose FileButler directly to the public internet without network-level protection.
