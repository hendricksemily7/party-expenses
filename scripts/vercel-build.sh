#!/usr/bin/env sh
set -eu

attempt=1
max_attempts=5

while [ "$attempt" -le "$max_attempts" ]; do
  echo "Running prisma migrate deploy (attempt $attempt/$max_attempts)..."

  if npm run prisma:migrate:deploy; then
    echo "Migrations applied successfully."
    break
  fi

  if [ "$attempt" -eq "$max_attempts" ]; then
    echo "Migration failed after $max_attempts attempts."
    exit 1
  fi

  sleep_seconds=$((attempt * 5))
  echo "Migration attempt failed. Retrying in ${sleep_seconds}s..."
  sleep "$sleep_seconds"
  attempt=$((attempt + 1))
done

echo "Building Next.js app..."
npm run build
