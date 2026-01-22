# Use the same Node image
FROM node:20-bullseye

# FIX: Install Go 1.21 (or newer) by copying it from the official Go image
# This replaces the old 'apt-get install golang' which gave you the error
COPY --from=golang:1.23-bullseye /usr/local/go /usr/local/go
ENV PATH="/usr/local/go/bin:${PATH}"

WORKDIR /app

# 1. Copy dependency definitions
COPY package*.json ./
COPY go-etl/go.mod go-etl/go.sum ./go-etl/

# 2. Install Node dependencies
RUN npm ci

# 3. Copy the rest of the application source
COPY . .

# 4. Build the Go ETL tool
# We output the binary to /app/bin/go-etl
RUN cd go-etl && go build -o ../bin/go-etl ./cmd/go-etl

# 5. Generate Prisma Client
RUN npx prisma generate

# 6. Build Next.js application
RUN npm run build

# 7. Set environment variables
ENV NODE_ENV=production
# Ensure the database URL points to the volume mount location
ENV DATABASE_URL="file:/app/prisma/dev.db"

# 8. Expose the port Next.js runs on
EXPOSE 3000

# 9. Start command: Run migrations, then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]