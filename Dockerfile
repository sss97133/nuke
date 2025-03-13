# Build stage
FROM node:20-alpine as builder

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./
COPY .npmrc ./

# Install dependencies and build tools with retry mechanism
RUN apk add --no-cache python3 make g++ && \
    npm config set fetch-retries 5 && \
    npm config set fetch-retry-mintimeout 100000 && \
    npm config set fetch-retry-maxtimeout 600000 && \
    npm ci && \
    npm install typescript && \
    npm install vite @vitejs/plugin-react && \
    ./node_modules/.bin/tsc --version

# Copy configuration files
COPY tsconfig*.json ./
COPY vite.config.* ./
COPY tailwind.config.* ./
COPY postcss.config.js ./
COPY index.html ./

# Copy source files
COPY src/ ./src/
COPY public/ ./public/

# Build arguments for environment variables
ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_API_URL

# Set environment variables
ENV VITE_SUPABASE_URL=$VITE_SUPABASE_URL
ENV VITE_SUPABASE_ANON_KEY=$VITE_SUPABASE_ANON_KEY
ENV VITE_API_URL=$VITE_API_URL
ENV PATH=/app/node_modules/.bin:$PATH

# Build the application
RUN npm run build:prod

# Production stage
FROM nginx:alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Create non-root user
RUN adduser -D -u 1000 appuser

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

# Change ownership of nginx directories
RUN chown -R appuser:appuser /var/cache/nginx && \
    chown -R appuser:appuser /var/log/nginx && \
    chown -R appuser:appuser /etc/nginx/conf.d && \
    touch /var/run/nginx.pid && \
    chown -R appuser:appuser /var/run/nginx.pid && \
    chmod -R 755 /usr/share/nginx/html

# Switch to non-root user
USER appuser

# Expose port 8080 instead of 80
EXPOSE 8080

# Health check
HEALTHCHECK --interval=30s --timeout=3s \
    CMD curl -f http://localhost:8080/ || exit 1

# Start nginx
CMD ["nginx", "-g", "daemon off;"]
