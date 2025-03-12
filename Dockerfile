# Build Stage
FROM node:18-alpine AS build

# Set working directory
WORKDIR /app

# Install necessary build tools
RUN apk add --no-cache python3 make g++

# Copy package files for efficient caching
COPY package*.json ./
COPY .npmrc ./

# First try clean install, if it fails fall back to regular install
RUN npm ci || npm install

# Copy all files
COPY . .

# Build the application
RUN npm run build

# Production Stage
FROM nginx:alpine AS production

# Copy built assets from build stage
COPY --from=build /app/dist /usr/share/nginx/html

# Add nginx configuration if needed
RUN rm -rf /etc/nginx/conf.d/default.conf
COPY nginx.conf /etc/nginx/conf.d/default.conf || echo "No custom nginx.conf found, using default"

# Expose port 80
EXPOSE 80

# Start Nginx server
CMD ["nginx", "-g", "daemon off;"]
