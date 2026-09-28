import {test} from 'vitest'
import {CompositeBackend, createDeepAgent, StateBackend} from "deepagents";
import {model} from "../../../tools/utils.ts";
import {HumanMessage} from "@langchain/core/messages";

test('', async () => {
    const sandbox = new StateBackend();
    const memoriesBackend = new StateBackend();
    const composite = new CompositeBackend(sandbox, {
        "/memories/": memoriesBackend,
    });

    // const agent = createDeepAgent({
    //     model,
    //     backend: composite,
    //     permissions: [
    //         { operations: ["write"], paths: ["/memories/**"], mode: "deny" },
    //     ],
    // });
    //
    // if (!agent) throw new Error("composite-backend: agent not created");


    const agent = createDeepAgent({
        model,
        backend: composite,
        permissions: [
            { operations: ["write"], paths: ["/workspace/**"], mode: "deny" },
        ],
    });

    if (!agent) throw new Error("composite-backend: agent not created");
    const output = await agent.invoke({messages: [new HumanMessage('Hello')]})
})