# Base image with Node.js 18 on Linux
FROM node:18-bullseye-slim

# Install system dependencies: Linux FFmpeg with libass & fontconfig for custom captions
RUN apt-get update && apt-get install -y \
    ffmpeg \
    fontconfig \
    fonts-dejavu \
    && rm -rf /var/lib/apt/lists/*

# Set working directory
WORKDIR /app

# Copy all project files into the container
COPY . .

# Environment variables for cloud container
ENV PORT=4000
ENV FFMPEG_PATH=ffmpeg
ENV CAPTION_FONT_PATH=/app/caption.ttf
ENV FRONTEND_DIR=/app/out

# Expose server port
EXPOSE 4000

# Start AutoEditor Node.js engine
CMD ["node", "bundle.cjs"]
