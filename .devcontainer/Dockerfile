# Lanes Dev Container Dockerfile
# Extends the official TypeScript Node.js dev container

FROM mcr.microsoft.com/devcontainers/typescript-node:1-22-bookworm

# Install dependencies needed for VS Code extension development
# These libraries are required for Electron/VS Code to run in headless mode
RUN sudo apt-get update && sudo apt-get install -y \
    libnss3 \
    libnspr4 \
    libatk1.0-0 \
    libatk-bridge2.0-0 \
    libcups2 \
    libdrm2 \
    libxkbcommon0 \
    libxcomposite1 \
    libxdamage1 \
    libxfixes3 \
    libxrandr2 \
    libgbm1 \
    libasound2 \
    libgtk-3-0 \
    xvfb \
    && sudo apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Install git for worktree support
RUN sudo apt-get update && sudo apt-get install -y git \
    && sudo apt-get clean \
    && rm -rf /var/lib/apt/lists/*

# Set the working directory
WORKDIR /workspace

# Verify Node.js and npm versions
RUN node --version && npm --version

# Keep the container running
CMD ["/bin/bash"]