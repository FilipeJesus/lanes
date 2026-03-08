import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vite.dev/config/
export default defineConfig({
    plugins: [react()],
    server: {
        proxy: {
            // Proxy /api/gateway/* to the gateway server running locally
            '/api/gateway': {
                target: 'http://localhost:3847',
                changeOrigin: true,
            },
        },
    },
    build: {
        outDir: '../out/web-ui',
        emptyOutDir: true,
    },
    test: {
        environment: 'jsdom',
        globals: true,
        setupFiles: './src/test/setup.ts',
        css: {
            modules: {
                classNameStrategy: 'non-scoped',
            },
        },
    },
});
