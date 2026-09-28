import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        testTimeout: 600_000, // 每个测试最多运行 30 秒
        hookTimeout: 600_000, // beforeAll、beforeEach 等钩子的超时时间
    },
});