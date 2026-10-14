import {Command, MemorySaver, interrupt} from '@langchain/langgraph';
import {createAgent, createMiddleware, humanInTheLoopMiddleware} from 'langchain';
import {getSunnyWeather} from '../1.CoreComponents/4.tool.test.ts';
import {model} from '../../../tools/utils.ts';
import {HumanMessage} from '@langchain/core/messages';
import {test} from 'vitest'

// 当执行指定工具时。可以中断等待确认
async function humanInTheLoop() {
    const agent = createAgent({
        model: model,
        tools: [getSunnyWeather],
        middleware: [
            humanInTheLoopMiddleware({
                interruptOn: {
                    get_weather: {
                        allowedDecisions: ['approve', 'edit', 'reject'],
                        description: 'Get Weather requires approval',
                    },
                },
                descriptionPrefix: 'Tool execution pending approval',
            }),
        ],
        checkpointer: new MemorySaver(),
    });

    const config = {configurable: {thread_id: 'some_id'}};
    let result = await agent.invoke({
        messages: [new HumanMessage('How is the weather of NY?')]
    }, config)

    console.log(JSON.stringify(result.messages));
    // 执行到调用get_weather时会中断。等待确认
    console.log(JSON.stringify(result.__interrupt__![0].value));

    return [agent, config, result]
}

test('Approve', async () => {
    let [agent, config, result] = await humanInTheLoop();
    result = await agent.invoke(
        new Command({resume: {decisions: [{type: 'approve'}]}}),
        config
    );
    console.log(JSON.stringify(result.messages));
}, 600_000)

// 在Tool执行前改成其他Tool
test('edit', async () => {
    let [agent, config, result] = await humanInTheLoop();
    result = await agent.invoke(
        new Command({
            resume: {
                decisions: [{
                    type: 'edit',
                    editedAction: {
                        name: 'new_tool_name',
                        args: {key1: "new_value", key2: "original_value"},
                    }
                }]
            }, // or 'reject'
        }),
        config
    );
    console.log(JSON.stringify(result.messages));
}, 600_000)


test('reject', async () => {
    let [agent, config, result] = await humanInTheLoop();
    result = await agent.invoke(
        new Command({resume: {decisions: [{type: 'reject'}]}}),
        config
    );
    console.log(JSON.stringify(result.messages));
}, 600_000)

/*
多个审查: 需要多个审查时，按照中断中出现的顺序，对每个操作做出决定：
{
    decisions: [
        { type: "approve" },
        {
            type: "edit",
            editedAction: {
                name: "tool_name",
                args: { param: "new_value" }
            }
        },
        {
            type: "reject",
            message: "This action is not allowed"
        }
    ]
}
*/

/* StreamEvents: 可通过stream events检查是否产生了中断。
test('Stream Events', async () => {
    // Stream agent progress and LLM tokens until interrupt
    const stream = await agent.streamEvents(
        {messages: [{role: "user", content: "Delete old records from the database"}]},
        {...config, version: "v3"}
    );
    for await (const message of stream.messages)
        for await (const token of message.text)
            process.stdout.write(token);

    if (stream.interrupted)
        console.log(`\n\nInterrupt: ${JSON.stringify(stream.interrupts)}`);

    const resumeStream = await agent.streamEvents(
        new Command({resume: {decisions: [{type: "approve"}]}}),
        {...config, version: "v3"}
    );
    for await (const message of resumeStream.messages) {
        for await (const token of message.text) {
            process.stdout.write(token);
        }
    }
})
*/

// 自定义中断
test('customize HILT', async () => {
    const approvalMiddleware = createMiddleware({
        name: "approval",
        beforeAgent: () => {
            const approved = interrupt({question: "是否继续执行？"});
            // approved就是传入的值
            console.log(approved);
        },
    });

    const agent = createAgent({
        model: model,
        tools: [],
        middleware: [approvalMiddleware],
        checkpointer: new MemorySaver(),
    });
    const config = {configurable: {thread_id: "demo"}};

    const paused = await agent.invoke(
        {messages: [new HumanMessage('你好')]}, config
    );
    console.log(JSON.stringify(paused.__interrupt__![0].value));

    const result = await agent.invoke(
        new Command({resume: 'approved'}), config
    );
    console.log(result.messages);
})