import {test} from "vitest";
import {createAgent, tool, ToolRuntime} from "langchain";
import {z} from "zod";
import {HumanMessage} from "@langchain/core/messages";
import {ChatOpenAI} from "@langchain/openai";

/*
StreamMode可选项:
messages: 输出模型生成的消息，格式为[messageChunk, metadata]
updates: 每一步完成后，输出本次更新的内容(模型发起工具调用 → 工具返回 → 模型生成回答)
values: 每一步完成后，输出当前所有信息(messages list及其他状态字段)
custom:	输出通过config.writer()发送的数据
checkpoints: 创建检查点时, 输出状态快照信息(用于查看保存的执行状态)
tasks: 输出执行任务的开始、结束、结果及错误(节点开始执行、执行完成...)
debug: 输出详细执行信息(排查节点执行、状态变化等问题)
tools: 输出Tool生命周期：开始、进度、结束、错误(工具开始查询、返回结果)
* */
test('Stream Mode Demo', async () => {
        const getWeather = tool(
            ({city}, runtime: ToolRuntime) => {
                const writer = runtime.writer;
                if (writer)
                    writer(`Looking up data for city: ${city}`);
                return `It's always sunny in ${city}!`;
            }, {
                name: "get_weather",
                description: "Get weather for a given city.",
                schema: z.object({city: z.string(),}),
            }
        );

        const agent = createAgent({
            model: model,
            tools: [getWeather],
        });

        // custom打印通过writer写入的数据
        for await (const [streamMode, msg] of await agent.stream(
            {messages: [new HumanMessage('How is the weather of NY?')]},
            {streamMode: ['custom']}))
            console.log(`${streamMode}:` + msg);

        // messages: 输出模型生成的消息，格式为[messageChunk, metadata]
        for await (const [streamMode, msg] of await agent.stream(
            {messages: [new HumanMessage('How is the weather of NY?')]},
            {streamMode: ['messages']}))
            console.log(`${streamMode}:` + JSON.stringify(msg));

        //tools: 输出Tool生命周期：开始、进度、结束、错误(工具开始查询、返回结果)
        for await (const [streamMode, msg] of await agent.stream(
            {messages: [new HumanMessage('How is the weather of NY?')]},
            {streamMode: ['tools']}))
            console.log(`${streamMode}:` + JSON.stringify(msg));

        //updates: 每一步完成后，输出本次更新的内容(模型发起工具调用 → 工具返回 → 模型生成回答)
        for await (const [streamMode, msg] of await agent.stream(
            {messages: [new HumanMessage('How is the weather of NY?')]},
            {streamMode: ['updates']}))
            console.log(`${streamMode}:` + JSON.stringify(msg));

        //values: 每一步完成后，输出当前所有信息(messages list及其他状态字段)
        for await (const [streamMode, msg] of await agent.stream(
            {messages: [new HumanMessage('How is the weather of NY?')]},
            {streamMode: ['values']}))
            console.log(`${streamMode}:` + JSON.stringify(msg));
    }
    , 600_000
)

// 禁用推理内容
const model = new ChatOpenAI({
    model: "gpt-5.5",
    streaming: false,
});