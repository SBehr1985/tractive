# Stage 1: Web-App bauen
FROM node:20-alpine AS webapp
WORKDIR /webapp
COPY webapp/package.json webapp/package-lock.json ./
RUN npm ci
COPY webapp/ ./
RUN npm run build

# Stage 2: API
FROM python:3.12-slim
ENV PYTHONUNBUFFERED=1 PYTHONDONTWRITEBYTECODE=1
WORKDIR /app
COPY requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY api ./api
COPY core ./core
COPY db/schema.sql ./db/schema.sql
COPY --from=webapp /webapp/dist ./webapp/dist
RUN useradd --system --uid 1000 gassi
USER gassi
EXPOSE 8000
# Genau ein Prozess: der Zeitplan (Abgleich, 23:55) läuft im App-Prozess.
CMD ["uvicorn", "api.main:app", "--host", "0.0.0.0", "--port", "8000", "--proxy-headers", "--forwarded-allow-ips=*"]
