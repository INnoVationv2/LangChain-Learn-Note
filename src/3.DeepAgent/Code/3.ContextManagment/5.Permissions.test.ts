import {test} from "vitest";
import {mkdir} from "node:fs/promises";
import {CompositeBackend, createDeepAgent, FilesystemBackend, LocalShellBackend, StateBackend} from "deepagents";
import {model} from "../../../tools/utils.ts";
import {HumanMessage} from "@langchain/core/messages";

test('Permission Demo', async () => {
    const textPath = `${process.cwd()}/.tmp`
    await mkdir(textPath, {recursive: true});

    console.log(process.cwd());
    const agent = createDeepAgent({
        model: model,
        backend: new CompositeBackend(
            new StateBackend(),
            {
                '/workspace/': new FilesystemBackend({
                    rootDir: '/path/to/project',
                    virtualMode: true,
                }),
                '/text/': new FilesystemBackend({
                    rootDir: `${process.cwd()}/.tmp`,
                    virtualMode: true,
                })
            }),
        permissions: [
            {
                operations: ['read', 'write'],
                paths: ['/text/**'],
                mode: 'deny'
            }
        ]
    });

    const result = await agent.invoke({
        messages: [new HumanMessage('Read file from /text/hello.md and print it')]
    });

    console.log(result.messages.at(-1)?.content);
});

test('CompositeBackend', async () => {
    const textPath = `${process.cwd()}/.tmp`
    await mkdir(textPath, {recursive: true});

    console.log(process.cwd());
    const agent = createDeepAgent({
        model: model,
        backend: new CompositeBackend(
            new LocalShellBackend(),
            {
                '/memory/': new FilesystemBackend({
                    rootDir: `${process.cwd()}/.tmp`,
                    virtualMode: true,
                })
            }),
        permissions: [
            {
                operations: ["write"],
                paths: ["/memory/**"], mode: "deny"
            },
            // 报错, /workspace不在/memory下
            {
                operations: ["write"],
                paths: ["/workspace/**"], mode: "deny"
            }
        ]
    });

    const result = await agent.invoke({
        messages: [new HumanMessage('Read file from /memory/hello.md and print it')]
    });

    console.log(result.messages.at(-1)?.content);
})

test('CompositeBackend access deny file', async () => {
    const textPath = `${process.cwd()}/.tmp`
    await mkdir(textPath, {recursive: true});

    console.log(process.cwd());
    const agent = createDeepAgent({
        model: model,
        backend: new CompositeBackend(
            new LocalShellBackend(),
            {
                '/memory/': new FilesystemBackend({
                    rootDir: `${process.cwd()}/.tmp`,
                    virtualMode: true,
                })
            }),
        permissions: [
            {
                operations: ['read', "write"],
                paths: ["/memory/**"], mode: "deny"
            }
        ]
    });

    const command = `cat ${process.cwd()}/.tmp/hello.md`;
    const result = await agent.invoke({
        messages: [new HumanMessage(`Run Shell Command '${command}', print the result`)]
    });

    console.log(result.messages.at(-1)?.content);
})