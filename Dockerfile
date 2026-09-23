ARG VERSION=0.3.0

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

FROM python:3.12-slim-bookworm
ARG VERSION
LABEL org.opencontainers.image.version="${VERSION}"
WORKDIR /app
COPY cloud115/requirements.txt /app/cloud115/requirements.txt
RUN pip install --no-cache-dir -r /app/cloud115/requirements.txt
COPY cloud115/worker.py cloud115/accounts.py cloud115/operations.py cloud115/errors.py cloud115/batch.py cloud115/file_operations.py cloud115/private_storage.py cloud115/hash_cache.py cloud115/details.py /app/cloud115/
ENV PYTHONDONTWRITEBYTECODE=1
COPY --from=backend /out/filebutler /usr/local/bin/filebutler
COPY --from=frontend /src/web/dist /app/web/dist
COPY configs/filebutler.docker.yaml /app/filebutler.yaml
EXPOSE 8080
ENTRYPOINT ["filebutler"]
CMD ["-config", "/app/filebutler.yaml"]
