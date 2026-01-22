# Use a Debian-based Node image (easier for SQLite/CGO than Alpine)
FROM node:20-bullseye

# 1. Install Go (required to build your ETL tool)
RUN apt-get update && \
    apt-get install -y golang && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

# 2. Copy dependency definitions
COPY package*.json ./
COPY go-etl/go.mod go-etl/go.sum ./go-etl/

# 3. Install Node dependencies
RUN npm ci

# 4. Copy the rest of the application source
COPY . .

# 5. Build the Go ETL tool
# We output the binary to /app/bin/go-etl
RUN cd go-etl && go build -o ../bin/go-etl ./cmd/go-etl

# 6. Generate Prisma Client
RUN npx prisma generate

# 7. Build Next.js application
RUN npm run build

# 8. Set environment variables
ENV NODE_ENV=production
ENV DATABASE_URL="file:/app/prisma/dev.db"

# 9. Expose the port Next.js runs on
EXPOSE 3000

# 10. Start command: Run migrations, then start the server
CMD ["sh", "-c", "npx prisma migrate deploy && npm start"]