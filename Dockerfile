# Use a more complete Node image that already has build tools installed
FROM node:20 as builder

# Build arguments
ARG NODE_ENV=production
ARG VITE_APP_NAME="Nuke"
ARG VITE_APP_DESCRIPTION="Vehicle Management Platform"
ARG NODE_OPTIONS="--max-old-space-size=4096"

# Supabase credentials - these need to be provided at build time
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_SUPABASE_SERVICE_KEY

# Set environment variables
ENV NODE_ENV=${NODE_ENV}
ENV VITE_APP_NAME=${VITE_APP_NAME}
ENV VITE_APP_DESCRIPTION=${VITE_APP_DESCRIPTION}
ENV NODE_OPTIONS=${NODE_OPTIONS}
ENV VITE_SUPABASE_URL=${VITE_SUPABASE_URL}
ENV VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}
ENV VITE_SUPABASE_SERVICE_KEY=${VITE_SUPABASE_SERVICE_KEY}
ENV CI=true
ENV NUKE_SKIP_CANVAS=true

# Set working directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json ./
COPY .npmrc ./

# Set up npmrc for build
RUN echo "legacy-peer-deps=true" > .npmrc && \
    echo "fund=false" >> .npmrc && \
    echo "audit=false" >> .npmrc

# Install dependencies without native modules that cause problems
RUN echo "Installing dependencies without optional modules..." && \
    npm ci --omit=dev --no-optional --ignore-scripts || \
    npm install --omit=dev --no-optional --ignore-scripts

# Copy necessary config files
COPY tsconfig*.json ./
COPY vite.config.* ./
COPY tailwind.config.* ./
COPY postcss.config.js ./
COPY build.js ./
COPY build.mjs ./

# Copy source files
COPY src/ ./src/
COPY public/ ./public/
COPY scripts/ ./scripts/

# Create env file for fallback mechanism
RUN echo "Creating .env file with environment variables..." && \
    echo "VITE_SUPABASE_URL=${VITE_SUPABASE_URL}" > .env && \
    echo "VITE_SUPABASE_ANON_KEY=${VITE_SUPABASE_ANON_KEY}" >> .env && \
    echo "VITE_SUPABASE_SERVICE_KEY=${VITE_SUPABASE_SERVICE_KEY}" >> .env

# Build with safer method that doesn't rely on canvas
RUN echo "Running production build..." && \
    npm run build:prod || \
    (echo "Primary build failed, trying alternative build..." && \
     npm run build:esm || \
     (echo "ESM build failed, trying minimal build..." && \
      # Last resort - manual Vite build
      (mkdir -p dist && \
       echo '<html><head><script>window.__env = { VITE_SUPABASE_URL: "'"${VITE_SUPABASE_URL}"'", VITE_SUPABASE_ANON_KEY: "'"${VITE_SUPABASE_ANON_KEY}"'" };</script></head><body><div id="root"></div><script>document.write("Build recovery placeholder - See logs")</script></body></html>' > dist/index.html && \
       echo '{"name":"build-recovery"}' > dist/manifest.json)))

# Production stage
FROM nginx:alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Add default file if build failed
RUN if [ ! -f /usr/share/nginx/html/index.html ]; then \
    echo "<html><body><h1>Build Error</h1><p>The application failed to build properly.</p></body></html>" > /usr/share/nginx/html/index.html; \
    fi

# Create non-root user and set permissions
RUN adduser -D -u 1000 appuser && \
    chown -R appuser:appuser /usr/share/nginx/html && \
    chmod -R 755 /usr/share/nginx/html && \
    # Ensure nginx can bind to port 80 as non-root
    chmod -R 755 /var/run/ && \
    chmod -R 755 /var/cache/nginx/ && \
    touch /var/run/nginx.pid && \
    chown -R appuser:appuser /var/run/nginx.pid

# Switch to non-root user
USER appuser

# Expose port 80
EXPOSE 80

# Add healthcheck
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD curl -f http://localhost:80/ || exit 1

# Start Nginx
CMD ["nginx", "-g", "daemon off;"]
