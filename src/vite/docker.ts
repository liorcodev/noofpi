export interface DockerOptions {
  /** The project uses bun: `oven/bun` image and `bun install` */
  bun: boolean;
  /** The lockfile (`bun.lock` / `package-lock.json`) exists, so installs are reproducible */
  lock: boolean;
  port: number;
  /** Base image of both stages */
  image: string | undefined;
  /** Path the `HEALTHCHECK` requests, `false` for none */
  healthcheck: string | false;
}

/** What `COPY .` may send to the daemon: the build output and the files the dependency install needs */
export const DOCKERIGNORE = `*
!package.json
!package-lock.json
!bun.lock
!bun.lockb
!.output
.output/Dockerfile
.output/Dockerfile.dockerignore
`;

/**
 * Two stages: the first installs the production dependencies only, the second holds them with the build
 * output, so dev dependencies and the package manager cache never reach the image.
 */
export function dockerfile(options: DockerOptions): string {
  const { bun, lock, port, healthcheck } = options;
  const runtime = bun ? "bun" : "node";
  const image = options.image ?? (bun ? "oven/bun:1" : "node:22-alpine");
  const lockfile = bun ? "bun.lock*" : "package-lock.json*";
  const install = bun
    ? `bun install --production${lock ? " --frozen-lockfile" : ""}`
    : lock
      ? "npm ci --omit=dev"
      : "npm install --omit=dev";
  const probe = `fetch('http://127.0.0.1:'+(process.env.PORT||${port})+${JSON.stringify(healthcheck || "/")}).then(r=>process.exit(r.status<500?0:1),()=>process.exit(1))`;
  return [
    `FROM ${image} AS deps`,
    "WORKDIR /app",
    `COPY package.json ${lockfile} ./`,
    `RUN ${install}`,
    "",
    `FROM ${image}`,
    "WORKDIR /app",
    `ENV NODE_ENV=production PORT=${port}`,
    "COPY --from=deps /app/node_modules ./node_modules",
    "COPY package.json ./",
    "COPY .output .output",
    `USER ${bun ? "bun" : "node"}`,
    `EXPOSE ${port}`,
    ...(healthcheck === false
      ? []
      : [
          `HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 CMD ${JSON.stringify([runtime, "-e", probe])}`,
        ]),
    `CMD ["${runtime}", ".output/server/start.mjs"]`,
    "",
  ].join("\n");
}
