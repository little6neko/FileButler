ARG VERSION=0.3.9

FROM node:25-alpine AS frontend
ARG VERSION
ENV VITE_APP_VERSION=${VERSION}
WORKDIR /src/web
COPY web/package*.json ./
RUN npm ci
COPY web ./
RUN npm run build

FROM golang:1.26-alpine AS backend
WORKDIR /src
RUN apk add --no-cache ca-certificates
COPY go.mod go.sum ./
RUN go mod download
COPY . .
COPY --from=frontend /src/web/dist ./web/dist
RUN CGO_ENABLED=0 go build -o /out/filebutler ./cmd/filebutler

FROM debian:bookworm-slim AS archive-tool
ARG TARGETARCH
WORKDIR /download
RUN apt-get update && apt-get install -y --no-install-recommends ca-certificates curl xz-utils && rm -rf /var/lib/apt/lists/*
RUN case "$TARGETARCH" in \
      amd64) arch=x64; checksum=dc99eff5008f1ab79bd7084c68513701547a808a89502bf4133683535ab3c695 ;; \
      arm64) arch=arm64; checksum=2389ba20e4d8295e8709c20b6263b69bd1ec4972fe38a04ad7a1badbf595b996 ;; \
      *) exit 1 ;; \
    esac && \
    curl -fsSL --retry 3 "https://7-zip.org/a/7z2603-linux-${arch}.tar.xz" -o archive.tar.xz && \
    echo "$checksum  archive.tar.xz" | sha256sum -c - && \
    tar -xJf archive.tar.xz 7zzs License.txt

FROM python:3.12-slim-bookworm
ARG VERSION
LABEL org.opencontainers.image.version="${VERSION}"
WORKDIR /app
COPY --from=archive-tool /download/7zzs /usr/local/bin/7zz
COPY --from=archive-tool /download/License.txt /usr/share/doc/7zip/License.txt
RUN 7zz i > /dev/null
COPY cloud115/requirements.txt /app/cloud115/requirements.txt
RUN pip install --no-cache-dir -r /app/cloud115/requirements.txt
COPY cloud115/worker.py cloud115/accounts.py cloud115/operations.py cloud115/errors.py cloud115/batch.py cloud115/file_operations.py cloud115/private_storage.py cloud115/hash_cache.py cloud115/details.py cloud115/transfer_statistics.py /app/cloud115/
ENV PYTHONDONTWRITEBYTECODE=1
RUN PYTHONPATH=/app/cloud115 python -c "import worker"
COPY --from=backend /out/filebutler /usr/local/bin/filebutler
COPY --from=frontend /src/web/dist /app/web/dist
COPY configs/filebutler.docker.yaml /app/filebutler.yaml
EXPOSE 8080
ENTRYPOINT ["filebutler"]
CMD ["-config", "/app/filebutler.yaml"]
