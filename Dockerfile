FROM node:18-alpine as builder

# Build arguments
ARG NODE_ENV=production
ARG VITE_APP_NAME="Nuke"
ARG VITE_APP_DESCRIPTION="Vehicle Management Platform"

# Set environment variables
ENV NODE_ENV=${NODE_ENV}
ENV VITE_APP_NAME=${VITE_APP_NAME}
ENV VITE_APP_DESCRIPTION=${VITE_APP_DESCRIPTION}

# Set working directory
WORKDIR /app

# Install dependencies first (better caching)
COPY package*.json bun.lockb ./
COPY .npmrc ./

# Install build dependencies and clean up in one layer
RUN apk add --no-cache python3 make g++ \
    && npm ci --prefer-offline --no-audit --no-optional \
    && apk del python3 make g++

# Copy necessary config files
COPY tsconfig*.json ./
COPY vite.config.* ./
COPY tailwind.config.* ./
COPY postcss.config.js ./

# Copy source files
COPY src/ ./src/
COPY public/ ./public/

# Build the application using CI config
RUN cp vite.config.ci.js vite.config.js && \
    npm run build

# Production stage
FROM nginx:alpine

# Install curl for healthcheck
RUN apk add --no-cache curl

# Copy built files from builder stage
COPY --from=builder /app/dist /usr/share/nginx/html

# Copy nginx configuration
COPY nginx.conf /etc/nginx/conf.d/default.conf

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
