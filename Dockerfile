FROM node:20-alpine

# Install FFmpeg and clean packages cache
RUN apk add --no-cache ffmpeg

WORKDIR /usr/src/app

# Copy dependency files
COPY package*.json ./

# Install production dependencies only
RUN npm install --omit=dev

# Copy application files
COPY . .

# Expose RTMP ingestion and stream distribution ports
EXPOSE 1935 8000 8001

CMD ["node", "server.js"]
