FROM oven/bun:1
WORKDIR /app

COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production

COPY src ./src
COPY tsconfig.json ./

RUN mkdir -p /app/data && chown bun:bun /app/data
VOLUME ["/app/data"]
EXPOSE 3000

USER bun
CMD ["bun", "run", "src/index.ts"]
