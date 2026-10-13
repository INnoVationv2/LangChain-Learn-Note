import {test} from 'vitest';
import {CompositeBackend, createDeepAgent, FilesystemBackend, StateBackend} from 'deepagents';
import {mkdir} from "node:fs/promises";
import {HumanMessage} from "@langchain/core/messages";
import {model} from "../../../tools/utils.ts";

test('Backend Demo', async () => {
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
    });

    const result = await agent.invoke({
        messages: [new HumanMessage('Read file from /text/hello.md and print it')]
    });

    console.log(result.messages.at(-1)?.content);
});